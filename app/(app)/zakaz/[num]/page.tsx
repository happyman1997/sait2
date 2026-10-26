import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Crumbs, JobCards, JsonLd, SeoPage } from '@/components/seo/Seo';
import sty from '@/components/seo/Seo.module.css';
import { crewOf, dateLabel, jobNum, jobStatus, money, type JobDetail } from '@/lib/jobs';
import { WORK_INFO, workById } from '@/lib/seo';
import { AppError } from '@/server/errors';
import { currentUser } from '@/server/http';
import { getJob, publicJobs } from '@/server/jobs';
import { breadcrumbsLd, isOpenJob, jobMetadata, jobPostingLd, localDate, todayLocal, workPath } from '@/server/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ num: string }> };

const numOf = (raw: string) => { const n = Number(raw); return Number.isSafeInteger(n) && n > 0 && String(n) === raw ? n : null; };

// Гостевая карточка: у частного заказчика — без дома и имени, как на карте. Нет заказа — 404.
async function load(raw: string): Promise<JobDetail> {
  const num = numOf(raw);
  if (!num) notFound();
  try { return await getJob(num, null); } catch (e) { if (e instanceof AppError && e.status === 404) notFound(); throw e; }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return jobMetadata(await load((await params).num));
}

/**
 * Страница заказа для поисковиков и тех, кто пришёл из поиска: все условия текстом в HTML, разметка вакансии,
 * похожие заказы. Откликнуться и посмотреть на карте — кнопками (карточка на карте — /?job=N).
 */
export default async function JobPage({ params }: Props) {
  const j = await load((await params).num);
  const u = await currentUser();
  const today = todayLocal();
  const open = isOpenJob(j);
  const crew = crewOf(j);
  const full = j.hired >= crew;
  const s = jobStatus(j, null);
  const work = workById(j.typeId);
  const info = work ? WORK_INFO[work.id] : null;

  let similar = await publicJobs({ typeId: j.typeId, notNum: j.num, limit: 6 }, today);
  if (similar.length < 3 && j.district) {
    const near = await publicJobs({ city: j.district, notNum: j.num, limit: 6 }, today);
    similar = [...similar, ...near.filter(x => !similar.some(y => y.num === x.num))].slice(0, 6);
  }

  // Гость — регистрация с откликом на этот заказ; исполнитель — сразу отклик в карточке; работодателю откликаться
  // не на что — у него только «Показать на карте».
  const applyHref = !u ? '/auth?apply=' + j.num : u.role === 'freelancer' ? '/?job=' + j.num + '&apply=1' : null;
  const hiring = open && !full;
  const when = j.repeat ? 'с ' + dateLabel(j.date) : dateLabel(j.date);
  const specs: [string, string][] = [
    ['Адрес', j.addressHidden ? j.address + ' (частный заказчик: дом и точная метка — после найма)' : j.address],
    ['Дата выхода', when],
    ['Повтор', j.repeat ? j.repeat + (j.repeatNote ? ' · ' + j.repeatNote : '') : 'разовый выход'],
    ...(crew > 1 ? [['Людей в смене', crew === Infinity ? 'сколько угодно' : crew + ' чел.'] as [string, string]] : []),
    ['Объём', j.volume || 'по договорённости'],
    ['Оплата', money(j.pay, j.unit)],
    ['Способ оплаты', j.payType || 'по договорённости'],
    ...(j.requirement ? [['Условие работодателя', j.requirement] as [string, string]] : []),
    ['Инвентарь', j.tools || 'уточняется у работодателя'],
    ['Заказчик', j.employer.name + (j.employer.jobs > 1 ? ' · заказов на площадке: ' + j.employer.jobs : '')],
    ['Опубликован', dateLabel(localDate(j.createdAt))]
  ];
  // Вид работ в крошках — и справочный, и свой (у своего тоже есть страница).
  const typePath = await workPath(j.typeId);
  const crumbs: [string, string][] = [['Главная', '/'], ['Подработка', '/raboty'],
    ...(typePath ? [[j.typeLabel, typePath] as [string, string]] : []), ['Заказ ' + jobNum(j.num), '/zakaz/' + j.num]];

  return (
    <SeoPage>
      {/* Вакансия в разметке — только пока идёт набор: закрытые и набранные Google просит не размечать. */}
      {hiring && <JsonLd data={jobPostingLd(j)} />}
      <JsonLd data={breadcrumbsLd(crumbs)} />
      <Crumbs items={crumbs.map(([l, h], i) => [l, i < crumbs.length - 1 ? h : undefined])} />

      <h1 className={sty.h1}>{j.title}</h1>
      <div className={sty.tags}>
        <span className="tag tag-accent">{j.typeLabel}</span>
        {j.urgent && open && <span className="tag tag-accent">Срочно</span>}
        <span className={s.cls}>{s.label}</span>
      </div>

      {!open && <div className={sty.closed}>Заказ закрыт — посмотрите похожие ниже или все заказы на карте.</div>}
      {open && full && <div className={sty.closed}>Исполнитель уже найден — отклики на этот заказ не принимаются. Похожие заказы — ниже.</div>}

      <div className={sty.payBox}>
        <div className={sty.pay}>{money(j.pay, j.unit)}</div>
        <div className={sty.payNote}>{(j.repeat ? 'Серия выходов ' : 'Выход ') + when}{j.payType ? ' · ' + j.payType : ''}</div>
      </div>
      <div className={sty.actions}>
        {hiring && applyHref && <Link href={applyHref} className="btn btn-primary">Откликнуться</Link>}
        <Link href={'/?job=' + j.num} className="btn btn-secondary">Показать на карте</Link>
      </div>

      <h2 className={sty.h2}>Что нужно сделать</h2>
      <div className={sty.text + ' ' + sty.desc}>{j.description}</div>

      <dl className={sty.specs}>
        {specs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <p className={sty.muted} style={{ marginTop: 12 }}>
        Отклик — без резюме: профиль спросим только при отклике. После найма откроются чат с заказчиком и телефон встречающего.
        Расчёт — напрямую с заказчиком, способом из условий заказа.
      </p>

      {info && work && (
        <>
          <h2 className={sty.h2}>{work.label}: что взять с собой</h2>
          <p className={sty.text}>{info.bring.charAt(0).toUpperCase() + info.bring.slice(1)}. <Link href={'/raboty/' + work.slug}>Все заказы «{work.label}» →</Link></p>
        </>
      )}

      {similar.length > 0 && (
        <>
          <h2 className={sty.h2}>Похожие заказы</h2>
          <JobCards jobs={similar} />
        </>
      )}
    </SeoPage>
  );
}
