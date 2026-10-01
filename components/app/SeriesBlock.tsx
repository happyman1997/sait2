'use client';

// Серия выходов (как в прототипе): каждый день — отдельная смена. Нанятый снимает день, свободный день берут на замену,
// каждый выход сдаётся, принимается и рассчитывается отдельно; работодатель продлевает серию.
import { useState } from 'react';
import { css } from '@/lib/css';
import { localISO, type JobDetail, type SeriesInfo } from '@/lib/jobs';
import { ComplaintForm, type Act, type ReviewOpen } from './ShiftBlock';
import { Corners, LABEL } from './ui';
import sty from './SeriesBlock.module.css';

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
    <div className={'blueprint ' + sty.c982b41a}>
      <Corners />
      <div className={sty.cebf0f9b}>
        <span style={css(LABEL)}>Серия выходов</span>
        <span className={sty.cdde3848}>{s.rule}</span>
      </div>
      <div className={sty.ccd558ae}>
        {s.onCall
          ? 'Выходы по вызову после снегопада: работодатель вызывает бригаду на дату — приходит срочное уведомление. Каждый вызов сдаётся, принимается и рассчитывается отдельно.'
          : 'Заказ держит не один выход, а серию: каждый день — отдельная смена. Выход сдаётся, принимается и рассчитывается отдельно; отказ от одного дня не снимает остальные.'}
      </div>
      {(toAccept > 0 || toPay > 0) && (
        <div className={sty.c45fabcd}>
          {[toAccept ? 'ждут приёмки: ' + toAccept : '', toPay ? 'отметить расчёт: ' + toPay : ''].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className={sty.c29f000d}>
        {days.map(d => {
          const w = d.work;
          const hot = (d.free && !job.mine && !iAmIn && !d.past) || hasAction(d);
          return (
            <div key={d.i} style={css('padding: 7px 9px; border: 1px solid ' + (d.skipped ? 'color-mix(in srgb, var(--color-text) 14%, transparent)' : hot ? 'var(--color-accent)' : 'var(--color-divider)') + '; opacity: ' + ((d.skipped || d.past) && !hasAction(d) && !inProgress(d) ? '.55' : '1'))}>
              {/* В узкой панели статус и кнопки переносятся под дату, а не наезжают на неё. */}
              <div className={sty.cfb7a3e4}>
                <span className={'fh ' + sty.cc28d0d2}>{String(d.i + 1).padStart(2, '0')}</span>
                <span className={'fh ' + sty.c93d7956}>{d.label}</span>
                <span style={css('margin-left: auto; font-size: 12.5px; text-align: right; color: ' + ((job.mine && d.free && !d.past) || (!job.mine && d.free && !iAmIn && !d.past) ? 'var(--color-accent-900)' : 'color-mix(in srgb, var(--color-text) 64%, transparent)'))}>{dayStatus(d, job, iAmIn)}</span>
                {s.canSkip && !d.past && d.date && !w?.reportedAt && !w?.acceptedAt && (
                  <button className={'btn btn-ghost ' + sty.c21fe28f} disabled={busy} onClick={() => act('series/skip', { day: d.date }, d.skipped ? 'Выход возвращён в серию' : 'Выход снят — остальные дни серии за вами')}>{d.skipped ? 'Вернуть' : 'Не смогу'}</button>
                )}
                {d.canUncall && (
                  <button className={'btn btn-ghost ' + sty.c21fe28f} disabled={busy}
                    onClick={() => { if (window.confirm('Отменить вызов на ' + d.label + '? Бригада и замены получат уведомление.')) act('series/call', { day: d.date, cancel: true }, 'Вызов отменён — бригада предупреждена'); }}>Отменить вызов</button>
                )}
                {s.canSub && !d.past && d.date && (d.mySub === 'sent' || (!d.mySub && d.free > 0)) && (
                  <button className={'btn btn-ghost ' + sty.c21fe28f} disabled={busy} onClick={() => act('series/sub', { day: d.date }, d.mySub === 'sent' ? 'Отклик на замену отозван' : 'Отклик на замену отправлен работодателю')}>{d.mySub === 'sent' ? 'Отозвать' : 'Выйти в этот день'}</button>
                )}
              </div>
              {w && hasAction(d) && (
                <div className={sty.c17a415b}>
                  {w.canReport && (
                    <button className={'btn btn-secondary ' + sty.c93052a5} disabled={busy} onClick={() => act('series/day', { day: d.date, action: 'report' }, 'День сдан — у работодателя 7 дней на приёмку')}>Сдать день</button>
                  )}
                  {w.canAccept && (
                    <button className={'btn btn-primary ' + sty.c93052a5} disabled={busy} onClick={() => act('series/day', { day: d.date, action: 'accept' }, 'День принят')}>Принять день</button>
                  )}
                  {w.canPay && (
                    <button className={'btn btn-secondary ' + sty.c93052a5} disabled={busy} onClick={() => act('series/day', { day: d.date, action: 'paid' }, job.mine ? 'Отмечено: оплата за день передана' : 'Отмечено: деньги за день получены')}>{job.mine ? 'Оплата передана' : 'Деньги получены'}</button>
                  )}
                  {w.reportedAt && w.autoAcceptAt && job.mine && (
                    <span className={sty.ceb5d71b}>
                      {'засчитается сам ' + new Date(w.autoAcceptAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                    </span>
                  )}
                </div>
              )}
              {job.mine && d.subs.length > 0 && (
                <div className={sty.c46640e6}>
                  {d.subs.map(x => (
                    <div key={x.id} className={sty.ca2e9f2a}>
                      <span className={sty.c8b4ab7f}>{x.name + ' — ' + (x.status === 'hired' ? 'на замене' : x.status === 'rejected' ? 'отказано' : 'готов выйти')}</span>
                      {x.status === 'sent' && !d.past && d.free > 0 && (
                        <button className={'btn btn-secondary ' + sty.ca2320b1} disabled={busy} onClick={() => act('series/sub/decide', { day: d.date, freelancer: x.id, action: 'hire' }, x.name + ' выходит на замену — открыт чат')}>Взять на день</button>
                      )}
                      {x.status === 'sent' && !d.past && (
                        <button className={'btn btn-ghost ' + sty.c4182ee7} disabled={busy} onClick={() => act('series/sub/decide', { day: d.date, freelancer: x.id, action: 'reject' }, 'Отказ отправлен')}>Отказать</button>
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
        <div className={sty.cfc4129a}>
          {job.mine ? 'Вызовов пока нет. После снегопада выберите дату — бригада получит срочное уведомление.' : 'Вызовов пока нет — работодатель вызовет бригаду после снегопада.'}
        </div>
      )}
      {s.canCall && (
        <div className={sty.cd5da66b}>
          <input type="date" aria-label="Дата вызова" value={callDay} min={localISO()} onChange={e => setCallDay(e.target.value)}
            className={sty.ca8e69a5} />
          <button className={'btn btn-primary ' + sty.cbd02d23} disabled={busy || !callDay}
            onClick={async () => { if (await act('series/call', { day: callDay }, 'Бригада вызвана — придёт срочное уведомление')) setCallDay(''); }}>Вызвать бригаду</button>
        </div>
      )}
      {days.length < s.days.length || all ? (
        <button className={'btn btn-ghost ' + sty.cc391ec6} onClick={() => setAll(a => !a)}>{all ? 'Свернуть' : 'Все выходы — ' + s.days.length}</button>
      ) : null}
      {onReview && s.reviews.map(r => (
        <div key={r.target} className={sty.c2e41b80}>
          <span className={'fh ' + sty.cbf81ab7}>{(job.mine ? 'замена · ' : 'отзыв · ') + r.name}</span>
          {r.mine && <span className={sty.ca5b8ed1}>{r.mine.rating}/5 · {r.mine.text || 'без комментария'}</span>}
          <span style={{ flex: 1 }} />
          {(!r.mine || r.mine.editable) && (
            <button className={'btn btn-secondary ' + sty.ca04aa4a} onClick={() => onReview({ target: r.target, name: r.name, rating: r.mine?.rating, text: r.mine?.text })}>
              {r.mine ? 'Изменить отзыв' : job.mine ? 'Оценить замену' : 'Оценить работодателя'}
            </button>
          )}
          {r.complained
            ? <span className={sty.c994210e}>жалоба на рассмотрении</span>
            : <button className={'btn btn-ghost ' + sty.cd8c36e5} onClick={() => setComplainAbout({ id: r.target, name: r.name })}>Пожаловаться</button>}
        </div>
      ))}
      {complainAbout && (
        <ComplaintForm role={job.mine ? 'employer' : 'freelancer'} act={act} busy={busy} onClose={() => setComplainAbout(null)}
          title={'Жалоба · ' + complainAbout.name} targets={job.mine ? [complainAbout] : []} />
      )}
      {s.canExtend && (
        <button className={'btn btn-secondary btn-block ' + sty.c6b7e7cf} disabled={busy} onClick={() => act('series/extend', {}, 'Серия продлена — добавлено 4 выхода')}>Продлить серию на месяц</button>
      )}
      <div className={sty.ce2b1053}>
        {job.mine
          ? 'Сданный день примите в течение 7 дней — иначе он засчитается сам. Снятый день открыт для замены: откликнувшиеся появятся под днём.'
          : iAmIn ? 'Выход сдаёте в день работы или позже. Снятый день возвращается в поиск; больше двух снятых дней подряд — пометка в профиле.'
          : s.canSub ? 'Свободный день можно взять на замену — отдельно от всей серии.'
          : 'Свободные дни берут на замену исполнители, вошедшие в аккаунт.'}
      </div>
    </div>
  );
}
