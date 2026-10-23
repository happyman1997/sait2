import type { MetadataRoute } from 'next';
import { WORK_PAGES } from '@/lib/seo';
import { config } from '@/server/config';
import { query } from '@/server/db';
import { CITY_MIN_JOBS, seoCatalog } from '@/server/seo';

// Список заказов меняется постоянно и берётся из базы — собирается при запросе (а не при сборке, где базы нет).
export const dynamic = 'force-dynamic';

const LEGAL = ['offer', 'rules', 'personal-data', 'consent'];

/**
 * Карта сайта для Яндекса и Google: главная, каталог видов работ, города с заказами, страницы открытых заказов
 * (/zakaz/N — на них canonical со ссылок карты), помощь и документы.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = config.publicUrl().replace(/\/$/, '');
  const fixed: MetadataRoute.Sitemap = [
    { url: base + '/', changeFrequency: 'hourly', priority: 1 },
    { url: base + '/raboty', changeFrequency: 'daily', priority: 0.8 },
    ...WORK_PAGES.map(w => ({ url: base + '/raboty/' + w.slug, changeFrequency: 'daily' as const, priority: 0.7 })),
    { url: base + '/help', changeFrequency: 'monthly', priority: 0.3 },
    ...LEGAL.map(p => ({ url: base + '/legal/' + p, changeFrequency: 'monthly' as const, priority: 0.2 }))
  ];
  try {
    const [cat, jobs] = await Promise.all([
      seoCatalog(),
      query<{ num: string; updated_at: Date }>(
        // Те же условия, что у выдачи на карте: открытые, дата не прошла, у серии — не прошёл последний выход.
        `SELECT num, updated_at FROM jobs
          WHERE status IN ('open', 'staffed')
            AND (date >= current_date OR (repeat IS NOT NULL AND (series_end IS NULL OR series_end >= current_date)))
          ORDER BY updated_at DESC LIMIT 10000`)
    ]);
    const cities = cat.cities.filter(c => c.count >= CITY_MIN_JOBS)
      .map(c => ({ url: base + '/gorod/' + c.slug, changeFrequency: 'daily' as const, priority: 0.6 }));
    return [...fixed, ...cities,
      ...jobs.rows.map(j => ({ url: base + '/zakaz/' + j.num, lastModified: j.updated_at, changeFrequency: 'daily' as const, priority: 0.6 }))];
  } catch (e) {
    console.error('[sitemap]', (e as Error).message);
    return fixed;
  }
}
