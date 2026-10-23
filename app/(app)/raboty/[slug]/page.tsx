import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Crumbs, JobCards, JsonLd, LinkChips, SeoPage } from '@/components/seo/Seo';
import sty from '@/components/seo/Seo.module.css';
import { plural } from '@/lib/jobs';
import { slugify, WORK_INFO, WORK_PAGES, workBySlug } from '@/lib/seo';
import { publicJobs } from '@/server/jobs';
import { breadcrumbsLd, CITY_MIN_JOBS, citiesFor, seoCatalog, SITE_NAME, todayLocal } from '@/server/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

const work = async (props: Props) => workBySlug((await props.params).slug) ?? notFound();
const ordersWord = (n: number) => n + ' ' + plural(n, 'заказ', 'заказа', 'заказов');

export async function generateMetadata(props: Props): Promise<Metadata> {
  const w = await work(props);
  const info = WORK_INFO[w.id];
  const { works } = await seoCatalog();
  const n = works.find(x => x.id === w.id)?.count || 0;
  const first = info.about.split(/(?<=\.)\s/)[0];
  return {
    title: w.label + ': подработка и разовые смены — ' + SITE_NAME,
    description: first + (n ? ' Сейчас открыто ' + ordersWord(n) + '.' : '') + ' Ставка и дата видны сразу, отклик без резюме.',
    alternates: { canonical: '/raboty/' + w.slug }
  };
}

/** Вид работ: что за работа, что обычно делают и что взять, открытые заказы, города, другие виды. */
export default async function WorkPage(props: Props) {
  const w = await work(props);
  const info = WORK_INFO[w.id];
  const today = todayLocal();
  const [jobs, cat] = await Promise.all([publicJobs({ typeId: w.id, limit: 30 }, today), seoCatalog(today)]);
  const n = cat.works.find(x => x.id === w.id)?.count || 0;
  const cities = citiesFor(w.id, cat.rows);
  // Город со своей страницей (3+ заказов) — ссылкой, остальные — просто списком.
  const cityPages = new Set(cat.cities.filter(c => c.count >= CITY_MIN_JOBS).map(c => c.slug));
  const linked = cities.filter(c => cityPages.has(slugify(c.name)));
  const plain = cities.filter(c => !cityPages.has(slugify(c.name)));
  const crumbs: [string, string][] = [['Главная', '/'], ['Подработка', '/raboty'], [w.label, '/raboty/' + w.slug]];
  const lower = w.label.charAt(0).toLowerCase() + w.label.slice(1);

  return (
    <SeoPage>
      <JsonLd data={breadcrumbsLd(crumbs)} />
      <Crumbs items={[crumbs[0], crumbs[1], [w.label]]} />
      <h1 className={sty.h1}>{w.label}: подработка и разовые смены</h1>
      <p className={sty.lead}>{info.about}</p>
      <p className={sty.muted} style={{ marginTop: 8 }}>
        Сезон: {info.season}. {n ? 'Сейчас открыто ' + ordersWord(n) + '.' : 'Сейчас открытых заказов нет.'}
      </p>

      <h2 className={sty.h2}>{n ? 'Заказы сейчас' : 'Заказов пока нет'}</h2>
      {jobs.length > 0 ? (
        <>
          <JobCards jobs={jobs} />
          {n > jobs.length && <p className={sty.muted} style={{ marginTop: 10 }}>Показаны {jobs.length} из {n} — остальные на карте.</p>}
        </>
      ) : (
        <p className={sty.text}>
          Новые заказы на {lower} появляются в сезон, часто — за день до выхода. Создайте профиль исполнителя
          и укажите район: о новых заказах рядом придёт уведомление.
        </p>
      )}
      <div className={sty.actions}>
        <Link href="/?list=1" className="btn btn-primary">Все заказы на карте</Link>
        <Link href="/auth?role=freelancer" className="btn btn-secondary">Создать профиль исполнителя</Link>
      </div>

      <h2 className={sty.h2}>Что обычно нужно сделать</h2>
      <ul className={sty.list}>{info.tasks.map(t => <li key={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</li>)}</ul>
      <h2 className={sty.h2}>Что взять с собой</h2>
      <p className={sty.text}>{info.bring.charAt(0).toUpperCase() + info.bring.slice(1)}.</p>
      <p className={sty.text}>
        Ставка, дата, объём и способ оплаты видны в карточке заказа сразу — до отклика. Профиль спрашиваем только при отклике,
        после найма откроются чат с заказчиком и телефон встречающего.
      </p>

      {cities.length > 0 && (
        <>
          <h2 className={sty.h2}>Где есть заказы</h2>
          {linked.length > 0 && <LinkChips items={linked.map(c => ({ href: '/gorod/' + slugify(c.name), label: c.name, count: c.n }))} />}
          {plain.length > 0 && <p className={sty.muted} style={{ marginTop: 8 }}>{linked.length ? 'Ещё: ' : ''}{plain.map(c => c.name).join(', ')}.</p>}
        </>
      )}

      <div className={sty.cta}>
        <h2>Нужны люди на {lower}?</h2>
        <p>Опубликуйте заказ точкой на карте — его увидят исполнители рядом. Ставка, дата и условия видны сразу, лишних звонков меньше.</p>
        <Link href="/auth?role=employer" className="btn btn-secondary">Разместить заказ</Link>
      </div>

      <h2 className={sty.h2}>Другие виды подработки</h2>
      <LinkChips items={WORK_PAGES.filter(x => x.id !== w.id).map(x => ({ href: '/raboty/' + x.slug, label: x.label, count: cat.works.find(c => c.id === x.id)?.count }))} />
    </SeoPage>
  );
}
