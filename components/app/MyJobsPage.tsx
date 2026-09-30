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
    ? (j.autoAccepted ? 'Смена закрыта автоматически: работодатель не ответил 7 дней. Засчитана исполнителю.' : 'Смена закрыта — работа принята.')
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
  useLiveEvent(e => { if (e.t === 'job') load(); });

  const act = async (num: number, path: string, ok: string) => {
    setBusy(true);
    try { await api<{ job: JobDetail }>('/api/jobs/' + num + '/' + path, {}); flash(ok); load(); }
    catch (e) { flash(e instanceof ApiError ? e.message : 'Не получилось — попробуйте ещё раз'); }
    finally { setBusy(false); }
  };

  return (
    <div style={css('flex: 1; min-height: 0; overflow: auto; padding: 22px max(24px, calc((100% - 1280px) / 2)) 90px')}>
      <h2 style={css('margin: 0 0 18px; font-size: 29px; text-transform: uppercase; letter-spacing: .02em')}>{emp ? 'Мои заказы' : 'Мои смены'}</h2>
      {!jobs && <div style={css('font-size: 14px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>Загружаем…</div>}
      <div style={css('display: grid; gap: 13px')}>
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
            <div key={j.num} className="card blueprint" style={css('padding: 16px 18px')}>
              <Corners />
              <div style={css('display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap')}>
                <div style={css('font-family: var(--font-heading); font-size: 14px; letter-spacing: .2em; color: color-mix(in srgb, var(--color-text) 62%, transparent); padding-top: 6px')}>{jobNum(j.num)}</div>
                <div style={css('flex: 1; min-width: 190px')}>
                  <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 20px; text-transform: uppercase; letter-spacing: .02em')}>{j.title}</div>
                  <div style={css('font-size: 14px; color: color-mix(in srgb, var(--color-text) 70%, transparent); margin-top: 2px')}>{j.address} · {sub ? 'замена ' + dayList(subShown) : dateLabel(j.date)}</div>
                  <div style={css('margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap')}>
                    <span className={s.cls}>{s.label}</span>
                    <span style={css('font-size: 13px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>
                      {emp ? j.applicants + ' ' + plural(j.applicants, 'отклик', 'отклика', 'откликов') + (j.counterpart ? ' · нанят: ' + j.counterpart : '') : 'работодатель ' + j.counterpart}
                    </span>
                  </div>
                </div>
                <div style={css('text-align: right')}>
                  <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 22px')}>{money(j.pay, j.unit)}</div>
                  <div style={css('display: flex; gap: 6px; margin-top: 8px; justify-content: flex-end')}>
                    <Link href={'/?job=' + j.num} className="btn btn-secondary" style={css('height: 32px; font-size: 13px')}>На карте</Link>
                    {j.hasChat && <button className="btn btn-secondary" onClick={() => (j.chatThread ? openChat(j.num, j.chatThread) : setDock({ open: true, view: 'list' }))} style={css('height: 32px; font-size: 13px')}>Чат</button>}
                  </div>
                </div>
              </div>
              <div style={css('display: flex; gap: 6px; margin-top: 14px')}>
                {t.stages.map((st, i) => (
                  <div key={st.label} style={css(t.off
                    ? 'flex: 1; min-width: 0; padding: 7px 9px; border: 1px dashed var(--color-divider); background: transparent; color: color-mix(in srgb, var(--color-text) 50%, transparent); font-size: 12.5px; line-height: 1.25; text-decoration: line-through'
                    : 'flex: 1; min-width: 0; padding: 7px 9px; border: 1px solid ' + (st.ok ? 'var(--color-accent)' : i === t.cur ? 'color-mix(in srgb, var(--color-accent) 40%, var(--color-divider))' : 'var(--color-divider)') +
                      '; background: ' + (st.ok ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent') +
                      '; color: ' + (st.ok ? 'var(--color-accent-900)' : i === t.cur ? 'color-mix(in srgb, var(--color-text) 72%, transparent)' : 'color-mix(in srgb, var(--color-text) 58%, transparent)') + '; font-size: 12.5px; line-height: 1.25')}>
                    <div style={css('font-family: var(--font-heading); font-size: 12px; letter-spacing: .16em')}>{t.off ? '×' : st.ok ? '✓' : String(i + 1)}</div>
                    <div style={css('margin-top: 2px')}>{st.label}</div>
                  </div>
                ))}
              </div>
              <div style={css('display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 9px')}>
                <span style={css('font-size: 13.5px; line-height: 1.4; min-width: 0; flex: 1 1 260px; color: color-mix(in srgb, var(--color-text) 72%, transparent)')}>{t.note}</span>
                {hasNext && (emp && t.cur === 1
                  ? <Link href="/apps" className="btn btn-primary" style={css('height: 40px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; padding: 0 16px; flex: none')}>Смотреть отклики</Link>
                  : isSeries(j.repeat)
                  ? <Link href={'/?job=' + j.num} className="btn btn-primary" style={css('height: 40px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; padding: 0 16px; flex: none; display: inline-flex; align-items: center; text-decoration: none')}>Серия выходов</Link>
                  : <button className="btn btn-primary" disabled={busy || (!emp && !j.repeat && j.date > localISO())}
                      onClick={() => (emp ? act(j.num, 'accept', 'Работа принята — оцените исполнителя') : act(j.num, 'report', 'Работа сдана — у работодателя 7 дней на приёмку'))}
                      style={css('height: 40px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; padding: 0 16px; flex: none')}>
                      {emp ? 'Принять работу' : !j.repeat && j.date > localISO() ? 'Сдать работу — с ' + dateLabel(j.date) : 'Сдать работу'}
                    </button>)}
              </div>
              {j.status === 'accepted' && j.reviewable > 0 && (
                <div style={css('display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; border-top: 1px solid var(--color-divider); padding-top: 10px')}>
                  <span style={css('font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .18em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 58%, transparent)')}>отзыв · {j.counterpart}</span>
                  <span style={css('font-size: 13.5px; color: var(--color-accent-900)')}>{j.reviewed >= j.reviewable ? 'отзыв оставлен' : ''}</span>
                  <span style={{ flex: 1 }} />
                  <Link href={'/?job=' + j.num} className="btn btn-secondary" style={css('height: 36px; font-size: 13px; flex: none')}>{j.reviewed >= j.reviewable ? 'Открыть смену' : emp ? 'Оценить исполнителя' : 'Оценить работодателя'}</Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {jobs && !jobs.length && (
        <div className="blueprint" style={css('padding: 36px; text-align: center; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>
          <Corners />
          Пока пусто. {emp ? 'Отметьте заказ на карте — он появится здесь.' : 'Откликнитесь на заказ — он появится здесь.'}
        </div>
      )}
    </div>
  );
}
