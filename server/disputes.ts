// Споры по расчёту (как в прототипе): площадка денег не держит — фиксирует претензию с доказательствами
// (фото, переписка, приёмка, отметки о расчёте, условия заказа), даёт второй стороне ответить, спорное решает поддержка.
import { DISPUTE_REASONS, jobNum, money, type DisputeInfo } from '@/lib/jobs';
import { findBadField } from '@/lib/moderation';
import { one, pool, query, tx, type Db } from './db';
import { AppError, ModerationError } from './errors';
import { addEvents, mailSupport } from './events';
import { getJob, shortName } from './jobs';
import { publish } from './live';
import { limitOrThrow } from './rate-limit';
import type { SessionUser } from './session';

type U = Pick<SessionUser, 'id' | 'role'>;
type Viewer = Parameters<typeof getJob>[1];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARK_DAYS = 90;
export const disputeNum = (n: number) => 'СП-' + n;

type JobRow = { id: string; num: string; title: string; status: string; employer_id: string; pay: number; unit: string; pay_type: string | null };

async function lockJob(num: number, db: Db) {
  const j = await one<JobRow>('SELECT id, num, title, status, employer_id, pay, unit, pay_type FROM jobs WHERE num = $1 FOR UPDATE', [num], db);
  if (!j) throw new AppError(404, 'Заказ не найден.');
  return j;
}

const need = (v: Viewer): U => { if (!v) throw new AppError(401, 'Нужно войти в аккаунт.'); return v; };

/** Снимок доказательств на момент открытия спора. */
async function evidence(j: JobRow, freelancerId: string, db: Db) {
  const e = await one<{ before: number; after: number; msgs: number; accepted: boolean; auto: boolean | null; emp: boolean | null; fl: boolean | null }>(
    `SELECT (SELECT count(*) FROM photos WHERE job_id = $1 AND kind = 'before')::int AS before,
            (SELECT count(*) FROM photos WHERE job_id = $1 AND kind = 'after')::int AS after,
            (SELECT count(*) FROM messages WHERE job_id = $1 AND freelancer_id = $2)::int AS msgs,
            EXISTS (SELECT 1 FROM acceptances WHERE job_id = $1) AS accepted,
            (SELECT auto FROM acceptances WHERE job_id = $1) AS auto,
            (SELECT employer_marked FROM settlements WHERE job_id = $1) AS emp,
            (SELECT freelancer_marked FROM settlements WHERE job_id = $1) AS fl`, [j.id, freelancerId], db);
  const x = e!;
  return [
    { ok: x.before + x.after > 0, label: x.before + x.after ? 'Фото объекта: до — ' + x.before + ', после — ' + x.after : 'Фото до и после не приложены' },
    { ok: x.msgs > 0, label: x.msgs ? 'Переписка по заказу — ' + x.msgs + ' сообщ.' : 'Переписки в чате нет' },
    { ok: x.accepted, label: x.accepted ? (x.auto ? 'Работа принята автоматически через 7 дней' : 'Приёмка работ отмечена работодателем') : 'Работа не отмечена как принятая' },
    { ok: !!x.emp, label: x.emp ? 'Работодатель отметил: оплата передана' : 'Работодатель не отмечал передачу оплаты' },
    { ok: !!x.fl, label: x.fl ? 'Исполнитель отметил: деньги получены' : 'Исполнитель не отмечал получение денег' },
    { ok: true, label: 'Условия заказа: ' + money(j.pay, j.unit) + ', ' + (j.pay_type || 'способ оплаты не указан') }
  ];
}

