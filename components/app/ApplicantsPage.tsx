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

type Person = {
  id: string; name: string; initials: string; status: 'sent' | 'hired' | 'rejected' | 'withdrawn'; isLead: boolean; appliedAt: string;
  rating: number | null; reviews: number; done: number; noShows: number; gear: string[]; ownCar: boolean; cities: string[]; skills: string[];
  reqConfirmed: boolean; lateMark: boolean;
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
  useLiveEvent(e => { if (e.t === 'job') load(); });

  const act = async (num: number, path: string, ok: string) => {
    setBusy(true);
    try { await api('/api/jobs/' + num + '/' + path, {}); flash(ok); load(); }
    catch (e) { flash(e instanceof ApiError ? e.message : 'Не получилось — попробуйте ещё раз'); }
    finally { setBusy(false); }
  };

  const fact = (label: string, value: string, warn = false) => (
    <div key={label} style={css('display: flex; gap: 6px; align-items: baseline; font-size: 13.5px; line-height: 1.6')}>
      <span style={css('font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .16em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 58%, transparent)')}>{label}</span>
      <span style={css(warn ? 'color: var(--color-accent-900); font-weight: 600' : '')}>{value}</span>
    </div>
  );

  return (
    <div style={css('flex: 1; min-height: 0; overflow: auto; padding: 22px 24px 90px')}>
      <div style={css('max-width: 1144px; margin: 0 auto')}>
        <div style={css('display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; margin-bottom: 4px')}>
          <Link href="/" className="btn btn-primary" style={css('height: 36px; font-size: 13.5px; padding: 0 14px')}>← Вернуться к карте</Link>
          <h2 style={css('margin: 0; font-size: 29px; text-transform: uppercase; letter-spacing: .02em')}>Отклики</h2>
        </div>
        <div style={css('font-size: 14px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>Найм и отказы — в одном месте</div>

        <div style={css('display: grid; gap: 10px; margin-top: 16px; max-width: 860px')}>
          {!jobs && <div style={css('font-size: 14px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>Загружаем…</div>}
          {jobs?.map(j => {
            const s = jobStatus(j, 'employer');
            const crew = crewOf(j);
            const full = j.hired >= crew;
            const open = j.status === 'open' || j.status === 'staffed';
            const waiting = j.people.filter(p => p.status === 'sent');
            return (
              <div key={j.num} className="blueprint" style={css('padding: 12px 14px')}>
                <Corners />
                <div style={css('display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap')}>
                  <div style={css('font-family: var(--font-heading); font-size: 13px; letter-spacing: .18em; color: color-mix(in srgb, var(--color-text) 62%, transparent); padding-top: 4px')}>{jobNum(j.num)}</div>
                  <div style={css('flex: 1; min-width: 180px')}>
                    <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 22px; line-height: 1.1; text-transform: uppercase; letter-spacing: .02em')}>{j.title}</div>
                    <div style={css('font-size: 15px; line-height: 1.4; color: color-mix(in srgb, var(--color-text) 70%, transparent); margin-top: 2px')}>{j.address} · {dateLabel(j.date)}</div>
                    <div style={css('display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 6px')}>
                      <span className={s.cls}>{s.label}</span>
                      <span style={css('font-size: 14.5px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>
                        {j.people.length + ' ' + plural(j.people.length, 'отклик', 'отклика', 'откликов')}{crew > 1 ? ' · нанято ' + j.hired + (crew === Infinity ? '' : ' из ' + crew) : ''}
                      </span>
                    </div>
                  </div>
                  <div style={css('text-align: right')}>
                    <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 24px; line-height: 1.1')}>{money(j.pay, j.unit)}</div>
                    <div style={css('display: flex; gap: 6px; margin-top: 7px; justify-content: flex-end; flex-wrap: wrap')}>
                      <Link href={'/?job=' + j.num} className="btn btn-primary" style={css('height: 34px; font-size: 13.5px')}>На карте</Link>
                    </div>
                  </div>
                </div>

                {j.people.length > 0 && (
                  <div style={css('display: grid; gap: 6px; margin-top: 10px')}>
                    {j.people.map(p => (
                      <div key={p.id} style={css('display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; padding: 10px 11px; border: 1px solid ' + (p.status === 'hired' ? 'var(--color-accent)' : 'var(--color-divider)') + (p.status === 'hired' ? '; background: color-mix(in srgb, var(--color-accent) 7%, transparent)' : ''))}>
                        <div style={css('width: 64px; height: 72px; border: 1px solid var(--color-divider); display: grid; place-items: center; font-family: var(--font-heading); font-size: 24px; letter-spacing: .04em; color: var(--color-accent-700); flex: none')}>{p.initials}</div>
                        <div style={css('flex: 1; min-width: 200px')}>
                          <div style={css('display: flex; align-items: center; gap: 8px; flex-wrap: wrap')}>
                            <span style={css('font-family: var(--font-heading); font-weight: 600; font-size: 19px; text-transform: uppercase; letter-spacing: .02em')}>{p.name}</span>
                            <span className={p.status === 'hired' ? 'tag tag-accent' : 'tag tag-outline'}>{p.status === 'hired' ? (p.isLead ? 'старший' : 'нанят') : 'ждёт решения'}</span>
                            <span style={css('font-size: 13.5px; color: color-mix(in srgb, var(--color-text) 60%, transparent)')}>{ago(p.appliedAt)}</span>
                          </div>
                          <div style={css('display: flex; flex-wrap: wrap; gap: 0 14px; margin-top: 7px')}>
                            {fact('рейтинг', p.rating != null ? p.rating.toFixed(1) + ' · ' + p.reviews + ' ' + plural(p.reviews, 'отзыв', 'отзыва', 'отзывов') : 'пока нет')}
                            {fact('смен', String(p.done))}
                            {fact('невыходов', p.noShows ? String(p.noShows) : 'ни разу', p.noShows > 0)}
                            {fact('транспорт', p.ownCar ? 'свой' : 'нет')}
                            {p.cities.length > 0 && fact('города', p.cities.slice(0, 3).join(', '))}
                            {p.lateMark && fact('пометка', 'поздний отказ за 90 дней', true)}
                          </div>
                          {p.skills.length > 0 && <div style={css('font-size: 13.5px; margin-top: 6px; color: color-mix(in srgb, var(--color-text) 72%, transparent)')}>{p.skills.slice(0, 6).join(' · ')}</div>}
                          <div style={css('font-size: 13.5px; color: color-mix(in srgb, var(--color-text) 64%, transparent); margin-top: 5px')}>{p.gear.length ? 'Инвентарь: ' + p.gear.slice(0, 4).join(', ') : 'Свой инвентарь не указан'}</div>
                        </div>
                        <div style={css('display: flex; gap: 6px; flex: none; align-self: center; flex-wrap: wrap')}>
                          {p.status === 'sent' && open && <>
                            <button className="btn btn-primary" disabled={busy || full} title={full ? 'Смена уже набрана' : ''} onClick={() => act(j.num, 'applicants/' + p.id + '/hire', 'Вы наняли ' + p.name + ' — чат открыт')} style={css('height: 38px; font-size: 13.5px; padding: 0 15px')}>Нанять</button>
                            <button className="btn btn-ghost" disabled={busy} onClick={() => act(j.num, 'applicants/' + p.id + '/reject', 'Отказ отправлен — ' + p.name)} style={css('height: 38px; font-size: 13.5px')}>Отказ</button>
                          </>}
                          {p.status === 'hired' && open && crew > 1 && !p.isLead && (
                            <button className="btn btn-secondary" disabled={busy} onClick={() => act(j.num, 'applicants/' + p.id + '/lead', p.name + ' назначен старшим')} style={css('height: 38px; font-size: 13.5px')}>Сделать старшим</button>
                          )}
                          {p.status === 'hired' && open && (
                            <button className="btn btn-ghost" disabled={busy}
                              onClick={() => { if (window.confirm('Снять ' + p.name + ' со смены? Остальные останутся, у исполнителя +1 к неявкам.')) act(j.num, 'applicants/' + p.id + '/no-show', p.name + ' снят со смены — набор открыт'); }}
                              style={css('height: 38px; font-size: 13.5px')}>Не вышел</button>
                          )}
                        </div>
                      </div>
                    ))}
                    {waiting.length > 0 && j.hired > 0 && open && (
                      <button className="btn btn-ghost" disabled={busy} onClick={() => act(j.num, 'reject-rest', 'Остальным отправлен отказ — ' + waiting.length)} style={css('height: 34px; font-size: 13px; justify-self: start')}>Отказать остальным</button>
                    )}
                  </div>
                )}
                {!j.people.length && (
                  <div style={css('margin-top: 9px; border: 1px dashed var(--color-divider); padding: 9px 11px; font-size: 14px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>Откликов пока нет — заказ в поиске.</div>
                )}
              </div>
            );
          })}
          {jobs && !jobs.length && (
            <div className="blueprint" style={css('padding: 32px; text-align: center; color: color-mix(in srgb, var(--color-text) 70%, transparent)')}>
              <Corners />
              <div style={css('font-family: var(--font-heading); font-size: 20px; text-transform: uppercase; letter-spacing: .02em; color: var(--color-text)')}>Открытых заказов нет</div>
              <div style={css('font-size: 15px; line-height: 1.5; margin-top: 8px; max-width: 48ch; margin-left: auto; margin-right: auto; text-wrap: pretty')}>Опубликуйте заказ на карте — отклики появятся здесь, тут же нанимаете.</div>
              <Link href="/" className="btn btn-primary" style={css('margin-top: 14px; height: 40px; font-size: 13.5px')}>Открыть карту</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
