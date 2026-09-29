import type { NextConfig } from 'next';

// Заголовки безопасности для всех ответов. CSP ограничен тем, что не ломает карту и инлайн-стили прототипа:
// запрет встраивания в чужие фреймы (кликджекинг), base-uri и отправку форм только на свой сайт.
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
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  }
};

export default nextConfig;