/** Открыть спор. Исполнитель — по своей смене; работодатель — указывает нанятого (id отклика). */
export async function openDispute(num: number, raw: unknown, viewer: Viewer) {
  const u = need(viewer);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const side = u.role === 'employer' ? 'employer' : 'freelancer';
  const reason = typeof r.reason === 'string' && (DISPUTE_REASONS[side] as readonly string[]).includes(r.reason) ? r.reason : '';
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, 2000) : '';
  const sum = Math.round(Number(String(r.sum ?? '').replace(/[^\d]/g, '')));
  if (!reason) throw new AppError(422, 'Выберите, что произошло.', 'reason');
  if (!Number.isFinite(sum) || sum <= 0 || sum > 10_000_000) throw new AppError(422, 'Укажите сумму, о которой спор.', 'sum');
  if (text.length < 10) throw new AppError(422, 'Опишите, что произошло, — иначе поддержке не с чем работать.', 'text');
  const bad = findBadField([{ field: 'text', label: 'Что уточнить', value: text }]);
  if (bad) throw new ModerationError(bad.field, bad.label, bad.category);
  await limitOrThrow('dispute:' + u.id, 10, 86400, 'Слишком много споров за сутки — напишите в поддержку.');

  await tx(async (db) => {
    const j = await lockJob(num, db);
    if (j.status !== 'accepted' && j.status !== 'reported') throw new AppError(409, 'Спор по расчёту открывается после сдачи работы.');
    let freelancerId: string;
    if (side === 'employer') {
      if (j.employer_id !== u.id) throw new AppError(403, 'Спор открывают только стороны смены.');
      if (typeof r.target !== 'string' || !UUID_RE.test(r.target)) throw new AppError(422, 'Выберите исполнителя.', 'target');
      const a = await one<{ freelancer_id: string }>(
        `SELECT a.freelancer_id FROM applications a JOIN hires h ON h.job_id = a.job_id AND h.freelancer_id = a.freelancer_id WHERE a.id = $1 AND a.job_id = $2`, [r.target, j.id], db);
      if (!a) throw new AppError(422, 'Спор можно открыть только с тем, кто работал на смене.', 'target');
      freelancerId = a.freelancer_id;
    } else {
      if (!(await one('SELECT 1 FROM hires WHERE job_id = $1 AND freelancer_id = $2', [j.id, u.id], db))) throw new AppError(403, 'Спор открывают только стороны смены.');
      freelancerId = u.id;
    }
    const ev = await evidence(j, freelancerId, db);
    const row = await one<{ num: number }>(
      `INSERT INTO disputes (job_id, freelancer_id, opened_by, reason, sum, text, evidence) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING RETURNING num`, [j.id, freelancerId, side, reason, sum, text, JSON.stringify(ev)], db);
    if (!row) throw new AppError(409, 'По этой смене уже есть незакрытый спор.');
    const other = side === 'employer' ? freelancerId : j.employer_id;
    const label = disputeNum(row.num) + ' · заказ № ' + jobNum(num) + ' «' + j.title + '»';
    await addEvents([{
      userId: other, kind: 'dispute', jobId: j.id, num, deliver: true, urgent: true,
      text: 'Открыт спор по расчёту ' + label + ': ' + reason + ', ' + sum.toLocaleString('ru-RU') + ' ₽. Ответьте в карточке смены.'
    }, { userId: u.id, kind: 'dispute', jobId: j.id, num, silent: true, text: 'Спор ' + label + ' передан в поддержку' }], db);
    await mailSupport('Спор ' + label, 'Открыл: ' + (side === 'employer' ? 'работодатель' : 'исполнитель') + '\nПричина: ' + reason +
      '\nСумма: ' + sum + ' ₽\n\n' + text + '\n\nДоказательства:\n' + ev.map(e => (e.ok ? '✓ ' : '— ') + e.label).join('\n'), db);
    await publish([j.employer_id, freelancerId], { t: 'job', num }, db);
  });
  return getJob(num, viewer);
}

