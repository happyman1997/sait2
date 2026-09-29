// Реклама с маркировкой: показываем только креативы с erid, пометкой «Реклама» и названием рекламодателя (38-ФЗ ст. 18.1).
// Показы и клики копятся по дням — эти цифры передаются в ЕРИР через оператора рекламных данных.

import { one, query } from './db';
import { AppError } from './errors';
import { localClock } from './events';

export type Ad = { id: string; advertiser: string; title: string; line: string; cta: string; erid: string };
export type Placement = 'feed' | 'profile';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Активные креативы площадки для роли зрителя; порядок — случайный с учётом веса. */
export async function pickAds(place: unknown, role: 'freelancer' | 'employer' | null, limit = 1): Promise<Ad[]> {
  if (place !== 'feed' && place !== 'profile') throw new AppError(404, 'Нет такого места для рекламы.');
  const r = await query<Ad>(
    `SELECT id, advertiser, title, line, cta, erid FROM ads
      WHERE active AND placement = $1 AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
        AND (audience IS NULL OR audience = $2)
      ORDER BY -ln(1 - random()) / weight
      LIMIT $3`, [place, role, Math.min(3, Math.max(1, limit))]);
  return r.rows;
}

const today = () => localClock().day;

/** Показ (браузер шлёт один раз за показ страницы). */
export async function countView(ids: unknown) {
  const list = (Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 5);
  if (!list.length) return;
  await query(
    `INSERT INTO ad_daily (ad_id, day, impressions)
     SELECT a.id, $2::date, 1 FROM ads a WHERE a.id = ANY($1::uuid[])
     ON CONFLICT (ad_id, day) DO UPDATE SET impressions = ad_daily.impressions + 1`, [list, today()]);
}

/** Клик: считаем и возвращаем адрес рекламодателя (только сохранённый — открытого редиректа нет). */
export async function clickAd(id: string): Promise<string> {
  if (!UUID_RE.test(id)) throw new AppError(404, 'Объявление не найдено.');
  const ad = await one<{ url: string; erid: string }>('SELECT url, erid FROM ads WHERE id = $1', [id]);
  if (!ad) throw new AppError(404, 'Объявление не найдено.');
  await query(
    `INSERT INTO ad_daily (ad_id, day, clicks) VALUES ($1, $2::date, 1)
     ON CONFLICT (ad_id, day) DO UPDATE SET clicks = ad_daily.clicks + 1`, [id, today()]);
  const u = new URL(ad.url);
  if (!u.searchParams.has('erid')) u.searchParams.set('erid', ad.erid);
  return u.toString();
}

/** Отчёт за период: показы и клики по креативам. */
export async function adReport(from: string, to: string) {
  const r = await query<{ erid: string; advertiser: string; title: string; impressions: number; clicks: number }>(
    `SELECT a.erid, a.advertiser, a.title, coalesce(sum(d.impressions), 0)::int AS impressions, coalesce(sum(d.clicks), 0)::int AS clicks
       FROM ads a LEFT JOIN ad_daily d ON d.ad_id = a.id AND d.day BETWEEN $1::date AND $2::date
      GROUP BY a.id ORDER BY a.created_at`, [from, to]);
  return r.rows;
}

