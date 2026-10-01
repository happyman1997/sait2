'use client';

// Серия выходов (как в прототипе): каждый день — отдельная смена. Нанятый снимает день, свободный день берут на замену,
// каждый выход сдаётся, принимается и рассчитывается отдельно; работодатель продлевает серию.
import { useState } from 'react';
import { css } from '@/lib/css';
import { localISO, type JobDetail, type SeriesInfo } from '@/lib/jobs';
import { ComplaintForm, type Act, type ReviewOpen } from './ShiftBlock';
import { Corners, LABEL } from './ui';

type Day = SeriesInfo['days'][number];

const hasAction = (d: Day) => !!d.work && (d.work.canReport || d.work.canAccept || d.work.canPay);
/** День в работе: сдан или принят, но расчёт ещё не подтверждён обеими сторонами. */
const inProgress = (d: Day) => !!d.work && (!!d.work.reportedAt || !!d.work.acceptedAt) && !(d.work.employerPaid && d.work.freelancerPaid);

function dayStatus(d: Day, job: JobDetail, iAmIn: boolean): string {
  const w = d.work;
  if (w?.acceptedAt) {
    const paid = w.employerPaid && w.freelancerPaid ? ' · расчёт подтверждён' : w.employerPaid ? ' · оплата передана' : w.freelancerPaid ? ' · деньги получены' : '';
    return (w.autoAccepted ? 'засчитан сам' : 'принят') + paid;
  }
  if (w?.reportedAt) return 'сдан · ждёт приёмки';
  if (d.skipped) return 'снят';
  if (d.past) return w && w.workers > 0 ? 'не сдан' : 'прошёл';
  if (job.mine) return d.skippedBy ? 'не выйдут: ' + d.skippedBy + (d.free ? ' · свободно ' + d.free : ' · замена есть') : job.hired ? 'исполнитель есть' : 'нет исполнителя';
  if (iAmIn) return 'за вами';
  if (d.mySub === 'hired') return 'вы на замене';
  if (d.mySub === 'sent') return 'отклик на замену отправлен';
  if (d.mySub === 'rejected') return 'выбран другой исполнитель';
  return d.free ? 'свободно мест: ' + d.free : 'открыт';
}