/** Действие по спору. Ответчик: «оплата отправлена» (только работодатель) или пояснение; инициатор — снять спор. */
export async function actDispute(num: number, disputeId: string, raw: unknown, viewer: Viewer) {
  const u = need(viewer);
  if (!UUID_RE.test(disputeId)) throw new AppError(404, 'Спор не найден.');
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const action = r.action;
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, 2000) : '';
  await tx(async (db) => {
    const j = await lockJob(num, db);
    const d = await one<{ id: string; num: number; status: string; opened_by: 'employer' | 'freelancer'; freelancer_id: string }>(
      'SELECT id, num, status, opened_by, freelancer_id FROM disputes WHERE id = $1 AND job_id = $2 FOR UPDATE', [disputeId, j.id], db);
    if (!d) throw new AppError(404, 'Спор не найден.');
    const mySide = u.id === j.employer_id ? 'employer' : u.id === d.freelancer_id ? 'freelancer' : null;
    if (!mySide) throw new AppError(403, 'Спор видят только его стороны.');
    const initiator = mySide === d.opened_by;
    const open = d.status === 'open' || d.status === 'review';
    if (!open) throw new AppError(409, 'Спор уже закрыт.');
    const other = mySide === 'employer' ? d.freelancer_id : j.employer_id;
    const label = disputeNum(d.num) + ' · заказ № ' + jobNum(num);
    let note: string;
    if (action === 'withdraw') {
      if (!initiator) throw new AppError(403, 'Снять спор может только тот, кто его открыл.');
      await query(`UPDATE disputes SET status = 'withdrawn', closed_at = now() WHERE id = $1`, [d.id], db);
      // «Деньги пришли» — это и есть отметка получения.
      if (mySide === 'freelancer') {
        await query(`INSERT INTO settlements (job_id, freelancer_marked, freelancer_at) VALUES ($1, true, now())
                     ON CONFLICT (job_id) DO UPDATE SET freelancer_marked = true, freelancer_at = coalesce(settlements.freelancer_at, now())`, [j.id], db);
      }
      note = mySide === 'freelancer' ? 'Спор ' + label + ' снят — исполнитель получил деньги' : 'Спор ' + label + ' снят работодателем — вопрос закрыт по договорённости';
    } else if (action === 'paid') {
      if (initiator || mySide !== 'employer') throw new AppError(403, 'Отметить оплату по спору может работодатель, если спор открыл исполнитель.');
      await query(`UPDATE disputes SET status = 'paid', response = $2, closed_at = now() WHERE id = $1`, [d.id, text || 'Оплата отправлена'], db);
      await query(`INSERT INTO settlements (job_id, employer_marked, employer_at) VALUES ($1, true, now())
                   ON CONFLICT (job_id) DO UPDATE SET employer_marked = true, employer_at = coalesce(settlements.employer_at, now())`, [j.id], db);
      note = 'Спор ' + label + ': работодатель отправил оплату. Проверьте поступление и отметьте «деньги получены».';
    } else if (action === 'explain') {
      if (initiator) throw new AppError(403, 'Пояснение даёт вторая сторона.');
      if (text.length < 10) throw new AppError(422, 'Напишите пояснение — его прочитает поддержка.', 'text');
      const bad = findBadField([{ field: 'text', label: 'Пояснение', value: text }]);
      if (bad) throw new ModerationError(bad.field, bad.label, bad.category);
      await query(`UPDATE disputes SET status = 'review', response = $2 WHERE id = $1`, [d.id, text], db);
      await mailSupport('Пояснение по спору ' + label, text, db);
      note = 'Спор ' + label + ': вторая сторона не согласна и дала пояснение — решение примет поддержка.';
    } else {
      throw new AppError(422, 'Неизвестное действие.');
    }
    await addEvents([{ userId: other, kind: 'dispute', jobId: j.id, num, deliver: true, text: note },
      { userId: u.id, kind: 'dispute', jobId: j.id, num, silent: true, text: note }], db);
    await publish([j.employer_id, d.freelancer_id], { t: 'job', num }, db);
  });
  return getJob(num, viewer);
}

/** Споры по заказу глазами участника (для карточки смены). */
export async function jobDisputes(jobId: string, employerId: string, viewerId: string, db: Db = pool()): Promise<DisputeInfo[]> {
  const owner = viewerId === employerId;
  const r = await query<{
    id: string; num: number; status: DisputeInfo['status']; opened_by: 'employer' | 'freelancer'; freelancer_id: string; fl_name: string; app_id: string | null;
    reason: string; sum: number; text: string; response: string | null; resolution: string | null; resolved_for: DisputeInfo['resolvedFor'];
    evidence: DisputeInfo['evidence']; created_at: Date; closed_at: Date | null; emp_name: string;
  }>(
    `SELECT d.id, d.num, d.status, d.opened_by, d.freelancer_id, f.name AS fl_name, e.name AS emp_name,
            (SELECT a.id FROM applications a WHERE a.job_id = d.job_id AND a.freelancer_id = d.freelancer_id) AS app_id,
            d.reason, d.sum, d.text, d.response, d.resolution, d.resolved_for, d.evidence, d.created_at, d.closed_at
       FROM disputes d JOIN users f ON f.id = d.freelancer_id JOIN jobs j ON j.id = d.job_id JOIN users e ON e.id = j.employer_id
      WHERE d.job_id = $1 AND ($2 OR d.freelancer_id = $3)
      ORDER BY d.created_at DESC`, [jobId, owner, viewerId], db);
  return r.rows.map(d => ({
    id: d.id, num: disputeNum(d.num), status: d.status, openedBy: d.opened_by,
    mine: (d.opened_by === 'employer') === owner, other: owner ? shortName(d.fl_name) : d.emp_name, appId: owner ? d.app_id : null,
    reason: d.reason, sum: d.sum, text: d.text, response: d.response, resolution: d.resolution, resolvedFor: d.resolved_for,
    evidence: d.evidence, at: d.created_at.toISOString(), closedAt: d.closed_at ? d.closed_at.toISOString() : null
  }));
}

// ───────────────────────── Поддержка ─────────────────────────

export type SupportDispute = DisputeInfo & { jobNum: number; title: string; employer: string; freelancer: string };

