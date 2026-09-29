// Метрики Prometheus: формат и накопительная гистограмма.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const { observe, renderMetrics } = await import('@/server/metrics');

beforeAll(async () => {
  await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool(), undefined, () => {});
});
afterAll(async () => { await pool().end(); });

describe('метрики', () => {
  it('счётчики по классу ответа и накопительные корзины длительности', async () => {
    observe(200, 0.03); observe(200, 0.3); observe(404, 0.01); observe(500, 3);
    const t = await renderMetrics();
    expect(t).toMatch(/arena_http_requests_total\{class="2xx"\} 2/);
    expect(t).toMatch(/arena_http_requests_total\{class="5xx"\} 1/);
    expect(t).toMatch(/arena_http_request_duration_seconds_bucket\{le="0.025"\} 1/);
    expect(t).toMatch(/arena_http_request_duration_seconds_bucket\{le="0.5"\} 3/);
    expect(t).toMatch(/arena_http_request_duration_seconds_bucket\{le="\+Inf"\} 4/);
    expect(t).toMatch(/arena_db_pool\{state="total"\} \d+/);
    expect(t).toMatch(/arena_support_queue\{kind="disputes"\} 0/);
  });
});
