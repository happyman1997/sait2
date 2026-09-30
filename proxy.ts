import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, makeNonce } from '@/server/csp';

// Строгая CSP для страниц: свежий nonce на каждый ответ. Next.js берёт его из заголовка запроса
// и проставляет своим скриптам сам; страницы поэтому рендерятся динамически (connection() в корневом layout).
export function proxy(request: NextRequest) {
  const nonce = makeNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV === 'development', connectExtra: process.env.CSP_CONNECT_SRC });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [
    {
      // Только страницы: API, статика, воркеры карты и сервис-воркер — без неё (у них общая CSP из next.config).
      source: '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|sw.js|maplibre/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' }
      ]
    }
  ]
};
