import type { MetadataRoute } from 'next';
import { config } from '@/server/config';

// Адрес сайта — из окружения сервера, поэтому файл собирается при запросе.
export const dynamic = 'force-dynamic';

// Поисковикам — карта, заказы и документы. Личные разделы и вход не индексируются; служебные API тоже,
// кроме выдачи заказов: по ней поисковик, который выполняет скрипты, видит карточку.
export default function robots(): MetadataRoute.Robots {
  const base = config.publicUrl().replace(/\/$/, '');
  return {
    rules: [{
      userAgent: '*',
      allow: ['/', '/legal/'],
      disallow: ['/auth', '/profile', '/mine', '/shift', '/apps', '/support', '/*apply=', '/api/auth/', '/api/me/', '/api/support/', '/api/metrics']
    }],
    sitemap: base + '/sitemap.xml'
  };
}
