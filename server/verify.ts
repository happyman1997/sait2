// Подтверждение e-mail (письма уходят только на подтверждённый адрес)
// и проверка статуса самозанятого (НПД) по ИНН в открытом сервисе ФНС.
import crypto from 'node:crypto';
import { config } from './config';
import { one, pool, query, type Db } from './db';
import { AppError } from './errors';
import { localClock } from './events';
import { hit, limitOrThrow } from './rate-limit';
import type { SessionUser } from './session';

type U = Pick<SessionUser, 'id' | 'role'>;
const need = (u: U | null) => { if (!u) throw new AppError(401, 'Нужно войти в аккаунт.'); return u; };
const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest();

// ───────────────────────── E-mail ─────────────────────────

export const EMAIL_TOKEN_HOURS = 24;

/** Письмо со ссылкой подтверждения; адрес берётся из профиля. */
export async function sendEmailVerification(viewer: U | null, db: Db = pool()) {
  const u = need(viewer);
  const me = await one<{ email: string; email_verified_at: Date | null }>('SELECT email, email_verified_at FROM users WHERE id = $1', [u.id], db);
  if (!me?.email) throw new AppError(422, 'Сначала укажите e-mail в профиле.', 'email');
  if (me.email_verified_at) return { sent: false, verified: true };
  await limitOrThrow('emailverify:' + u.id, 5, 3600, 'Писем уже несколько — проверьте папку «Спам» или попробуйте через час.', db);
  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO email_verifications (user_id, email, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
    [u.id, me.email, sha256(token), EMAIL_TOKEN_HOURS], db);
  const link = config.publicUrl() + '/api/me/email/confirm?t=' + token;
  await query(
    `INSERT INTO notification_outbox (user_id, channel, to_addr, subject, body) VALUES ($1, 'email', $2, $3, $4)`,
    [u.id, me.email, 'Арена Работы: подтвердите e-mail',
      'Чтобы получать уведомления о сменах на эту почту, подтвердите адрес:\n' + link +
      '\n\nСсылка действует ' + EMAIL_TOKEN_HOURS + ' часа. Если вы не указывали этот адрес на «Арене Работы», просто удалите письмо.'], db);
  return { sent: true, verified: false };
}

/** Переход по ссылке из письма. Адрес в профиле мог смениться — тогда ссылка недействительна. */
export async function confirmEmail(token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return false;
  const r = await query(
    `WITH v AS (
       UPDATE email_verifications ev SET used_at = now()
        WHERE ev.token_hash = $1 AND ev.used_at IS NULL AND ev.expires_at > now()
          AND ev.email = (SELECT u.email FROM users u WHERE u.id = ev.user_id)
        RETURNING ev.user_id
     )
     UPDATE users SET email_verified_at = now() WHERE id IN (SELECT user_id FROM v) RETURNING id`, [sha256(token)]);
  if (r.rowCount) await query(`INSERT INTO events (user_id, kind, text, read_at) VALUES ($1, 'account', 'E-mail подтверждён — письма об уведомлениях включены', now())`, [r.rows[0].id]);
  return !!r.rowCount;
}

// ───────────────────────── Самозанятость (НПД) ─────────────────────────

/** Контрольные цифры ИНН физлица (12 цифр). */
export function innValid(inn: string): boolean {
  if (!/^\d{12}$/.test(inn)) return false;
  const d = inn.split('').map(Number);
  const k = (w: number[]) => (w.reduce((s, x, i) => s + x * d[i], 0) % 11) % 10;
  return k([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && k([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
}

export type NpdFetcher = (inn: string, date: string) => Promise<boolean>;

/** Открытый API ФНС: statusnpd.nalog.ru. Лимит сервиса — 2 запроса в минуту с адреса. */
const fnsFetcher: NpdFetcher = async (inn, date) => {
  const res = await fetch('https://statusnpd.nalog.ru/api/v1/tracker/taxpayer_status', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inn, requestDate: date }),
    signal: AbortSignal.timeout(8000)
  });
  const body = await res.json().catch(() => null) as { status?: boolean; code?: string } | null;
  if (res.ok && body && typeof body.status === 'boolean') return body.status;
  if (body?.code === 'taxpayer.status.service.limited.error') throw new Error('limited');
  throw new Error('fns ' + res.status);
};

let fetcher: NpdFetcher = fnsFetcher;
export function setNpdFetcher(f: NpdFetcher | null) { fetcher = f ?? fnsFetcher; }

async function askFns(inn: string): Promise<boolean> {
  // Общий лимит площадки под лимит ФНС, чтобы нас не заблокировали.
  const g = await hit('npd:global', 2, 60);
  if (!g.ok) throw new AppError(429, 'Сервис ФНС принимает не больше двух запросов в минуту — повторите через минуту.', undefined, { retryAfter: g.retryAfter });
  try {
    return await fetcher(inn, localClock().day);
  } catch {
    throw new AppError(503, 'Сервис ФНС сейчас не отвечает — попробуйте позже. Статус не изменился.');
  }
}

export async function checkNpd(viewer: U | null, raw: unknown) {
  const u = need(viewer);
  if (u.role !== 'freelancer') throw new AppError(403, 'Статус самозанятого проверяет исполнитель.');
  const inn = (typeof raw === 'string' ? raw : '').replace(/\D/g, '');
  if (inn.length !== 12) throw new AppError(422, 'ИНН самозанятого — 12 цифр.', 'inn');
  if (!innValid(inn)) throw new AppError(422, 'Похоже, в ИНН опечатка — не сходятся контрольные цифры.', 'inn');
  await limitOrThrow('npd:' + u.id, 5, 3600, 'Проверок уже несколько — попробуйте через час.');
  const ok = await askFns(inn);
  await query(`UPDATE freelancer_profiles SET inn = $2, npd_status = $3, npd_checked_at = now() WHERE user_id = $1`, [u.id, inn, ok ? 'ok' : 'not_found']);
  await query(`INSERT INTO events (user_id, kind, text, read_at) VALUES ($1, 'account', $2, now())`,
    [u.id, ok ? 'ФНС подтвердила статус самозанятого' : 'ФНС не нашла статус самозанятого по этому ИНН']);
  return { status: ok ? 'ok' as const : 'not_found' as const, checkedAt: new Date().toISOString() };
}

/** Раз в сутки перепроверяем подтверждённых (в cron, по чуть-чуть — под лимит ФНС). */
export async function recheckNpd(max = 2): Promise<number> {
  const due = await query<{ user_id: string; inn: string }>(
    `SELECT user_id, inn FROM freelancer_profiles WHERE npd_status = 'ok' AND inn IS NOT NULL AND npd_checked_at < now() - interval '1 day'
      ORDER BY npd_checked_at LIMIT $1`, [max]);
  let n = 0;
  for (const r of due.rows) {
    let ok: boolean;
    try { ok = await askFns(r.inn); } catch { break; }
    await query(`UPDATE freelancer_profiles SET npd_status = $2, npd_checked_at = now() WHERE user_id = $1`, [r.user_id, ok ? 'ok' : 'not_found']);
    if (!ok) await query(`INSERT INTO events (user_id, kind, text) VALUES ($1, 'account', 'ФНС больше не подтверждает статус самозанятого — бейдж снят')`, [r.user_id]);
    n++;
  }
  return n;
}
