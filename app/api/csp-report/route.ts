import { NextResponse } from 'next/server';
import { cspViolation } from '@/server/metrics';

// Отчёты браузера о нарушениях CSP: счётчик в метриках и короткая строка в журнал (не чаще 60 в минуту на процесс).
let windowStart = 0, logged = 0;

export async function POST(req: Request) {
  if (Number(req.headers.get('content-length') || 0) > 16_384) return new NextResponse(null, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse((await req.text()).slice(0, 16_384)); } catch { return new NextResponse(null, { status: 400 }); }
  const r = ((body as Record<string, unknown> | null)?.['csp-report'] ?? body) as Record<string, unknown> | null;
  const directive = String(r?.['effective-directive'] ?? r?.['violated-directive'] ?? 'unknown').split(' ')[0].slice(0, 40);
  cspViolation(directive);
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; logged = 0; }
  if (logged++ < 60) console.warn('[csp]', directive, String(r?.['blocked-uri'] ?? '').slice(0, 200), String(r?.['document-uri'] ?? '').slice(0, 200));
  return new NextResponse(null, { status: 204 });
}
