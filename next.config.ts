import type { NextConfig } from 'next';

// Заголовки безопасности для всех ответов. Здесь — общая часть CSP (кликджекинг, base-uri, формы, плагины);
// страницы дополнительно получают строгую CSP со скриптами по nonce (proxy.ts, server/csp.ts).
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=()' },
  ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : [])
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Сгенерированные next dev файлы AGENTS.md / CLAUDE.md не нужны.
  agentRules: false,
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  // next/image на сайте не используется — встроенный обработчик /_next/image выключен (отвечает 404):
  // сервер не пережимает чужие запросы на картинки, меньше открытых точек.
  images: { unoptimized: true },
  // Docker-образ: минимальный сервер с только нужными модулями (Dockerfile задаёт NEXT_OUTPUT=standalone).
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // Шрифт картинок-превью (server/og.tsx) читается с диска — в образ его нужно взять явно.
  outputFileTracingIncludes: {
    '/api/og/**': ['./node_modules/@fontsource/golos-text/files/golos-text-{cyrillic,latin,latin-ext}-{500,700}-normal.woff']
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  }
};

export default nextConfig;
