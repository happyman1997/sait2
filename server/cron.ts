// Фоновые задачи: автоприёмка через 7 дней и очистка устаревших служебных записей.
// Запускаются из процесса приложения (instrumentation.ts) раз в 10 минут или внешним cron: `npm run cron`.
// pg_try_advisory_lock не даёт двум инстансам выполнять одно и то же одновременно.
import { pool } from './db';
import { processOutbox } from './events';
import { autoAcceptDue } from './shifts';

const LOCK_KEY = 4242_0001;

export async function runDueTasks(): Promise<{ skipped: boolean; autoAccepted: number[]; cleaned: number; sent?: number }> {
  const c = await pool().connect();
  try {
    const got = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!got.rows[0].ok) return { skipped: true, autoAccepted: [], cleaned: 0 };
    try {
      const autoAccepted = await autoAcceptDue();
      // Одно соединение — запросы строго по очереди.
      let cleaned = 0;
      for (const sql of [
        `DELETE FROM sessions WHERE expires_at < now()`,
        `DELETE FROM auth_challenges WHERE expires_at < now() - interval '1 day'`,
        `DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`,
        `DELETE FROM daily_stats WHERE day < current_date - 30`,
        `DELETE FROM notification_outbox WHERE status <> 'pending' AND created_at < now() - interval '30 days'`
      ]) cleaned += (await c.query(sql)).rowCount || 0;
      const { sent } = await processOutbox();
      return { skipped: false, autoAccepted, cleaned, sent };
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    c.release();
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let outboxTimer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(everyMs = 10 * 60_000) {
  if (timer) return;
  const tick = () => runDueTasks()
    .then(r => { if (r.autoAccepted.length) console.log('[cron] автоприёмка:', r.autoAccepted.join(', ')); })
    .catch(e => console.error('[cron]', (e as Error).message));
  setTimeout(tick, 15_000);
  timer = setInterval(tick, everyMs);
  timer.unref?.();
  // Очередь SMS/e-mail — чаще: SKIP LOCKED делает параллельные инстансы безопасными.
  outboxTimer = setInterval(() => processOutbox().catch(e => console.error('[outbox]', (e as Error).message)), 30_000);
  outboxTimer.unref?.();
}
