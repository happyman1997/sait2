'use client';

// «Мои смены» (исполнитель) и «Мои заказы» (работодатель): этапы Отклик → Найм → Работа принята.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { css } from '@/lib/css';
import { dateLabel, isSeries, jobNum, jobStatus, localISO, money, plural, seriesDayLabel, type JobDetail, type MyJob } from '@/lib/jobs';
import { useFlash } from '@/components/Toast';
import { useLive, useLiveEvent } from './Live';
import { Corners } from './ui';
import sty from './MyJobsPage.module.css';

const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400000));

/** Исполнитель пришёл в серию заменой на отдельные дни (без отклика на всю серию). */
const isSubOnly = (j: MyJob, emp: boolean) => !emp && j.myStatus !== 'hired' && j.subDays.length > 0;
const dayList = (xs: MyJob['subDays']) => xs.map(d => seriesDayLabel(d.day)).join(', ');

function subTrack(j: MyJob) {
  const hired = j.subDays.filter(d => d.status === 'hired');
  const sent = j.subDays.filter(d => d.status === 'sent');
  const today = localISO();
  const done = hired.length > 0 && (j.status === 'accepted' || hired.every(d => d.day < today));
  const stages = [
    { label: 'Отклик на замену', ok: true },
    { label: 'Взяли на день', ok: hired.length > 0 },
    { label: 'Выход отработан', ok: done }
  ];
  const off = j.status === 'cancelled' || (!hired.length && !sent.length);
  const cur = off ? -2 : stages.findIndex(s => !s.ok);
  const note = j.cancellation
    ? 'Серия отменена работодателем · ' + j.cancellation.reason + '.'
    : off ? 'Работодатель выбрал другого исполнителя на ' + dayList(j.subDays) + '.'
      : done ? 'Выход отработан. Расчёт — как договорились с работодателем в чате.'
        : hired.length ? 'Вы выходите на замену: ' + dayList(hired) + '. Время и место встречи — в чате; работу за смену сдаёт основной состав.' + (sent.length ? ' Ждём решения по: ' + dayList(sent) + '.' : '')
          : 'Отклик на замену ' + dayList(sent) + ' у работодателя — ждём решения.';
  return { stages, off, cur, note, reported: false };
}

function track(j: MyJob, emp: boolean) {
  if (isSubOnly(j, emp)) return subTrack(j);
  const accepted = j.status === 'accepted';
  const hiredMe = !emp && j.myStatus === 'hired';
  const stages = emp
    ? [
      { label: 'Отклики', ok: j.applicants > 0 || j.hired > 0 || accepted },
      { label: 'Нанят исполнитель', ok: j.hired > 0 || accepted },
      { label: j.autoAccepted ? 'Закрыта автоматически' : 'Работа принята', ok: accepted }
    ]
    : [
      { label: 'Отклик отправлен', ok: true },
      { label: 'Вас наняли', ok: hiredMe },
      { label: j.autoAccepted ? 'Закрыта автоматически' : 'Работа принята', ok: accepted && hiredMe }
    ];
  const off = emp
    ? j.status === 'cancelled'
    : j.status === 'cancelled' || j.myStatus === 'withdrawn' || j.myStatus === 'rejected';
  const cur = off ? -2 : stages.findIndex(s => !s.ok);
  const left = j.autoAcceptAt ? daysLeft(j.autoAcceptAt) + ' ' + plural(daysLeft(j.autoAcceptAt), 'день', 'дня', 'дней') : '';
  const reported = !!j.reportedAt;
  const offNote = j.cancellation
    ? 'Смена отменена работодателем · ' + j.cancellation.reason + ', ' + new Date(j.cancellation.at).toLocaleDateString('ru-RU') + '. Отклики закрыты.'
    : j.noShow ? 'Работодатель отметил «Не вышел» — вы сняты со смены.'
      : j.withdrawal ? 'Вы отказались от смены · ' + j.withdrawal.reason + ', ' + new Date(j.withdrawal.at).toLocaleDateString('ru-RU') + '. Можно откликнуться снова, если заказ ещё открыт.'
        : j.myStatus === 'withdrawn' ? 'Вы отозвали отклик — без пометки в профиле.'
          : 'Работодатель выбрал другого исполнителя.';
  const notes = [
    emp ? 'Откликов пока нет — заказ виден на карте.' : 'Отклик у работодателя — ждём решения.',
    emp ? 'Выберите исполнителя во вкладке «Отклики».' : 'Работодатель ещё не принял решение. Чат откроется после найма.',
    isSeries(j.repeat)
      ? (emp ? 'Серия идёт: выходы сдаются и принимаются по дням в карточке заказа — там же «Завершить серию».' : 'Серия идёт: каждый выход сдаёте в карточке заказа — «Сдать день».')
      : emp
      ? (reported ? 'Исполнитель сдал работу. Примите её — осталось ' + left + ', потом смена закроется автоматически и будет засчитана исполнителю.' : 'Примите работу — смена закроется, и можно будет оценить исполнителя.')
      : (reported ? 'Работа сдана. Если работодатель не ответит ещё ' + left + ', смена закроется и будет засчитана вам.' : 'Когда закончите — нажмите «Сдать работу». У работодателя будет 7 дней на приёмку.')
  ];
  const note = off ? offNote : cur < 0
    ? (j.autoAccepted
      ? (isSeries(j.repeat) ? 'Серия закрылась автоматически через 7 дней после последнего выхода.' : 'Смена закрыта автоматически: работодатель не ответил 7 дней. Засчитана исполнителю.')
      : isSeries(j.repeat) ? 'Серия завершена.' : 'Смена закрыта — работа принята.')
    : notes[cur];
  return { stages, off, cur, note, reported };
}

