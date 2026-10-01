// Удаление аккаунта самим пользователем (отзыв согласия на обработку ПДн).
// Личные данные стираются сразу; заказы, переписка, отзывы, споры и фото смен остаются у второй стороны
// за «Удалённым пользователем» (сроки их хранения — по решению юриста). Пока есть незакрытые обязательства
// перед другими людьми (идущая смена, несданная работа, открытый спор), удалить аккаунт нельзя.
import crypto from 'node:crypto';
import { jobNum } from '@/lib/jobs';
import { one, query, tx, type Db } from './db';
import { AppError } from './errors';
import { removeFile } from './files';
import { invalidateSearch } from './jobs';
import { verifyPassword } from './password';
import { detachFreelancer } from './shifts';
import type { SessionUser } from './session';

type U = Pick<SessionUser, 'id' | 'role'>;
export const DELETE_WORD = 'УДАЛИТЬ';

/** Что мешает удалить аккаунт прямо сейчас — по-человечески, со списком заказов. */
async function obligations(u: U, db: Db): Promise<string[]> {
  const out: string[] = [];
  const list = (rows: { num: string }[]) => rows.map(r => '№ ' + jobNum(Number(r.num))).join(', ');
  if (u.role === 'employer') {
    const live = (await query<{ num: string }>(
      `SELECT j.num FROM jobs j WHERE j.employer_id = $1
          AND (j.status IN ('staffed', 'reported') OR (j.status = 'open' AND EXISTS (SELECT 1 FROM hires h WHERE h.job_id = j.id)))
        ORDER BY j.num LIMIT 10`, [u.id], db)).rows;
    if (live.length) out.push('Есть заказы с нанятыми исполнителями: ' + list(live) + '. Примите работу или отмените смену.');
  } else {
    const live = (await query<{ num: string }>(
      `SELECT j.num FROM hires h JOIN jobs j ON j.id = h.job_id
        WHERE h.freelancer_id = $1 AND j.status IN ('open', 'staffed', 'reported')
       UNION
       SELECT j.num FROM series_subs s JOIN jobs j ON j.id = s.job_id
        WHERE s.freelancer_id = $1 AND s.status = 'hired' AND s.day >= current_date AND j.status NOT IN ('cancelled', 'accepted')
       ORDER BY 1 LIMIT 10`, [u.id], db)).rows;
    if (live.length) out.push('Вы в смене: ' + list(live) + '. Откажитесь от неё или дождитесь приёмки работы.');
  }
  const disputes = (await query<{ num: string }>(
    `SELECT j.num FROM disputes d JOIN jobs j ON j.id = d.job_id
      WHERE d.status IN ('open', 'review') AND (d.freelancer_id = $1 OR j.employer_id = $1) ORDER BY j.num LIMIT 10`, [u.id], db)).rows;
  if (disputes.length) out.push('Открыт спор по расчёту: ' + list(disputes) + '. Дождитесь решения поддержки.');
  return out;
}

export async function deleteAccount(viewer: U | null, raw: unknown) {
  if (!viewer) throw new AppError(401, 'Нужно войти в аккаунт.');
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof r.confirm !== 'string' || r.confirm.trim().toUpperCase() !== DELETE_WORD) {
    throw new AppError(422, 'Впишите слово ' + DELETE_WORD + ' — так мы убедимся, что это не случайное нажатие.', 'confirm');
  }
  const files: string[] = [];
  await tx(async (db) => {
    const u = await one<{ password_hash: string; avatar_url: string | null; status: string }>(
      'SELECT password_hash, avatar_url, status FROM users WHERE id = $1 FOR UPDATE', [viewer.id], db);
    if (!u || u.status === 'deleted') throw new AppError(404, 'Аккаунт не найден.');
    if (!(await verifyPassword(typeof r.password === 'string' ? r.password : '', u.password_hash))) throw new AppError(401, 'Пароль неверный.', 'password');
    const blockers = await obligations(viewer, db);
    if (blockers.length) throw new AppError(409, 'Сейчас удалить аккаунт нельзя. ' + blockers.join(' '), undefined, { blockers });

    // Открытые заказы без нанятых — снимаются; ждущие отклики и замены — отзываются.
    if (viewer.role === 'employer') {
      const open = await query<{ id: string }>(`SELECT id FROM jobs WHERE employer_id = $1 AND status = 'open' FOR UPDATE`, [viewer.id], db);
      for (const j of open.rows) {
        await query(`INSERT INTO cancellations (job_id, by_role, reason, notice, late) VALUES ($1, 'employer', 'аккаунт работодателя удалён', 'больше суток', false)`, [j.id], db);
        await query(`UPDATE jobs SET status = 'cancelled', updated_at = now() WHERE id = $1`, [j.id], db);
        await query(`UPDATE applications SET status = 'rejected', updated_at = now() WHERE job_id = $1 AND status = 'sent'`, [j.id], db);
      }
      if (open.rows.length) invalidateSearch();
      await query('DELETE FROM objects WHERE employer_id = $1', [viewer.id], db);
    } else {
      await detachFreelancer(viewer.id, db);
    }

    // Личные данные: имя, контакты, вход, база, профиль, фото профиля, журнал, подписки, настройки.
    if (u.avatar_url) files.push(...[u.avatar_url.match(/\/api\/files\/([0-9a-f-]{36})/)?.[1]].filter((x): x is string => !!x));
    const tag = viewer.id.replace(/-/g, '').slice(0, 12);
    // phone_key — 10 цифр с ведущим 0: такого номера в РФ нет, уникальность — по хешу id.
    const phoneKey = '0' + (BigInt('0x' + crypto.createHash('sha256').update(viewer.id).digest('hex').slice(0, 15)) % 1_000_000_000n).toString().padStart(9, '0');
    await query(
      `UPDATE users SET name = 'Удалённый пользователь', login = $2, phone = '', phone_key = $3, email = '', password_hash = $4,
              city = '', base_lat = NULL, base_lng = NULL, base_label = NULL, avatar_url = NULL, bio = NULL, email_verified_at = NULL,
              is_staff = false, status = 'deleted', deleted_at = now(), updated_at = now()
        WHERE id = $1`,
      [viewer.id, 'del_' + tag, phoneKey, 'deleted:' + crypto.randomBytes(16).toString('hex')], db);
    for (const sql of [
      'DELETE FROM sessions WHERE user_id = $1',
      'DELETE FROM push_subscriptions WHERE user_id = $1',
      'DELETE FROM email_verifications WHERE user_id = $1',
      'DELETE FROM auth_challenges WHERE user_id = $1',
      'DELETE FROM events WHERE user_id = $1',
      'DELETE FROM notification_settings WHERE user_id = $1',
      'DELETE FROM employer_profiles WHERE user_id = $1',
      'DELETE FROM freelancer_profiles WHERE user_id = $1'
    ]) await query(sql, [viewer.id], db);
  });
  for (const id of files) await removeFile(id).catch(() => {});
  return { ok: true };
}
