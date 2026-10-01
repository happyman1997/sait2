// Метрики процесса для Prometheus: запросы API (по классу ответа), длительность, ошибки, пул БД, живые потоки, бизнес-счётчики.
import { one, pool } from './db';
import { liveStats } from './live';

type G = typeof globalThis & { __arenaMetrics?: { count: Record<string, number>; durSum: number; durCount: number; buckets: number[]; csp: Record<string, number> } };
const g = globalThis as G;
const BOUNDS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const m = (g.__arenaMetrics ??= { count: {}, durSum: 0, durCount: 0, buckets: BOUNDS.map(() => 0), csp: {} });
m.csp ??= {};

/** Нарушение CSP, о котором сообщил браузер (по директиве; неизвестные сворачиваются в other). */
export function cspViolation(directive: string) {
  const d = /^[a-z-]{3,30}$/.test(directive) ? directive : 'other';
  if (Object.keys(m.csp).length < 30 || m.csp[d]) m.csp[d] = (m.csp[d] || 0) + 1;
}

export function observe(status: number, seconds: number) {
  const cls = Math.floor(status / 100) + 'xx';
  m.count[cls] = (m.count[cls] || 0) + 1;
  m.durSum += seconds;
  m.durCount++;
  BOUNDS.forEach((b, i) => { if (seconds <= b) m.buckets[i]++; });
}

export async function renderMetrics(): Promise<string> {
  const p = pool();
  const biz = await one<{ users_f: number; users_e: number; jobs_open: number; outbox_pending: number; outbox_failed: number; complaints: number; disputes: number }>(
    `SELECT (SELECT count(*) FROM users WHERE role = 'freelancer' AND status <> 'deleted')::int AS users_f,
            (SELECT count(*) FROM users WHERE role = 'employer' AND status <> 'deleted')::int AS users_e,
            (SELECT count(*) FROM jobs WHERE status IN ('open', 'staffed'))::int AS jobs_open,
            (SELECT count(*) FROM notification_outbox WHERE status = 'pending')::int AS outbox_pending,
            (SELECT count(*) FROM notification_outbox WHERE status = 'failed' AND created_at > now() - interval '1 day')::int AS outbox_failed,
            (SELECT count(*) FROM complaints WHERE status = 'open')::int AS complaints,
            (SELECT count(*) FROM disputes WHERE status IN ('open', 'review'))::int AS disputes`);
  const live = liveStats();
  const mem = process.memoryUsage();
  const L: string[] = [];
  const metric = (name: string, type: string, help: string, rows: [string, number][]) => {
    L.push('# HELP ' + name + ' ' + help, '# TYPE ' + name + ' ' + type);
    for (const [labels, v] of rows) L.push(name + labels + ' ' + v);
  };
  metric('arena_http_requests_total', 'counter', 'API-запросы по классу ответа', Object.entries(m.count).map(([c, v]) => ['{class="' + c + '"}', v]));
  metric('arena_http_request_duration_seconds', 'histogram', 'Длительность API-запросов', [
    ...BOUNDS.map((b, i) => ['_bucket{le="' + b + '"}', m.buckets[i]] as [string, number]),
    ['_bucket{le="+Inf"}', m.durCount], ['_sum', Math.round(m.durSum * 1000) / 1000], ['_count', m.durCount]
  ]);
  metric('arena_csp_violations_total', 'counter', 'Нарушения CSP по директивам (отчёты браузеров)', Object.entries(m.csp).map(([d, v]) => ['{directive="' + d + '"}', v]));
  metric('arena_db_pool', 'gauge', 'Соединения пула Postgres', [['{state="total"}', p.totalCount], ['{state="idle"}', p.idleCount], ['{state="waiting"}', p.waitingCount]]);
  metric('arena_live_streams', 'gauge', 'Открытые живые потоки (SSE) на инстансе', [['', live.streams]]);
  metric('arena_users', 'gauge', 'Пользователи по ролям', [['{role="freelancer"}', biz!.users_f], ['{role="employer"}', biz!.users_e]]);
  metric('arena_jobs_open', 'gauge', 'Открытые заказы', [['', biz!.jobs_open]]);
  metric('arena_outbox', 'gauge', 'Очередь уведомлений', [['{state="pending"}', biz!.outbox_pending], ['{state="failed_24h"}', biz!.outbox_failed]]);
  metric('arena_support_queue', 'gauge', 'Очередь поддержки', [['{kind="complaints"}', biz!.complaints], ['{kind="disputes"}', biz!.disputes]]);
  metric('arena_process_memory_bytes', 'gauge', 'Память процесса', [['{kind="rss"}', mem.rss], ['{kind="heap_used"}', mem.heapUsed]]);
  metric('arena_process_uptime_seconds', 'gauge', 'Время работы процесса', [['', Math.round(process.uptime())]]);
  return L.join('\n') + '\n';
}
