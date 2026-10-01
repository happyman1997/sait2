'use client';

// «Отклики» работодателя: найм и отказы в одном месте.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { css } from '@/lib/css';
import { crewOf, dateLabel, jobNum, jobStatus, money, plural, type MyJob } from '@/lib/jobs';
import { useFlash } from '@/components/Toast';
import { useLiveEvent } from './Live';
import { Corners } from './ui';
import sty from './ApplicantsPage.module.css';

type Person = {
  id: string; name: string; initials: string; status: 'sent' | 'hired' | 'rejected' | 'withdrawn'; isLead: boolean; appliedAt: string;
  rating: number | null; reviews: number; done: number; noShows: number; gear: string[]; ownCar: boolean; cities: string[]; skills: string[];
  reqConfirmed: boolean; lateMark: boolean; npd: boolean;
};
type BoardJob = MyJob & { people: Person[] };

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return m <= 1 ? 'только что' : m + ' ' + plural(m, 'минуту', 'минуты', 'минут') + ' назад';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' ' + plural(h, 'час', 'часа', 'часов') + ' назад';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};

export function ApplicantsPage() {
  const flash = useFlash();
  const [jobs, setJobs] = useState<BoardJob[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ jobs: BoardJob[] }>('/api/me/applicants').then(r => setJobs(r.jobs)).catch(e => flash(e instanceof ApiError ? e.message : 'Не удалось загрузить отклики'));
  }, [flash]);
  useEffect(load, [load]);
  useLiveEvent(e => { if (e.t === 'job' || e.t === 'resync') load(); });

  const act = async (num: number, path: string, ok: string) => {
    setBusy(true);
    try { await api('/api/jobs/' + num + '/' + path, {}); flash(ok); load(); }
    catch (e) { flash(e instanceof ApiError ? e.message : 'Не получилось — попробуйте ещё раз'); }
    finally { setBusy(false); }
  };

  const fact = (label: string, value: string, warn = false) => (
    <div key={label} className={sty.c1e94460}>
      <span className={'fh ' + sty.cad088cc}>{label}</span>
      <span style={css(warn ? 'color: var(--color-accent-900); font-weight: 600' : '')}>{value}</span>
    </div>
  );

  return (
    <div className={sty.c07c9bd7}>
      <div className={sty.c914ecb0}>
        <div className={sty.ce822620}>
          <Link href="/" className={'btn btn-primary ' + sty.c19d5231}>← Вернуться к карте</Link>
          <h2 className={sty.cfac1c55}>Отклики</h2>
        </div>
        <div className={sty.c816d564}>Найм и отказы — в одном месте</div>

        <div className={sty.ce24a1fb}>
          {!jobs && <div className={sty.c816d564}>Загружаем…</div>}
          {jobs?.map(j => {
            const s = jobStatus(j, 'employer');
            const crew = crewOf(j);
            const full = j.hired >= crew;
            const open = j.status === 'open' || j.status === 'staffed';
            const waiting = j.people.filter(p => p.status === 'sent');
            return (
              <div key={j.num} className={'blueprint ' + sty.c825356a}>
                <Corners />
                <div className={sty.c58abcd8}>
                  <div className={'fh ' + sty.c500ce95}>{jobNum(j.num)}</div>
                  <div className={sty.c5f2fcd1}>
                    <div className={'fh ' + sty.c8601717}>{j.title}</div>
                    <div className={sty.c9ed26e5}>{j.address} · {dateLabel(j.date)}</div>
                    <div className={sty.c67ef075}>
                      <span className={s.cls}>{s.label}</span>
                      <span className={sty.c8ed0fff}>
                        {j.people.length + ' ' + plural(j.people.length, 'отклик', 'отклика', 'откликов')}{crew > 1 ? ' · нанято ' + j.hired + (crew === Infinity ? '' : ' из ' + crew) : ''}
                      </span>
                    </div>
                  </div>
                  <div className={sty.c30489cb}>
                    <div className={'fh ' + sty.c51c985b}>{money(j.pay, j.unit)}</div>
                    <div className={sty.c493bff4}>
                      <Link href={'/?job=' + j.num} className={'btn btn-primary ' + sty.ca227687}>На карте</Link>
                    </div>
                  </div>
                </div>

                {j.people.length > 0 && (
                  <div className={sty.cc60885d}>
                    {j.people.map(p => (
                      <div key={p.id} style={css('display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; padding: 10px 11px; border: 1px solid ' + (p.status === 'hired' ? 'var(--color-accent)' : 'var(--color-divider)') + (p.status === 'hired' ? '; background: color-mix(in srgb, var(--color-accent) 7%, transparent)' : ''))}>
                        <div className={'fh ' + sty.cfa350bf}>{p.initials}</div>
                        <div className={sty.cdf3bb6c}>
                          <div className={sty.c2feaef2}>
                            <span className={'fh ' + sty.cf3b1b5e}>{p.name}</span>
                            <span className={p.status === 'hired' ? 'tag tag-accent' : 'tag tag-outline'}>{p.status === 'hired' ? (p.isLead ? 'старший' : 'нанят') : 'ждёт решения'}</span>
                            {p.npd && <span className="tag tag-outline" title="Статус НПД подтверждён ФНС">самозанятый ✓</span>}
                            <span className={sty.c999a5b0}>{ago(p.appliedAt)}</span>
                          </div>
                          <div className={sty.ccf142d6}>
                            {fact('рейтинг', p.rating != null ? p.rating.toFixed(1) + ' · ' + p.reviews + ' ' + plural(p.reviews, 'отзыв', 'отзыва', 'отзывов') : 'пока нет')}
                            {fact('смен', String(p.done))}
                            {fact('невыходов', p.noShows ? String(p.noShows) : 'ни разу', p.noShows > 0)}
                            {fact('транспорт', p.ownCar ? 'свой' : 'нет')}
                            {p.cities.length > 0 && fact('города', p.cities.slice(0, 3).join(', '))}
                            {p.lateMark && fact('пометка', 'поздний отказ за 90 дней', true)}
                          </div>
                          {p.skills.length > 0 && <div className={sty.c3fdcf88}>{p.skills.slice(0, 6).join(' · ')}</div>}
                          <div className={sty.c6a6caf2}>{p.gear.length ? 'Инвентарь: ' + p.gear.slice(0, 4).join(', ') : 'Свой инвентарь не указан'}</div>
                        </div>
                        <div className={sty.c671b9fc}>
                          {p.status === 'sent' && open && <>
                            <button className={'btn btn-primary ' + sty.c3fb23c6} disabled={busy || full} title={full ? 'Смена уже набрана' : ''} onClick={() => act(j.num, 'applicants/' + p.id + '/hire', 'Вы наняли ' + p.name + ' — чат открыт')}>Нанять</button>
                            <button className={'btn btn-ghost ' + sty.cd45451c} disabled={busy} onClick={() => act(j.num, 'applicants/' + p.id + '/reject', 'Отказ отправлен — ' + p.name)}>Отказ</button>
                          </>}
                          {p.status === 'hired' && open && crew > 1 && !p.isLead && (
                            <button className={'btn btn-secondary ' + sty.cd45451c} disabled={busy} onClick={() => act(j.num, 'applicants/' + p.id + '/lead', p.name + ' назначен старшим')}>Сделать старшим</button>
                          )}
                          {p.status === 'hired' && open && (
                            <button className={'btn btn-ghost ' + sty.cd45451c} disabled={busy}
                              onClick={() => { if (window.confirm('Снять ' + p.name + ' со смены? Остальные останутся, у исполнителя +1 к неявкам.')) act(j.num, 'applicants/' + p.id + '/no-show', p.name + ' снят со смены — набор открыт'); }}>Не вышел</button>
                          )}
                        </div>
                      </div>
                    ))}
                    {waiting.length > 0 && j.hired > 0 && open && (
                      <button className={'btn btn-ghost ' + sty.c3ee3479} disabled={busy} onClick={() => act(j.num, 'reject-rest', 'Остальным отправлен отказ — ' + waiting.length)}>Отказать остальным</button>
                    )}
                  </div>
                )}
                {!j.people.length && (
                  <div className={sty.c6067460}>Откликов пока нет — заказ в поиске.</div>
                )}
              </div>
            );
          })}
          {jobs && !jobs.length && (
            <div className={'blueprint ' + sty.c32aa2eb}>
              <Corners />
              <div className={'fh ' + sty.c3d16cc4}>Открытых заказов нет</div>
              <div className={sty.c1af9ede}>Опубликуйте заказ на карте — отклики появятся здесь, тут же нанимаете.</div>
              <Link href="/" className={'btn btn-primary ' + sty.c6c91caa}>Открыть карту</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
