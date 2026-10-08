import type { MetadataRoute } from 'next';
import { config } from '@/server/config';
import { query } from '@/server/db';

// Список заказов меняется постоянно и берётся из базы — собирается при запросе (а не при сборке, где базы нет).
export const dynamic = 'force-dynamic';

const LEGAL = ['offer', 'rules', 'personal-data', 'consent'];

/** Карта сайта для Яндекса и Google: главная, документы и заказы, которые сейчас в поиске. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = config.publicUrl().replace(/\/$/, '');
  const fixed: MetadataRoute.Sitemap = [
    { url: base + '/', changeFrequency: 'hourly', priority: 1 },
    ...LEGAL.map(p => ({ url: base + '/legal/' + p, changeFrequency: 'monthly' as const, priority: 0.2 }))
  ];
  try {
    const jobs = await query<{ num: string; updated_at: Date }>(
      // Те же условия, что у выдачи на карте: открытые, дата не прошла, у серии — не прошёл последний выход.
      `SELECT num, updated_at FROM jobs
        WHERE status IN ('open', 'staffed')
          AND (date >= current_date OR (repeat IS NOT NULL AND (series_end IS NULL OR series_end >= current_date)))
        ORDER BY updated_at DESC LIMIT 10000`);
    return [...fixed, ...jobs.rows.map(j => ({ url: base + '/?job=' + j.num, lastModified: j.updated_at, changeFrequency: 'daily' as const, priority: 0.6 }))];
  } catch (e) {
    console.error('[sitemap]', (e as Error).message);
    return fixed;
  }
}
