import crypto from 'node:crypto';
import { config } from '@/server/config';
import { renderMetrics } from '@/server/metrics';

export const dynamic = 'force-dynamic';

// Метрики Prometheus. Доступ — по заголовку Authorization: Bearer <METRICS_TOKEN>; без токена раздел закрыт.
export async function GET(req: Request) {
  const token = config.metricsToken();
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const ok = token && got.length === token.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(token));
  if (!ok) return new Response('not found', { status: 404 });
  return new Response(await renderMetrics(), { headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' } });
}
