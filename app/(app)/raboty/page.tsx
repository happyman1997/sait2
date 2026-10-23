import type { Metadata } from 'next';
import Link from 'next/link';
import { Crumbs, JsonLd, LinkChips, SeoPage } from '@/components/seo/Seo';
import sty from '@/components/seo/Seo.module.css';
import { AUTO_ACCEPT_DAYS, plural } from '@/lib/jobs';
import { breadcrumbsLd, CITY_MIN_JOBS, seoCatalog, SITE_NAME } from '@/server/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Подработка и разовые смены: все виды работ — ' + SITE_NAME,
  description: 'Сезонная подработка рядом с домом: уборка снега, покос травы, уборка листвы, погрузка, вывоз мусора и другие разовые смены. Ставка и дата видны сразу, отклик без резюме.',
  alternates: { canonical: '/raboty' }
};

// По сезонам — так люди и ищут: зимой снег, летом покос, осенью листва.
const SEASONS: [string, string[]][] = [
  ['Зима', ['snow', 'ice', 'roof', 'salt']],
  ['Весна', ['thaw', 'spring', 'green']],
  ['Лето', ['grass', 'water', 'trim', 'paint', 'facade']],
  ['Осень', ['leaves', 'harvest', 'winterize', 'dacha']],
  ['Круглый год', ['street', 'trash', 'load']]
];

/** Каталог: все виды подработки по сезонам с числом открытых заказов, города, частые вопросы. */
export default async function WorksHub() {
  const { works, cities, total } = await seoCatalog();
  const crumbs: [string, string][] = [['Главная', '/'], ['Подработка', '/raboty']];
  const cityLinks = cities.filter(c => c.count >= CITY_MIN_JOBS);
  return (
    <SeoPage>
      <JsonLd data={breadcrumbsLd(crumbs)} />
      <Crumbs items={[crumbs[0], ['Подработка']]} />
      <h1 className={sty.h1}>Подработка и разовые смены рядом с домом</h1>
      <p className={sty.lead}>
        Сезонная работа на карте: зимой — снег и наледь, весной и летом — благоустройство, покос и полив, осенью — листва
        и подготовка к зиме, круглый год — уборка, погрузка и вывоз мусора. У каждого заказа сразу видны ставка, дата и место.
        {total ? ' Сейчас открыто ' + total + ' ' + plural(total, 'заказ', 'заказа', 'заказов') + '.' : ''}
      </p>
      <div className={sty.actions}>
        <Link href="/?list=1" className="btn btn-primary">Заказы на карте</Link>
        <Link href="/auth?role=freelancer" className="btn btn-secondary">Создать профиль исполнителя</Link>
      </div>

      {SEASONS.map(([season, ids]) => (
        <section key={season}>
          <h2 className={sty.h2}>{season}</h2>
          <LinkChips items={ids.map(id => works.find(w => w.id === id)!).map(w => ({ href: '/raboty/' + w.slug, label: w.label, count: w.count }))} />
        </section>
      ))}

      {cityLinks.length > 0 && (
        <>
          <h2 className={sty.h2}>Подработка по городам</h2>
          <LinkChips items={cityLinks.map(c => ({ href: '/gorod/' + c.slug, label: c.name, count: c.count }))} />
        </>
      )}

      <h2 className={sty.h2}>Частые вопросы</h2>
      <div className={sty.faq}>
        <h3>Нужно ли резюме?</h3>
        <p>Нет. Заказы и условия видны без регистрации; профиль — имя, почта и город — спрашиваем только при отклике.</p>
        <h3>Как платят?</h3>
        <p>Напрямую заказчик исполнителю — способом из условий заказа: наличными в день выхода, переводом на карту, по чеку самозанятого или по договору. Сервис бесплатный: площадка деньги не держит и комиссию не берёт.</p>
        <h3>Как понять, что заказчику можно доверять?</h3>
        <p>В карточке видно, сколько заказов у заказчика на площадке и его отзывы от исполнителей. Залог или предоплату за выход просить запрещено — такие тексты площадка не пропускает.</p>
        <h3>Что если работу не приняли?</h3>
        <p>После сдачи работы у заказчика {AUTO_ACCEPT_DAYS} дней на приёмку; не ответил — смена закрывается и засчитывается исполнителю автоматически. По расчёту можно открыть спор — поддержка разберёт его по переписке и фото.</p>
        <h3>Я работодатель — как найти людей на смену?</h3>
        <p>Создайте профиль работодателя и поставьте заказ точкой на карте: тип работы, дата, объём и оплата. Исполнители поблизости получат уведомление, отклики появятся в карточке заказа.</p>
      </div>

      <div className={sty.cta}>
        <h2>Нужны люди на смену?</h2>
        <p>Разместите заказ — его увидят исполнители рядом, условия видны сразу.</p>
        <Link href="/auth?role=employer" className="btn">Разместить заказ</Link>
      </div>
    </SeoPage>
  );
}
