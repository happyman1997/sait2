// Фоновые задачи: автоприёмка через 7 дней, очистка устаревших служебных записей и брошенных файлов,
// напоминания поддержке о сроке ответа.
// Запускаются из процесса приложения (instrumentation.ts) раз в 10 минут или внешним cron: `npm run cron`.
// pg_try_advisory_lock не даёт двум инстансам выполнять одно и то же одновременно.
import { pool } from './db';
import { processOutbox } from './events';
import { sweepFiles } from './files';
import { recheckNpd } from './verify';
import { autoAcceptDue } from './shifts';
import { remindSla } from './support';

const LOCK_KEY = 4242_0001;
const PAST_3Y = `coalesce(j.series_end, j.date) < current_date - interval '3 years'
  AND (j.repeat IS NULL OR j.series_end IS NOT NULL OR j.status IN ('accepted', 'cancelled'))`;

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
        `DELETE FROM sessions WHERE expires_at < now() OR created_at < now() - interval '90 days'`,
        `DELETE FROM auth_challenges WHERE expires_at < now() - interval '1 day'`,
        `DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`,
        `DELETE FROM daily_stats WHERE day < current_date - 30`,
        `DELETE FROM notification_outbox WHERE status <> 'pending' AND created_at < now() - interval '30 days'`,
        // Журнал хранится полгода — дольше не нужен ни пользователю, ни для разборов.
        `DELETE FROM events WHERE created_at < now() - interval '180 days'`,
        `DELETE FROM email_verifications WHERE expires_at < now() - interval '7 days'`,
        // Срок хранения из политики ПДн: переписка, фото, споры и жалобы — 3 года после смены (общий срок исковой давности).
        // Файлы фото уходят следом, в sweepFiles. Бессрочная серия без конца — только когда закрыта.
        ...['messages', 'photos', 'disputes', 'complaints'].map(t =>
          `DELETE FROM ${t} x USING jobs j WHERE x.job_id = j.id AND ${PAST_3Y}`)
      ]) cleaned += (await c.query(sql)).rowCount || 0;
      cleaned += await sweepFiles().catch(e => { console.error('[files]', (e as Error).message); return 0; });
      const { sent } = await processOutbox();
      await recheckNpd().catch(e => console.error('[npd]', (e as Error).message));
      await remindSla().catch(e => console.error('[sla]', (e as Error).message));
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
