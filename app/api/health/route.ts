import { NextResponse } from 'next/server';
import { one } from '@/server/db';

export const dynamic = 'force-dynamic';

// Проверка живости для балансировщика и мониторинга: БД отвечает — 200, нет — 503. Без подробностей наружу.
export async function GET() {
  const t0 = performance.now();
  try {
    await one('SELECT 1');
    return NextResponse.json({ ok: true, dbMs: Math.round(performance.now() - t0) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
