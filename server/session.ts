import crypto from 'node:crypto';
import { one, pool, query, type Db } from './db';

export const SESSION_COOKIE = 'arena_session';
export const SESSION_DAYS = 30;

export type Ctx = { ip?: string | null; userAgent?: string | null };

export type SessionUser = {
  id: string;
  role: 'freelancer' | 'employer';
  login: string;
  phone: string;
  email: string;
  name: string;
  city: string;
  base_lat: number | null;
  base_lng: number | null;
  base_label: string | null;
  avatar_url: string | null;
  status: 'active' | 'blocked';
  is_staff: boolean;
  created_at: Date;
  session_id: string;
};

const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest();

export async function createSession(userId: string, ctx: Ctx, db: Db = pool()): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const row = await one<{ expires_at: Date }>(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING expires_at`,
    [userId, sha256(token), ctx.userAgent?.slice(0, 300) ?? null, ctx.ip ?? null, SESSION_DAYS],
    db
  );
  return { token, expiresAt: row!.expires_at };
}

/** Пользователь по токену; продлевает сессию (не чаще раза в час). */
export async function sessionUser(token: string | undefined | null, db: Db = pool()): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const row = await one<SessionUser & { last_seen_at: Date }>(
    `SELECT u.id, u.role, u.login, u.phone, u.email, u.name, u.city, u.base_lat, u.base_lng, u.base_label, u.avatar_url, u.status, u.is_staff, u.created_at,
            s.id AS session_id, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
    db
  );
  // Заблокированный или удалённый аккаунт — входа нет.
  if (!row || row.status !== 'active') return null;
  if (Date.now() - row.last_seen_at.getTime() > 3600_000) {
    await query(
      `UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1`,
      [row.session_id, SESSION_DAYS],
      db
    );
  }
  const { last_seen_at: _l, ...user } = row;
  return user;
}

export async function deleteSession(token: string | undefined | null, db: Db = pool()) {
  if (!token) return;
  await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)], db);
}

export async function deleteUserSessions(userId: string, db: Db = pool()) {
  await query('DELETE FROM sessions WHERE user_id = $1', [userId], db);
}
