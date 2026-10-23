// Общие блоки страниц для поисковиков (заказ, виды работ, города): обёртка, крошки, разметка, карточки заказов.
// Всё рендерится на сервере — текст есть в HTML и без выполнения скриптов.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DocLinks } from '@/components/DocLinks';
import { dateLabel, jobNum, jobStatus, money, shortTitle, type JobSummary } from '@/lib/jobs';
import { ldJson } from '@/lib/seo';
import sty from './Seo.module.css';

export function SeoPage({ children }: { children: ReactNode }) {
  return (
    <div className={sty.page}>
      <div className={sty.inner}>
        {children}
        <DocLinks style="margin-top: 40px" />
      </div>
    </div>
  );
}

/** Хлебные крошки: [подпись, путь]; у последней пути нет — это текущая страница. */
export function Crumbs({ items }: { items: [string, string?][] }) {
  return (
    <nav aria-label="Навигация" className={sty.crumbs}>
      <ol>
        {items.map(([label, href], i) => (
          <li key={i}>{href ? <Link href={href}>{label}</Link> : <span aria-current="page">{label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(data) }} />;
}

/** Карточки заказов со ссылками на их страницы: ставка, вид работ, адрес, дата. */
export function JobCards({ jobs }: { jobs: JobSummary[] }) {
  return (
    <ul className={sty.cards}>
      {jobs.map(j => {
        const s = jobStatus(j, null);
        return (
          <li key={j.num}>
            <Link href={'/zakaz/' + j.num} className={sty.card}>
              <span className={sty.cardTop}>
                <span className={sty.cardNum}>№ {jobNum(j.num)}</span>
                <span className={sty.cardPay}>{money(j.pay, j.unit)}</span>
              </span>
              <span className={sty.cardTitle}>{shortTitle(j.title, j.address)}</span>
              <span className={sty.cardMeta}>{j.address} · {j.repeat ? 'с ' + dateLabel(j.date) + ', ' + j.repeat : dateLabel(j.date)}</span>
              <span className={sty.cardTags}><span className={s.cls}>{s.label}</span></span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Ссылки-«чипы»: виды работ или города. */
export function LinkChips({ items }: { items: { href: string; label: string; count?: number }[] }) {
  return (
    <ul className={sty.chips}>
      {items.map(i => (
        <li key={i.href}><Link href={i.href} className={sty.chip}>{i.label}{i.count ? <span className={sty.chipN}>{i.count}</span> : null}</Link></li>
      ))}
    </ul>
  );
}
