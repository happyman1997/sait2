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
  // Только для разработки: фиксированный код из письма вместо случайного (6 цифр, например 123456).
  devFixedCode: () => (isProd ? '' : env('DEV_FIXED_CODE', '')),
  secureCookies: () => env('SECURE_COOKIES', isProd ? '1' : '0') === '1',
  // Nominatim-совместимый геокодер. Публичный nominatim.openstreetmap.org — только для разработки (лимит 1 запрос/с,
  // сервер за рубежом); в продакшене без своего адреса и без ключа DaData поиск адреса выключен. Заглушка из примера — не адрес.
  geocoderUrl: () => { const u = env('GEOCODER_URL', isProd ? '' : 'https://nominatim.openstreetmap.org'); return /\.example\./.test(u) ? '' : u; },
  geocoderUserAgent: () => env('GEOCODER_USER_AGENT', 'arena-raboty/0.1 (dev)'),
  // DaData — поиск адреса в продакшене (API-ключ из личного кабинета dadata.ru). Задан — GEOCODER_URL не используется.
  dadataKey: () => env('DADATA_API_KEY', ''),
  // Сколько доверенных прокси стоит перед приложением (для IP в X-Forwarded-For). 0 — не доверять заголовку.
  trustProxyHops: () => Math.max(0, parseInt(env('TRUST_PROXY_HOPS', '1'), 10) || 0),
  // Почта: console (в лог) | smtp (SMTP_URL, например smtps://user:pass@smtp.yandex.ru:465).
  emailProvider: () => env('EMAIL_PROVIDER', isProd ? undefined : 'console') as 'console' | 'smtp',
  smtpUrl: () => env('SMTP_URL'),
  emailFrom: () => env('EMAIL_FROM', 'Арена Работ <no-reply@arenarabot.ru>'),
  supportEmail: () => env('SUPPORT_EMAIL', 'support@arenarabot.ru'),
  // Часовой пояс для тихих часов и суточного лимита уведомлений.
  timeZone: () => env('APP_TIME_ZONE', 'Europe/Moscow'),
  publicUrl: () => env('PUBLIC_URL', 'http://localhost:3000'),
  // Коды подтверждения прав на сайт в Яндекс.Вебмастере и Google Search Console (мета-тег; это не секрет).
  // По умолчанию — код arenarabot.ru из Вебмастера; другой сайт задаёт свой (или пустой — без тега).
  yandexVerification: () => env('YANDEX_VERIFICATION', 'b91c308724c2c0a7'),
  googleVerification: () => env('GOOGLE_SITE_VERIFICATION', ''),
  uploadDir: () => env('UPLOAD_DIR', isProd ? undefined : './data/uploads'),
  // Веб-пуш: ключи VAPID (npx web-push generate-vapid-keys). Без них пуш в браузер выключен.
  vapidPublic: () => env('VAPID_PUBLIC_KEY', ''),
  vapidPrivate: () => env('VAPID_PRIVATE_KEY', ''),
  vapidSubject: () => env('VAPID_SUBJECT', 'mailto:support@arenarabot.ru'),
  // Объектное хранилище S3 (если задан S3_BUCKET — файлы там, иначе в UPLOAD_DIR).
  s3Bucket: () => env('S3_BUCKET', ''),
  s3Endpoint: () => env('S3_ENDPOINT', 'https://storage.yandexcloud.net'),
  s3Region: () => env('S3_REGION', 'ru-central1'),
  s3AccessKey: () => env('S3_ACCESS_KEY'),
  s3SecretKey: () => env('S3_SECRET_KEY'),
  compressJson: () => env('COMPRESS_JSON', '1') === '1',
  dbPoolMax: () => Math.max(2, parseInt(env('DB_POOL_MAX', '10'), 10) || 10),
  dbStatementTimeoutMs: () => Math.max(1000, parseInt(env('DB_STATEMENT_TIMEOUT_MS', '15000'), 10) || 15000),
  // Вход через Яндекс ID и VK ID (server/oauth.ts). Пустой ID приложения — кнопки нет.
  yandexClientId: () => env('YANDEX_CLIENT_ID', ''),
  yandexClientSecret: () => env('YANDEX_CLIENT_SECRET', ''),
  vkClientId: () => env('VK_CLIENT_ID', ''),
  // Токен для /api/metrics (Prometheus). Пусто — метрики закрыты.
  metricsToken: () => env('METRICS_TOKEN', ''),
  // Новая редакция оферты и Правил — новая дата (её видно внизу документов и она сохраняется при регистрации).
  offerVersion: '2026-10-26',
  pdConsentVersion: '2026-10'
};