export function SeriesBlock({ job, act, busy, onReview }: { job: JobDetail; act: Act; busy: boolean; onReview?: ReviewOpen }) {
  const s = job.series!;
  const [all, setAll] = useState(false);
  const [callDay, setCallDay] = useState('');
  const [complainAbout, setComplainAbout] = useState<{ id: string; name: string } | null>(null);
  // Коротко — дни, где нужно действие или идёт приёмка/расчёт, и ближайшие пять; если ничего — последние пять.
  const upcoming = s.days.filter(d => !d.past && !hasAction(d) && !inProgress(d)).slice(0, 5);
  const short = s.days.filter(d => hasAction(d) || inProgress(d) || upcoming.includes(d));
  const days = all ? s.days : short.length ? short : s.days.slice(-5);
  const iAmIn = job.myStatus === 'hired';
  const toAccept = s.days.filter(d => d.work?.canAccept && d.work.reportedAt).length;
  const toPay = s.days.filter(d => d.work?.canPay).length;
  return (
    <div className="blueprint" style={css('margin-top: 14px; padding: 12px 13px')}>
      <Corners />
      <div style={css('display: flex; justify-content: space-between; gap: 10px; align-items: baseline; flex-wrap: wrap')}>
        <span style={css(LABEL)}>Серия выходов</span>
        <span style={css('font-size: 13px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>{s.rule}</span>
      </div>
      <div style={css('font-size: 13px; line-height: 1.45; margin-top: 6px; color: color-mix(in srgb, var(--color-text) 72%, transparent)')}>
        {s.onCall
          ? 'Выходы по вызову после снегопада: работодатель вызывает бригаду на дату — приходит срочное уведомление. Каждый вызов сдаётся, принимается и рассчитывается отдельно.'
          : 'Заказ держит не один выход, а серию: каждый день — отдельная смена. Выход сдаётся, принимается и рассчитывается отдельно; отказ от одного дня не снимает остальные.'}
      </div>
      {(toAccept > 0 || toPay > 0) && (
        <div style={css('font-size: 13px; margin-top: 7px; color: var(--color-accent-900)')}>
          {[toAccept ? 'ждут приёмки: ' + toAccept : '', toPay ? 'отметить расчёт: ' + toPay : ''].filter(Boolean).join(' · ')}
        </div>
      )}
      <div style={css('display: grid; gap: 5px; margin-top: 9px')}>
        {days.map(d => {
          const w = d.work;
          const hot = (d.free && !job.mine && !iAmIn && !d.past) || hasAction(d);
          return (
            <div key={d.i} style={css('padding: 7px 9px; border: 1px solid ' + (d.skipped ? 'color-mix(in srgb, var(--color-text) 14%, transparent)' : hot ? 'var(--color-accent)' : 'var(--color-divider)') + '; opacity: ' + ((d.skipped || d.past) && !hasAction(d) && !inProgress(d) ? '.55' : '1'))}>
              {/* В узкой панели статус и кнопки переносятся под дату, а не наезжают на неё. */}
              <div style={css('display: flex; align-items: center; gap: 4px 10px; flex-wrap: wrap')}>
                <span style={css('font-family: var(--font-heading); font-size: 12px; letter-spacing: .14em; color: color-mix(in srgb, var(--color-text) 62%, transparent)')}>{String(d.i + 1).padStart(2, '0')}</span>
                <span style={css('flex: 1 1 130px; min-width: 0; font-family: var(--font-heading); font-size: 14px; text-transform: uppercase; letter-spacing: .02em; white-space: nowrap')}>{d.label}</span>
                <span style={css('margin-left: auto; font-size: 12.5px; text-align: right; color: ' + ((job.mine && d.free && !d.past) || (!job.mine && d.free && !iAmIn && !d.past) ? 'var(--color-accent-900)' : 'color-mix(in srgb, var(--color-text) 64%, transparent)'))}>{dayStatus(d, job, iAmIn)}</span>
                {s.canSkip && !d.past && d.date && !w?.reportedAt && !w?.acceptedAt && (
                  <button className="btn btn-ghost" disabled={busy} onClick={() => act('series/skip', { day: d.date }, d.skipped ? 'Выход возвращён в серию' : 'Выход снят — остальные дни серии за вами')}
                    style={css('height: 26px; font-size: 12.5px; padding: 0 6px; flex: none')}>{d.skipped ? 'Вернуть' : 'Не смогу'}</button>
                )}
                {d.canUncall && (
                  <button className="btn btn-ghost" disabled={busy}
                    onClick={() => { if (window.confirm('Отменить вызов на ' + d.label + '? Бригада и замены получат уведомление.')) act('series/call', { day: d.date, cancel: true }, 'Вызов отменён — бригада предупреждена'); }}
                    style={css('height: 26px; font-size: 12.5px; padding: 0 6px; flex: none')}>Отменить вызов</button>
                )}
                {s.canSub && !d.past && d.date && (d.mySub === 'sent' || (!d.mySub && d.free > 0)) && (
                  <button className="btn btn-ghost" disabled={busy} onClick={() => act('series/sub', { day: d.date }, d.mySub === 'sent' ? 'Отклик на замену отозван' : 'Отклик на замену отправлен работодателю')}
                    style={css('height: 26px; font-size: 12.5px; padding: 0 6px; flex: none')}>{d.mySub === 'sent' ? 'Отозвать' : 'Выйти в этот день'}</button>
                )}
              </div>
              {w && hasAction(d) && (
                <div style={css('display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; padding-left: 26px')}>
                  {w.canReport && (
                    <button className="btn btn-secondary" disabled={busy} onClick={() => act('series/day', { day: d.date, action: 'report' }, 'День сдан — у работодателя 7 дней на приёмку')}
                      style={css('height: 28px; font-size: 12.5px; padding: 0 10px')}>Сдать день</button>
                  )}
                  {w.canAccept && (
                    <button className="btn btn-primary" disabled={busy} onClick={() => act('series/day', { day: d.date, action: 'accept' }, 'День принят')}
                      style={css('height: 28px; font-size: 12.5px; padding: 0 10px')}>Принять день</button>
                  )}
                  {w.canPay && (
                    <button className="btn btn-secondary" disabled={busy} onClick={() => act('series/day', { day: d.date, action: 'paid' }, job.mine ? 'Отмечено: оплата за день передана' : 'Отмечено: деньги за день получены')}
                      style={css('height: 28px; font-size: 12.5px; padding: 0 10px')}>{job.mine ? 'Оплата передана' : 'Деньги получены'}</button>
                  )}
                  {w.reportedAt && w.autoAcceptAt && job.mine && (
                    <span style={css('font-size: 12.5px; align-self: center; color: color-mix(in srgb, var(--color-text) 64%, transparent)')}>
                      {'засчитается сам ' + new Date(w.autoAcceptAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                    </span>
                  )}
                </div>
              )}
              {job.mine && d.subs.length > 0 && (
                <div style={css('display: grid; gap: 4px; margin-top: 6px; padding-left: 26px')}>
                  {d.subs.map(x => (
                    <div key={x.id} style={css('display: flex; align-items: center; gap: 8px; font-size: 13px')}>
                      <span style={css('flex: 1; min-width: 0')}>{x.name + ' — ' + (x.status === 'hired' ? 'на замене' : x.status === 'rejected' ? 'отказано' : 'готов выйти')}</span>
                      {x.status === 'sent' && !d.past && d.free > 0 && (
                        <button className="btn btn-secondary" disabled={busy} onClick={() => act('series/sub/decide', { day: d.date, freelancer: x.id, action: 'hire' }, x.name + ' выходит на замену — открыт чат')}
                          style={css('height: 26px; font-size: 12px; padding: 0 8px')}>Взять на день</button>
                      )}
                      {x.status === 'sent' && !d.past && (
                        <button className="btn btn-ghost" disabled={busy} onClick={() => act('series/sub/decide', { day: d.date, freelancer: x.id, action: 'reject' }, 'Отказ отправлен')}
                          style={css('height: 26px; font-size: 12px; padding: 0 6px')}>Отказать</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {s.onCall && !s.days.length && (
        <div style={css('font-size: 13px; margin-top: 8px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>
          {job.mine ? 'Вызовов пока нет. После снегопада выберите дату — бригада получит срочное уведомление.' : 'Вызовов пока нет — работодатель вызовет бригаду после снегопада.'}
        </div>
      )}
      {s.canCall && (
        <div style={css('display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px')}>
          <input type="date" aria-label="Дата вызова" value={callDay} min={localISO()} onChange={e => setCallDay(e.target.value)}
            style={css('height: 38px; padding: 0 8px; border: 1px solid var(--color-divider); background: var(--color-neutral-100); font: inherit; font-size: 14px')} />
          <button className="btn btn-primary" disabled={busy || !callDay}
            onClick={async () => { if (await act('series/call', { day: callDay }, 'Бригада вызвана — придёт срочное уведомление')) setCallDay(''); }}
            style={css('height: 38px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; padding: 0 14px')}>Вызвать бригаду</button>
        </div>
      )}
      {days.length < s.days.length || all ? (
        <button className="btn btn-ghost" onClick={() => setAll(a => !a)} style={css('margin-top: 6px; height: 28px; font-size: 12.5px; padding: 0 6px')}>{all ? 'Свернуть' : 'Все выходы — ' + s.days.length}</button>
      ) : null}
      {onReview && s.reviews.map(r => (
        <div key={r.target} style={css('display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; margin-top: 10px; border-top: 1px solid var(--color-divider); padding-top: 9px')}>
          <span style={css('font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .18em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 58%, transparent)')}>{(job.mine ? 'замена · ' : 'отзыв · ') + r.name}</span>
          {r.mine && <span style={css('font-size: 13.5px; line-height: 1.35; min-width: 0; color: var(--color-accent-900)')}>{r.mine.rating}/5 · {r.mine.text || 'без комментария'}</span>}
          <span style={{ flex: 1 }} />
          {(!r.mine || r.mine.editable) && (
            <button className="btn btn-secondary" onClick={() => onReview({ target: r.target, name: r.name, rating: r.mine?.rating, text: r.mine?.text })} style={css('height: 32px; font-size: 13px; flex: none')}>
              {r.mine ? 'Изменить отзыв' : job.mine ? 'Оценить замену' : 'Оценить работодателя'}
            </button>
          )}
          {r.complained
            ? <span style={css('font-size: 12.5px; color: color-mix(in srgb, var(--color-text) 64%, transparent)')}>жалоба на рассмотрении</span>
            : <button className="btn btn-ghost" onClick={() => setComplainAbout({ id: r.target, name: r.name })} style={css('height: 32px; font-size: 12.5px; padding: 0 6px; flex: none')}>Пожаловаться</button>}
        </div>
      ))}
      {complainAbout && (
        <ComplaintForm role={job.mine ? 'employer' : 'freelancer'} act={act} busy={busy} onClose={() => setComplainAbout(null)}
          title={'Жалоба · ' + complainAbout.name} targets={job.mine ? [complainAbout] : []} />
      )}
      {s.canExtend && (
        <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => act('series/extend', {}, 'Серия продлена — добавлено 4 выхода')}
          style={css('margin-top: 10px; height: 40px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Продлить серию на месяц</button>
      )}
      <div style={css('font-size: 12.5px; line-height: 1.4; margin-top: 8px; color: color-mix(in srgb, var(--color-text) 64%, transparent)')}>
        {job.mine
          ? 'Сданный день примите в течение 7 дней — иначе он засчитается сам. Снятый день открыт для замены: откликнувшиеся появятся под днём.'
          : iAmIn ? 'Выход сдаёте в день работы или позже. Снятый день возвращается в поиск; больше двух снятых дней подряд — пометка в профиле.'
          : s.canSub ? 'Свободный день можно взять на замену — отдельно от всей серии.'
          : 'Свободные дни берут на замену исполнители, вошедшие в аккаунт.'}
      </div>
    </div>
  );
}
