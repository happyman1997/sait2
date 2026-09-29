// Журнал событий пользователя + мгновенное уведомление через live.
import { pool, query, type Db } from './db';
import { publish } from './live';

export type EventRow = { userId: string | null | undefined; kind: string; text: string; jobId?: string | null; num?: number | null };

export async function addEvents(rows: EventRow[], db: Db = pool()) {
  for (const r of rows) {
    if (!r.userId) continue;
    await query('INSERT INTO events (user_id, kind, text, job_id) VALUES ($1, $2, $3, $4)', [r.userId, r.kind, r.text, r.jobId ?? null], db);
    await publish([r.userId], { t: 'event', text: r.text, num: r.num ?? null }, db);
  }
}