export async function listDisputes(status: unknown): Promise<SupportDispute[]> {
  const st = status === 'closed' ? 'closed' : 'open';
  const r = await query<{
    id: string; num: number; status: DisputeInfo['status']; opened_by: 'employer' | 'freelancer'; reason: string; sum: number; text: string;
    response: string | null; resolution: string | null; resolved_for: DisputeInfo['resolvedFor']; evidence: DisputeInfo['evidence'];
    created_at: Date; closed_at: Date | null; job_num: string; title: string; emp: string; fl: string;
  }>(
    `SELECT d.id, d.num, d.status, d.opened_by, d.reason, d.sum, d.text, d.response, d.resolution, d.resolved_for, d.evidence, d.created_at, d.closed_at,
            j.num AS job_num, j.title, e.name || ' · ' || e.login AS emp, f.name || ' · ' || f.login AS fl
       FROM disputes d JOIN jobs j ON j.id = d.job_id JOIN users e ON e.id = j.employer_id JOIN users f ON f.id = d.freelancer_id
      WHERE ($1 = 'open') = (d.status IN ('open', 'review'))
      ORDER BY CASE WHEN d.status = 'review' THEN 0 ELSE 1 END, CASE WHEN $1 = 'open' THEN d.created_at END, d.closed_at DESC NULLS LAST
      LIMIT 100`, [st]);
  return r.rows.map(d => ({
    id: d.id, num: disputeNum(d.num), status: d.status, openedBy: d.opened_by, mine: false, other: '', appId: null,
    reason: d.reason, sum: d.sum, text: d.text, response: d.response, resolution: d.resolution, resolvedFor: d.resolved_for,
    evidence: d.evidence, at: d.created_at.toISOString(), closedAt: d.closed_at ? d.closed_at.toISOString() : null,
    jobNum: Number(d.job_num), title: d.title, employer: d.emp, freelancer: d.fl
  }));
}

/** Решение поддержки: в чью пользу; проигравшей стороне — пометка на 90 дней. */
export async function resolveDispute(staffId: string, id: string, raw: unknown) {
  if (!UUID_RE.test(id)) throw new AppError(404, 'Спор не найден.');
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const forSide = r.for === 'employer' || r.for === 'freelancer' ? r.for : null;
  const note = typeof r.note === 'string' ? r.note.trim().slice(0, 1000) : '';
  if (!forSide) throw new AppError(422, 'Выберите, в чью пользу решение.', 'for');
  if (note.length < 5) throw new AppError(422, 'Напишите пару слов о решении — его увидят обе стороны.', 'note');
  await tx(async (db) => {
    const d = await one<{ id: string; num: number; status: string; job_id: string; freelancer_id: string; employer_id: string; job_num: string; title: string }>(
      `SELECT d.id, d.num, d.status, d.job_id, d.freelancer_id, j.employer_id, j.num AS job_num, j.title
         FROM disputes d JOIN jobs j ON j.id = d.job_id WHERE d.id = $1 FOR UPDATE OF d`, [id], db);
    if (!d) throw new AppError(404, 'Спор не найден.');
    if (d.status !== 'open' && d.status !== 'review') throw new AppError(409, 'Спор уже закрыт.');
    await query(`UPDATE disputes SET status = 'resolved', resolution = $2, resolved_for = $3, resolved_by = $4, closed_at = now() WHERE id = $1`,
      [id, note, forSide, staffId], db);
    const loser = forSide === 'employer' ? d.freelancer_id : d.employer_id;
    const label = disputeNum(d.num) + ' · заказ № ' + jobNum(Number(d.job_num));
    await query(`INSERT INTO user_marks (user_id, kind, reason, job_id, until) VALUES ($1, 'complaint', $2, $3, now() + make_interval(days => $4))`,
      [loser, 'Спор по расчёту ' + label + ' решён не в вашу пользу', d.job_id, MARK_DAYS], db);
    const text = 'Поддержка решила спор ' + label + ' в пользу ' + (forSide === 'employer' ? 'работодателя' : 'исполнителя') + ': ' + note;
    await addEvents([d.employer_id, d.freelancer_id].map(userId => ({ userId, kind: 'dispute', jobId: d.job_id, num: Number(d.job_num), deliver: true, text })), db);
    await query('INSERT INTO staff_actions (staff_id, action, user_id, note) VALUES ($1, $2, $3, $4)', [staffId, 'dispute_' + forSide, loser, label + ': ' + note], db);
    await publish([d.employer_id, d.freelancer_id], { t: 'job', num: Number(d.job_num) }, db);
  });
  return { ok: true };
}
