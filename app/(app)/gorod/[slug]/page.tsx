import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Crumbs, JobCards, JsonLd, LinkChips, SeoPage } from '@/components/seo/Seo';
import sty from '@/components/seo/Seo.module.css';
import { plural } from '@/lib/jobs';
import { cityPhrase, inCity, WORK_PAGES } from '@/lib/seo';
import { publicJobs } from '@/server/jobs';
import { breadcrumbsLd, CITY_MIN_JOBS, seoCatalog, SITE_NAME, todayLocal } from '@/server/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

// Город — только тот, где сейчас есть открытые заказы; иначе 404 (страница пустого города никому не нужна).
async function city(props: Props) {
  const slug = (await props.params).slug;
  const cat = await seoCatalog();
  const c = cat.cities.find(x => x.slug === slug);
  return c ? { c, cat } : notFound();
}
const ordersWord = (n: number) => n + ' ' + plural(n, 'заказ', 'заказа', 'заказов');

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { c } = await city(props);
  return {
    title: cityPhrase('Подработка', c.name) + ': разовые смены рядом с домом — ' + SITE_NAME,
    description: 'Разовые смены и сезонная подработка ' + (inCity(c.name) || '— ' + c.name) + ': открыто ' + ordersWord(c.count) +
      '. Уборка снега, покос, благоустройство, погрузка — ставка и дата видны сразу, отклик без резюме.',
    alternates: { canonical: '/gorod/' + c.slug },
    // Мало заказов — тонкая страница: ссылки по ней пусть ходят, в индекс — не нужно.
    robots: c.count < CITY_MIN_JOBS ? { index: false, follow: true } : undefined
  };
}

/** Город: открытые заказы и виды работ, по которым они есть. */
export default async function CityPage(props: Props) {
  const { c, cat } = await city(props);
  const jobs = await publicJobs({ city: c.name, limit: 40 }, todayLocal());
  const types = new Map<string, number>();
  for (const r of cat.rows) if (r.city && r.city.toLowerCase() === c.name.toLowerCase()) types.set(r.type_id, (types.get(r.type_id) || 0) + r.n);
  const works = WORK_PAGES.filter(w => types.has(w.id)).map(w => ({ href: '/raboty/' + w.slug, label: w.label, count: types.get(w.id) }));
  const crumbs: [string, string][] = [['Главная', '/'], ['Подработка', '/raboty'], [c.name, '/gorod/' + c.slug]];
  return (
    <SeoPage>
      <JsonLd data={breadcrumbsLd(crumbs)} />
      <Crumbs items={[crumbs[0], crumbs[1], [c.name]]} />
      <h1 className={sty.h1}>{cityPhrase('Подработка', c.name)}</h1>
      <p className={sty.lead}>
        Разовые смены и сезонная работа {inCity(c.name) || '— ' + c.name}: заказчики ставят их точкой на карте, исполнители
        откликаются рядом с домом. Сейчас открыто {ordersWord(c.count)}.
      </p>
      {works.length > 0 && (
        <>
          <h2 className={sty.h2}>Виды работ</h2>
          <LinkChips items={works} />
        </>
      )}
      <h2 className={sty.h2}>Заказы сейчас</h2>
      <JobCards jobs={jobs} />
      <div className={sty.actions}>
        <Link href="/?list=1" className="btn btn-primary">Все заказы на карте</Link>
        <Link href="/auth?role=freelancer" className="btn btn-secondary">Создать профиль исполнителя</Link>
      </div>
      <div className={sty.cta}>
        <h2>Нужны люди на смену {inCity(c.name) || '— ' + c.name}?</h2>
        <p>Разместите заказ точкой на карте — исполнители поблизости получат уведомление.</p>
        <Link href="/auth?role=employer" className="btn">Разместить заказ</Link>
      </div>
    </SeoPage>
  );
}
