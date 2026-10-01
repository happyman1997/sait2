import { one, type Db, pool } from './db';
import { AppError } from './errors';

// Фиксированное окно в Postgres: безопасно при нескольких инстансах.
export async function hit(key: string, limit: number, windowSec: number, db: Db = pool()): Promise<{ ok: boolean; retryAfter: number }> {
  const row = await one<{ count: number; window_start: Date }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_start END
     RETURNING count, window_start`,
    [key, windowSec],
    db
  );
  const count = row?.count ?? 1;
  const started = row ? row.window_start.getTime() : Date.now();
  return { ok: count <= limit, retryAfter: Math.max(1, Math.ceil((started + windowSec * 1000 - Date.now()) / 1000)) };
}

/** Вернуть одну списанную попытку (успешное действие не должно тратить бюджет). */
export async function refund(key: string, db: Db = pool()) {
  await one('UPDATE rate_limits SET count = greatest(count - 1, 0) WHERE key = $1', [key], db);
}

export async function limitOrThrow(key: string, limit: number, windowSec: number, message: string, db?: Db) {
  const r = await hit(key, limit, windowSec, db);
  if (!r.ok) throw new AppError(429, message, undefined, { retryAfter: r.retryAfter });
}