export function MyJobsPage({ role }: { role: 'freelancer' | 'employer' }) {
  const emp = role === 'employer';
  const flash = useFlash();
  const { openChat, setDock } = useLive();
  const [jobs, setJobs] = useState<MyJob[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ jobs: MyJob[] }>('/api/me/jobs').then(r => setJobs(r.jobs)).catch(e => flash(e instanceof ApiError ? e.message : 'Не удалось загрузить список'));
  }, [flash]);
  useEffect(load, [load]);
  useLiveEvent(e => { if (e.t === 'job' || e.t === 'resync') load(); });

  const act = async (num: number, path: string, ok: string) => {
    setBusy(true);
    try { await api<{ job: JobDetail }>('/api/jobs/' + num + '/' + path, {}); flash(ok); load(); }
    catch (e) { flash(e instanceof ApiError ? e.message : 'Не получилось — попробуйте ещё раз'); }
    finally { setBusy(false); }
  };

  return (
    <div className={sty.c04b825c}>
      <h2 className={sty.c197cab9}>{emp ? 'Мои заказы' : 'Мои смены'}</h2>
      {!jobs && <div className={sty.c816d564}>Загружаем…</div>}
      <div className={sty.c82a9418}>
        {jobs?.map(j => {
          const sub = isSubOnly(j, emp);
          const subLive = sub && j.status !== 'cancelled' && j.status !== 'accepted';
          const subOpen = j.subDays.filter(d => d.status !== 'rejected');
          const subShown = subOpen.length ? subOpen : j.subDays;
          const s = subLive && j.subDays.some(d => d.status === 'hired') ? { label: 'Вы на замене', cls: 'tag tag-neutral' }
            : subLive && j.subDays.some(d => d.status === 'sent') ? { label: 'Вы откликнулись', cls: 'tag tag-accent' }
              : jobStatus(j, role);
          const t = track(j, emp);
          const hasNext = !sub && t.cur >= 0 && (emp ? t.cur === 1 || t.cur === 2 : t.cur === 2 && !t.reported);
          return (
            <div key={j.num} className={'card blueprint ' + sty.c082f045}>
              <Corners />
              <div className={sty.c6dae14f}>
                <div className={'fh ' + sty.c9f4231f}>{jobNum(j.num)}</div>
                <div className={sty.c1dddb55}>
                  <div className={'fh ' + sty.c10a0e6b}>{j.title}</div>
                  <div className={sty.c6490c3f}>{j.address} · {sub ? 'замена ' + dayList(subShown) : dateLabel(j.date)}</div>
                  <div className={sty.c9e6b1c6}>
                    <span className={s.cls}>{s.label}</span>
                    <span className={sty.cdde3848}>
                      {emp ? j.applicants + ' ' + plural(j.applicants, 'отклик', 'отклика', 'откликов') + (j.counterpart ? ' · нанят: ' + j.counterpart : '') : 'работодатель ' + j.counterpart}
                    </span>
                  </div>
                </div>
                <div className={sty.c30489cb}>
                  <div className={'fh ' + sty.cade7558}>{money(j.pay, j.unit)}</div>
                  <div className={sty.c9a16b17}>
                    <Link href={'/?job=' + j.num} className={'btn btn-secondary ' + sty.c7730a85}>На карте</Link>
                    {j.hasChat && <button className={'btn btn-secondary ' + sty.c7730a85} onClick={() => (j.chatThread ? openChat(j.num, j.chatThread) : setDock({ open: true, view: 'list' }))}>Чат</button>}
                  </div>
                </div>
              </div>
              <div className={sty.ce672ace}>
                {t.stages.map((st, i) => (
                  <div key={st.label} style={css(t.off
                    ? 'flex: 1; min-width: 0; padding: 7px 9px; border: 1px dashed var(--color-divider); background: transparent; color: color-mix(in srgb, var(--color-text) 50%, transparent); font-size: 12.5px; line-height: 1.25; text-decoration: line-through'
                    : 'flex: 1; min-width: 0; padding: 7px 9px; border: 1px solid ' + (st.ok ? 'var(--color-accent)' : i === t.cur ? 'color-mix(in srgb, var(--color-accent) 40%, var(--color-divider))' : 'var(--color-divider)') +
                      '; background: ' + (st.ok ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent') +
                      '; color: ' + (st.ok ? 'var(--color-accent-900)' : i === t.cur ? 'color-mix(in srgb, var(--color-text) 72%, transparent)' : 'color-mix(in srgb, var(--color-text) 58%, transparent)') + '; font-size: 12.5px; line-height: 1.25')}>
                    <div className={'fh ' + sty.c945e30f}>{t.off ? '×' : st.ok ? '✓' : String(i + 1)}</div>
                    <div className={sty.c46a7c4f}>{st.label}</div>
                  </div>
                ))}
              </div>
              <div className={sty.cc626c4c}>
                <span className={sty.ce3c4e73}>{t.note}</span>
                {hasNext && (emp && t.cur === 1
                  ? <Link href="/apps" className={'btn btn-primary ' + sty.ca52b2a4}>Смотреть отклики</Link>
                  : isSeries(j.repeat)
                  ? <Link href={'/?job=' + j.num} className={'btn btn-primary ' + sty.c2792902}>Серия выходов</Link>
                  : <button className={'btn btn-primary ' + sty.ca52b2a4} disabled={busy || (!emp && !j.repeat && j.date > localISO())}
                      onClick={() => (emp ? act(j.num, 'accept', 'Работа принята — оцените исполнителя') : act(j.num, 'report', 'Работа сдана — у работодателя 7 дней на приёмку'))}>
                      {emp ? 'Принять работу' : !j.repeat && j.date > localISO() ? 'Сдать работу — с ' + dateLabel(j.date) : 'Сдать работу'}
                    </button>)}
              </div>
              {j.status === 'accepted' && j.reviewable > 0 && (
                <div className={sty.cefdb4bb}>
                  <span className={'fh ' + sty.cbf81ab7}>отзыв · {j.counterpart}</span>
                  <span className={sty.cdcd12d1}>{j.reviewed >= j.reviewable ? 'отзыв оставлен' : ''}</span>
                  <span style={{ flex: 1 }} />
                  <Link href={'/?job=' + j.num} className={'btn btn-secondary ' + sty.cd45276d}>{j.reviewed >= j.reviewable ? 'Открыть смену' : emp ? 'Оценить исполнителя' : 'Оценить работодателя'}</Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {jobs && !jobs.length && (
        <div className={'blueprint ' + sty.c3225b0f}>
          <Corners />
          Пока пусто. {emp ? 'Отметьте заказ на карте — он появится здесь.' : 'Откликнитесь на заказ — он появится здесь.'}
        </div>
      )}
    </div>
  );
}
