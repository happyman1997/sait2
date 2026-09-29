// Конфигурация из переменных окружения. Секреты — только отсюда.
function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v != null && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Не задана переменная окружения ${name}`);
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  databaseUrl: () => env('DATABASE_URL', isProd ? undefined : 'postgres://arena:arena@localhost:5432/arena_dev'),
  // Ключ для HMAC кодов подтверждения. В продакшене обязателен.
  codeSecret: () => env('AUTH_CODE_SECRET', isProd ? undefined : 'dev-only-code-secret'),
  smsProvider: () => env('SMS_PROVIDER', isProd ? undefined : 'console') as 'console' | 'smsru',
  smsRuApiId: () => env('SMSRU_API_ID'),
  // Только для разработки: фиксированный код вместо случайного (как 1234 в прототипе).
  devFixedCode: () => (isProd ? '' : env('SMS_DEV_FIXED_CODE', '')),
  secureCookies: () => env('SECURE_COOKIES', isProd ? '1' : '0') === '1',
  // Nominatim-совместимый геокодер. Публичный nominatim.openstreetmap.org — только для разработки (лимит 1 запрос/с).
  geocoderUrl: () => env('GEOCODER_URL', 'https://nominatim.openstreetmap.org'),
  geocoderUserAgent: () => env('GEOCODER_USER_AGENT', 'arena-raboty/0.1 (dev)'),
  // Сколько доверенных прокси стоит перед приложением (для IP в X-Forwarded-For). 0 — не доверять заголовку.
  trustProxyHops: () => Math.max(0, parseInt(env('TRUST_PROXY_HOPS', '1'), 10) || 0),
  // Почта: console (в лог) | smtp (SMTP_URL, например smtps://user:pass@smtp.yandex.ru:465).
  emailProvider: () => env('EMAIL_PROVIDER', isProd ? undefined : 'console') as 'console' | 'smtp',
  smtpUrl: () => env('SMTP_URL'),
  emailFrom: () => env('EMAIL_FROM', 'Арена Работы <no-reply@arena-raboty.ru>'),
  supportEmail: () => env('SUPPORT_EMAIL', 'support@arena-raboty.ru'),
  // Часовой пояс для тихих часов и суточного лимита уведомлений.
  timeZone: () => env('APP_TIME_ZONE', 'Europe/Moscow'),
  publicUrl: () => env('PUBLIC_URL', 'http://localhost:3000'),
  uploadDir: () => env('UPLOAD_DIR', isProd ? undefined : './data/uploads'),
  offerVersion: '2026-09'
};
