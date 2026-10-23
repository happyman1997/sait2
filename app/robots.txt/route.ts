import { config } from '@/server/config';

// Адрес сайта — из окружения сервера, поэтому файл собирается при запросе.
export const dynamic = 'force-dynamic';

/**
 * robots.txt текстом (а не app/robots.ts): нужен Clean-param для Яндекса — метки рекламы и служебные признаки
 * ссылок не размножают страницы в индексе. Поисковикам — карта, заказы, виды работ, города и документы;
 * личные разделы, вход и API — нет (кроме картинок-превью).
 */
export function GET() {
  const base = config.publicUrl().replace(/\/$/, '');
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /auth',
    'Disallow: /profile',
    'Disallow: /mine',
    'Disallow: /shift',
    'Disallow: /apps',
    'Disallow: /support',
    'Disallow: /*apply=',
    'Allow: /api/og/',
    'Disallow: /api/',
    '',
    'User-agent: Yandex',
    'Allow: /',
    'Disallow: /auth',
    'Disallow: /profile',
    'Disallow: /mine',
    'Disallow: /shift',
    'Disallow: /apps',
    'Disallow: /support',
    'Disallow: /*apply=',
    'Allow: /api/og/',
    'Disallow: /api/',
    'Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid&fbclid&from',
    'Clean-param: list&new /',
    '',
    'Sitemap: ' + base + '/sitemap.xml',
    ''
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
