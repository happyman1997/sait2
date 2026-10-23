// Страницы для поисковиков: заголовки и описания заказа, разметка schema.org (вакансия, хлебные крошки), каталог.
import type { Metadata } from 'next';
import { dateLabel, money, type JobDetail, type JobSummary } from '@/lib/jobs';
import { slugify, WORK_PAGES, workById } from '@/lib/seo';
import { config } from './config';
import { openJobCounts } from './jobs';
import { jobOgData, OG_SIZE, ogVersion } from './og';

export const SITE_NAME = 'Арена Работ';
export const siteUrl = () => config.publicUrl().replace(/\/$/, '');

/** Сегодня по часовому поясу сервиса (как дата «сегодня» у пользователей). */
export const todayLocal = () => new Date().toLocaleDateString('sv-SE', { timeZone: config.timeZone() });

export const jobPath = (num: number) => '/zakaz/' + num;
export const isOpenJob = (j: Pick<JobSummary, 'status'>) => j.status === 'open' || j.status === 'staffed';

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : s);

/** Заголовок, описание, превью и canonical заказа — общие для /zakaz/N и ссылки на карту /?job=N. */
export function jobMetadata(j: JobDetail): Metadata {
  const title = j.title + ' — ' + money(j.pay, j.unit) + ' · ' + j.address + ' — ' + SITE_NAME;
  const about = (j.repeat ? 'Серия выходов с ' : 'Выход ') + dateLabel(j.date) + '. ' + j.description.replace(/\s+/g, ' ').trim();
  const description = clip(about, 200);
  // Картинка-превью: оплата, вид работ, место, дата. Версия в адресе меняется вместе с условиями заказа.
  const images = [{ url: '/api/og/job/' + j.num + '?v=' + ogVersion(jobOgData(j)), ...OG_SIZE, alt: title }];
  return {
    title, description,
    alternates: { canonical: jobPath(j.num) },
    openGraph: { title, description, type: 'website', locale: 'ru_RU', siteName: SITE_NAME, url: jobPath(j.num), images },
    twitter: { card: 'summary_large_image', title, description, images },
    // Закрытые и отменённые заказы поисковикам не нужны, но ссылки с них (похожие заказы) — пусть ходят.
    robots: isOpenJob(j) ? undefined : { index: false, follow: true }
  };
}

const UNIT_TEXT: Record<string, string> = { 'за час': 'HOUR', 'за смену': 'DAY', 'за заказ': 'DAY' };

/** Вакансия в разметке schema.org (JobPosting): её читают Google и Яндекс. */
export function jobPostingLd(j: JobDetail) {
  const base = siteUrl();
  const unit = UNIT_TEXT[j.unit];
  // Разовый заказ действует до конца дня выхода; у серии — без даты окончания.
  const validThrough = j.repeat ? undefined : j.date + 'T23:59:59+03:00';
  const city = j.district || j.address.split(',')[0].trim();
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: j.title,
    description: [j.description, j.requirement && 'Условие работодателя: ' + j.requirement, j.tools && 'Инвентарь: ' + j.tools,
      j.payType && 'Оплата: ' + money(j.pay, j.unit) + ', ' + j.payType].filter(Boolean).join('\n'),
    identifier: { '@type': 'PropertyValue', name: SITE_NAME, value: String(j.num) },
    datePosted: j.createdAt,
    ...(validThrough ? { validThrough } : {}),
    employmentType: ['TEMPORARY', 'PER_DIEM'],
    hiringOrganization: { '@type': 'Organization', name: j.employer.name },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', streetAddress: j.address, addressLocality: city, addressCountry: 'RU' }
    },
    ...(unit ? { baseSalary: { '@type': 'MonetaryAmount', currency: 'RUB', value: { '@type': 'QuantitativeValue', value: j.pay, unitText: unit } } } : {}),
    directApply: true,
    url: base + jobPath(j.num)
  };
}

/** Хлебные крошки: [подпись, путь]; последняя — текущая страница. */
export function breadcrumbsLd(items: [string, string][]) {
  const base = siteUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + path }))
  };
}

/** Сайт и организация — для главной: название в выдаче и логотип. */
export function siteLd() {
  const base = siteUrl();
  return [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: base + '/', inLanguage: 'ru' },
    { '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: base + '/', logo: base + '/icon-192.png' }
  ];
}

/** Город на странице «Подработка в …» — только с 3+ открытыми заказами: тоньше — не индексируем. */
export const CITY_MIN_JOBS = 3;

/** Каталог: справочные виды работ и города с числом открытых заказов. */
export async function seoCatalog(today = todayLocal()) {
  const rows = await openJobCounts(today);
  const byType = new Map<string, number>();
  const byCity = new Map<string, { name: string; n: number }>();
  for (const r of rows) {
    byType.set(r.type_id, (byType.get(r.type_id) || 0) + r.n);
    if (!r.city) continue;
    const k = r.city.toLowerCase();
    const c = byCity.get(k) || { name: r.city, n: 0 };
    c.n += r.n;
    byCity.set(k, c);
  }
  const works = WORK_PAGES.map(w => ({ ...w, count: byType.get(w.id) || 0 }));
  const cities = [...byCity.values()].map(c => ({ name: c.name, slug: slugify(c.name), count: c.n }))
    .filter(c => c.slug).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));
  const total = rows.reduce((n, r) => n + r.n, 0);
  return { works, cities, total, rows };
}

/** Города, где есть заказы этого вида — для ссылок со страницы вида работ. */
export function citiesFor(typeId: string, rows: { type_id: string; city: string | null; n: number }[]) {
  const m = new Map<string, { name: string; n: number }>();
  for (const r of rows) if (r.type_id === typeId && r.city) {
    const k = r.city.toLowerCase();
    const c = m.get(k) || { name: r.city, n: 0 };
    c.n += r.n; m.set(k, c);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

export const workLink = (typeId: string) => { const w = workById(typeId); return w ? '/raboty/' + w.slug : null; };
