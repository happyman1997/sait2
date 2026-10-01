'use client';

// Экран «Смена» (в мобильном меню, как в прототипе): самая актуальная смена — чек-лист «Перед выходом»,
// сдача/приёмка, фото до/после, расчёт, отзыв, чат. Обновляется живыми событиями.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { css } from '@/lib/css';
import { dateLabel, jobNum, jobStatus, money, SAFETY_ITEMS, seriesDayLabel, type JobDetail } from '@/lib/jobs';
import { showModeration } from '@/components/ModerationGuard';
import { useFlash } from '@/components/Toast';
import { useLive, useLiveEvent } from './Live';
import { SeriesBlock } from './SeriesBlock';
import { ShiftBlock } from './ShiftBlock';
import { Chip, Corners, LABEL, MUTED } from './ui';
import sty from './ShiftScreen.module.css';

const TIP_KEY = 'arena:first-tip-hidden';

export function ShiftScreen() {
  const live = useLive();
  const flash = useFlash();
  const [job, setJob] = useState<JobDetail | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [tipHidden, setTipHidden] = useState(true);
  const role = live.me?.role ?? null;
  const isEmp = role === 'employer';

  const load = useCallback(() => {
    api<{ job: JobDetail | null }>('/api/me/shift').then(r => setJob(r.job)).catch(() => setJob(j => j ?? null));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { try { setTipHidden(localStorage.getItem(TIP_KEY) === '1'); } catch { setTipHidden(false); } }, []);
  // Своя смена изменилась — перечитать; событие по другому заказу могло сделать актуальной другую смену.
  useLiveEvent(e => { if ((e.t === 'job' && (!job || e.num === job.num)) || (e.t === 'event' && e.num)) load(); });

  const act = useCallback(async (path: string, body: unknown, ok: string, method: 'POST' | 'DELETE' = 'POST') => {
    if (!job) return false;
    setBusy(true);
    try {
      const r = await api<{ job: JobDetail }>('/api/jobs/' + job.num + '/' + path, method === 'DELETE' ? null : body ?? {}, method);
      setJob(r.job);
      if (ok) flash(ok);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.body.moderation) showModeration(e.body.moderation.label, e.body.moderation.category);
      flash(e instanceof ApiError ? e.message : 'Не получилось — попробуйте ещё раз');
      return false;
    } finally { setBusy(false); }
  }, [job, flash]);

  if (job === undefined) return <div style={css('flex: 1; display: grid; place-items: center; ' + MUTED)}>Загружаем смену…</div>;

  if (!job) {
    return (
      <div className={sty.c17015ae}>
        <div style={css('max-width: 560px; margin: 0 auto; text-align: center; font-size: 14.5px; line-height: 1.5; ' + MUTED)}>
          {isEmp
            ? 'Идущих смен нет. Опубликуйте заказ на карте и наймите исполнителя — здесь соберутся чек-лист, сдача работы, фото и расчёт.'
            : 'Активной смены нет. Откликнитесь на заказ на карте — экран смены соберётся сам: чек-лист, сдача работы, фото и расчёт.'}
          <div className={sty.c610998e}>
            <Link href="/" className={'btn btn-primary ' + sty.c9216731}>К карте</Link>
            <Link href="/mine" className={'btn btn-secondary ' + sty.c9216731}>{isEmp ? 'Мои заказы' : 'Мои смены'}</Link>
          </div>
        </div>
      </div>
    );
  }

  const shift = job.shift;
  // Замена на отдельные дни серии: смены (чек-листа, сдачи) у неё нет — только дни и чат с работодателем.
  const subHired = (!shift && job.series?.days.filter(d => d.mySub === 'hired' && d.date && !d.past)) || [];
  const subSent = (!shift && job.series?.days.filter(d => d.mySub === 'sent' && d.date && !d.past)) || [];
  const s = subHired.length && job.status !== 'accepted' && job.status !== 'cancelled' ? { label: 'Вы на замене', cls: 'tag tag-neutral' } : jobStatus(job, role);
  const when = subHired.length ? 'замена ' + subHired.map(d => seriesDayLabel(d.date!)).join(', ') : dateLabel(job.date);
  const meSafety = shift?.safety.find(x => x.me);
  const canCheck = !isEmp && !!meSafety && job.status !== 'accepted' && job.status !== 'cancelled';
  const toggle = (id: string) => {
    if (!meSafety) return;
    const items = meSafety.items.includes(id) ? meSafety.items.filter(x => x !== id) : [...meSafety.items, id];
    act('safety', { items }, '');
  };
  const allDone = (items: string[]) => SAFETY_ITEMS.every(i => items.includes(i.id));

  return (
    <div className={sty.cca0d1b9}>
      <div className={sty.c69859bc}>
        <div style={css(LABEL + '; font-size: 12px')}>{'Смена ' + jobNum(job.num) + ' · ' + when}</div>
        <h1 className={'fh ' + sty.cf2e09da}>{job.title}</h1>
        <div style={css('font-size: 13.5px; line-height: 1.4; margin-top: 3px; ' + MUTED)}>{job.address}</div>
        <div className={sty.c70c55fd}>
          <span className={s.cls}>{s.label}</span>
          <span className={'fh ' + sty.cd653512}>{money(job.pay, job.unit)}</span>
          <span style={{ flex: 1 }} />
          <Link href={'/?job=' + job.num} className={sty.ca541880}>Заказ на карте →</Link>
        </div>

        {!shift && subHired.length > 0 && (
          <div className={'blueprint ' + sty.c8562f72}>
            <Corners />
            <div style={css(LABEL + '; font-size: 12px')}>Замена</div>
            <div className={sty.ccad6f89}>
              Вы выходите на замену {subHired.map(d => seriesDayLabel(d.date!)).join(', ')}. Время и место встречи уточните в чате — работу за смену сдаёт основной состав.
              {subSent.length > 0 && ' Ждём решения по: ' + subSent.map(d => seriesDayLabel(d.date!)).join(', ') + '.'}
            </div>
            {live.me && (
              <button className={'btn btn-secondary ' + sty.c0264645} onClick={() => live.openChat(job.num, live.me!.id)}>Чат с работодателем</button>
            )}
            <div style={css('font-size: 13px; margin-top: 8px; ' + MUTED)}>
              <a href={'/api/contract-template?job=' + job.num} download>Шаблон договора ГПХ</a> на ваши дни — заполняете и подписываете сами.
            </div>
          </div>
        )}

        {!shift && !subHired.length && (
          <div className={'blueprint ' + sty.c8562f72}>
            <Corners />
            <div style={css(LABEL + '; font-size: 12px')}>Отклик</div>
            <div className={sty.ccad6f89}>Отклик отправлен — ждём решения работодателя. Когда вас наймут, здесь появятся чек-лист, телефон встречающего и сдача работы.</div>
          </div>
        )}

        {shift && shift.safety.length > 0 && (
          <div className={'blueprint ' + sty.caeb40d8}>
            <Corners />
            <div style={css(LABEL + '; font-size: 12px')}>Перед выходом</div>
            {isEmp ? shift.safety.map(p => (
              <div key={p.name} className={sty.c0d69e4b}>
                <div className={sty.c025e659}>{p.name}</div>
                <div className={sty.c2bf69bb}>
                  {SAFETY_ITEMS.map(i => <span key={i.id} className={'tag ' + (p.items.includes(i.id) ? 'tag-accent' : 'tag-outline')}>{i.label}</span>)}
                </div>
              </div>
            )) : (
              <div className={sty.c520f760}>
                {SAFETY_ITEMS.map(i => (
                  <Chip key={i.id} active={!!meSafety?.items.includes(i.id)} onClick={() => canCheck && !busy && toggle(i.id)} extra="min-height: 34px">{i.label}</Chip>
                ))}
              </div>
            )}
            <div style={css('font-size: 13px; line-height: 1.4; margin-top: 8px; ' + MUTED)}>
              {isEmp
                ? (shift.safety.every(p => allDone(p.items)) ? 'Чек-лист исполнителей пройден' : 'Исполнитель ещё не прошёл чек-лист')
                : (meSafety && allDone(meSafety.items) ? 'Чек-лист пройден — работодатель видит отметки' : 'Пройдите чек-лист перед началом работ — работодатель видит отметки')}
            </div>
          </div>
        )}

        {!isEmp && shift && !tipHidden && job.status !== 'accepted' && (
          <div className={'blueprint ' + sty.c666c58d}>
            <Corners />
            <div className={sty.cad948e3}>
              <span className={'fh ' + sty.c2e2088c}>Первый выход</span>
              <button onClick={() => { setTipHidden(true); try { localStorage.setItem(TIP_KEY, '1'); } catch { /* не критично */ } }} aria-label="Скрыть подсказку"
                style={css('all: unset; cursor: pointer; font-size: 17px; line-height: 1; padding: 4px; ' + MUTED)}>×</button>
            </div>
            <div className={sty.cb80f41a}>
              {[
                { label: 'Взять с собой', value: job.tools === 'инвентарь есть на объекте' ? 'рабочую одежду по погоде — инвентарь на месте' : 'свой инвентарь и рабочую одежду по погоде' },
                { label: 'Фотоотчёт', value: 'Фото до и после — работодателю проще принять работу.' },
                { label: 'Расчёт', value: (job.payType || 'по договорённости') + ' — напрямую с работодателем, после приёмки отметьте получение.' }
              ].map(t => (
                <div key={t.label}>
                  <div style={css('font-family: var(--font-heading); font-size: 12px; letter-spacing: .16em; text-transform: uppercase; ' + MUTED)}>{t.label}</div>
                  <div className={sty.c618512c}>{t.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {shift && (
          <ShiftBlock job={job} isOwner={job.mine} act={act} busy={busy}
            onChat={thread => live.openChat(job.num, thread)}
            onReview={t => live.openReview({ ...t, num: job.num, title: job.title + ' · ' + dateLabel(job.date), onSaved: setJob })} />
        )}

        {/* Серия: сдача, приёмка и расчёт по дням, снятие дня — прямо на экране смены. */}
        {job.series && (shift || subHired.length > 0) && (
          <SeriesBlock job={job} act={act} busy={busy}
            onReview={t => live.openReview({ ...t, num: job.num, title: job.title + ' · ' + dateLabel(job.date), onSaved: setJob })} />
        )}

        <div className={sty.ca6b48a0}>
          <Link href="/mine" className={sty.ce41405c}>{isEmp ? 'Все мои заказы →' : 'Все мои смены →'}</Link>
        </div>
      </div>
    </div>
  );
}
