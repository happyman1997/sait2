'use client';

// Правая панель прототипа: «Журнал» (события по сменам) и «Настройки» (оповещения, тихие часы, база, обозначения).
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { css } from '@/lib/css';
import { localISO, money, type JobSummary } from '@/lib/jobs';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push-client';
import { useFlash } from '@/components/Toast';
import { useLive, useLiveEvent } from './Live';
import { Corners, LABEL } from './ui';

type Ev = { id: string; kind: string; text: string; num: number | null; muted: boolean; read: boolean; at: string; href: string | null };
export type Settings = {
  enabled: boolean; push: boolean; sms: boolean; email: boolean; radiusKm: number;
  quietOn: boolean; quietFrom: number; quietTo: number; urgentBypass: boolean; dailyCap: number;
};

const NOTE = 'font-size: 12.5px; line-height: 1.4; color: color-mix(in srgb, var(--color-text) 64%, transparent)';
const HOURS = [20, 21, 22, 23, 0, 5, 6, 7, 8, 9];
const hh = (h: number) => String(h).padStart(2, '0') + ':00';

function Switch({ on, onClick, title }: { on: boolean; onClick: () => void; title: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} title={title} aria-label={title}
      style={css('cursor: pointer; width: 38px; height: 20px; flex: none; padding: 2px; display: flex; align-items: center; border: 1px solid var(--color-accent); background: ' +
        (on ? 'var(--color-accent)' : 'transparent') + '; justify-content: ' + (on ? 'flex-end' : 'flex-start'))}>
      <span style={css('width: 14px; height: 14px; display: block; background: ' + (on ? 'var(--color-bg)' : 'var(--color-accent)'))} />
    </button>
  );
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  const today = localISO(new Date()) === localISO(d);
  return (today ? 'сегодня' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })) + ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function NotifyRail() {
  const live = useLive();
  const { me, rail, setRail, setJournal, setToasts } = live;
  const router = useRouter();
  const flash = useFlash();
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [near, setNear] = useState<JobSummary[] | null>(null);
  const [baseQ, setBaseQ] = useState('');
  const [baseErr, setBaseErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailVerified, setEmailVerified] = useState(true);
  const [push, setPush] = useState<PushState | null>(null);
  const isFree = me?.role === 'freelancer';

  const loadEvents = useCallback(async () => {
    try {
      const r = await api<{ events: Ev[]; unread: number }>('/api/events');
      setEvents(r.events);
      if (r.unread) { setJournal(0); await api('/api/events/read', {}); }
    } catch { /* журнал подождёт */ }
  }, [setJournal]);

  useEffect(() => {
    if (rail === 'journal') loadEvents();
    if (rail === 'settings' && !settings) api<{ settings: Settings; emailVerified: boolean }>('/api/me/settings').then(r => { setSettings(r.settings); setEmailVerified(r.emailVerified); }).catch(() => {});
    if (rail === 'settings') pushState().then(setPush).catch(() => setPush('unsupported'));
  }, [rail, loadEvents, settings]);

  useLiveEvent(e => { if (e.t === 'event' && rail === 'journal') loadEvents(); });

  // «Рядом сейчас» — открытые смены в радиусе оповещений.
  const radius = settings?.radiusKm;
  useEffect(() => {
    if (rail !== 'settings' || !isFree || !radius) return;
    let stop = false;
    api<{ jobs: JobSummary[] }>('/api/jobs?' + new URLSearchParams({ today: localISO(), km: String(radius) }))
      .then(r => { if (!stop) setNear(r.jobs.filter(j => j.status === 'open' && !j.myStatus)); }).catch(() => {});
    return () => { stop = true; };
  }, [rail, isFree, radius]);

  useEffect(() => {
    if (!rail) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setRail(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [rail, setRail]);

  if (!rail || !me) return null;

  const save = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const prev = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    setToasts(next.enabled && next.push);
    try {
      const r = await api<{ settings: Settings }>('/api/me/settings', patch, 'PUT');
      setSettings(r.settings);
    } catch (e) {
      setSettings(prev);
      setToasts(prev.enabled && prev.push);
      flash(e instanceof ApiError ? e.message : 'Не удалось сохранить настройки');
    }
  };

  const clear = async () => {
    try { await api('/api/events/clear', {}); setEvents([]); flash('Журнал очищен'); } catch (e) { flash(e instanceof ApiError ? e.message : 'Не удалось очистить журнал'); }
  };

  const open = (href: string | null) => {
    if (!href) return;
    setRail(null);
    router.push(href);
  };

  const changeBase = async () => {
    const q = baseQ.trim();
    if (!q) { setBaseErr('Впишите населённый пункт или адрес.'); return; }
    setBusy(true); setBaseErr('');
    try {
      const r = await api<{ base: { label: string } }>('/api/me/base', { query: q }, 'PUT');
      setBaseQ('');
      flash('База — ' + r.base.label + '. Расстояния и оповещения считаются от неё.');
      router.refresh();
      window.dispatchEvent(new Event('arena:reload'));
    } catch (e) {
      setBaseErr(e instanceof ApiError ? e.message : 'Не удалось сменить базу');
    } finally { setBusy(false); }
  };

  const s = settings;
  const heading = me.role === 'employer' ? 'Журнал · отклики и выходы' : 'Журнал · мои смены';

  return (
    <div style={{ display: 'contents' }}>
      <div onClick={() => setRail(null)} style={css('position: fixed; inset: 0; z-index: 90; background: rgba(24, 30, 36, .45)')} />
      <aside role="dialog" aria-label={rail === 'settings' ? 'Настройки' : 'Журнал'}
        style={css('position: fixed; top: 0; right: 0; bottom: 0; z-index: 91; width: min(440px, 94vw); box-sizing: border-box; overflow: auto; padding: 22px 22px 34px; background: var(--color-neutral-100); border-left: 1px solid var(--color-divider); box-shadow: -20px 0 60px rgba(20, 26, 32, .28)')}>
        <div style={css('display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 4px')}>
          <div style={css('font-family: var(--font-heading); font-size: 21px; text-transform: uppercase; letter-spacing: .02em')}>{rail === 'settings' ? 'Настройки' : 'Журнал'}</div>
          <button className="btn btn-ghost" onClick={() => setRail(null)} style={css('height: 30px; font-size: 13px; flex: none')}>Закрыть</button>
        </div>

        {rail === 'journal' && (
          <div className="blueprint" style={css('margin-top: 20px; padding: 13px 12px')}>
            <Corners />
            <div style={css('display: flex; justify-content: space-between; align-items: baseline; gap: 8px')}>
              <div style={css(LABEL)}>{heading}</div>
              {!!events?.length && <button className="btn btn-ghost" onClick={clear} style={css('height: 22px; font-size: 12.5px')}>Очистить</button>}
            </div>
            <div style={css('display: grid; gap: 5px; margin-top: 7px')}>
              {(events || []).map(ev => (
                <button key={ev.id} onClick={() => open(ev.href)} disabled={!ev.href}
                  style={css('text-align: left; cursor: ' + (ev.href ? 'pointer' : 'default') + '; background: transparent; border: 1px solid ' +
                    (!ev.read ? 'var(--color-accent)' : 'var(--color-divider)') + '; padding: 7px 9px; font-family: var(--font-body); color: inherit')}>
                  <span style={css('display: block; font-family: var(--font-heading); font-size: 12.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--color-accent-700)')}>
                    {ev.kind + (ev.muted ? ' · без доставки' : '')}
                  </span>
                  <span style={css('display: block; font-size: 13px; line-height: 1.35; margin-top: 2px')}>{ev.text}</span>
                  <span style={css('display: block; ' + NOTE)}>{timeLabel(ev.at)}</span>
                </button>
              ))}
            </div>
            {events === null && <div style={css(NOTE + '; margin-top: 6px')}>Загружаем…</div>}
            {!!events?.length && <div style={css(NOTE + '; margin-top: 7px')}>{'Показаны последние ' + events.length + ' · «без доставки» — сверх дневного лимита, только в журнале.'}</div>}
            {events?.length === 0 && (
              <div style={css(NOTE + '; margin-top: 6px')}>
                {me.role === 'employer'
                  ? 'Пока тихо. Сюда придут отклики, выходы на смену, сдача работы и расчёт по вашим заказам.'
                  : 'Пока тихо. Сюда придут найм, перенос и приёмка по вашим сменам и новые смены рядом.'}
              </div>
            )}
          </div>
        )}

        {rail === 'settings' && (
          <>
            <div className="blueprint" style={css('margin-top: 20px; padding: 13px 12px')}>
              <Corners />
              <div style={css('display: flex; justify-content: space-between; align-items: center; gap: 8px')}>
                <div style={css(LABEL)}>Оповещения</div>
                {s && <Switch on={s.enabled} onClick={() => save({ enabled: !s.enabled })} title={s.enabled ? 'Выключить оповещения' : 'Включить оповещения'} />}
              </div>
              {!s && <div style={css(NOTE + '; margin-top: 9px')}>Загружаем…</div>}
              {s && !s.enabled && <div style={css('font-size: 13px; line-height: 1.45; margin-top: 9px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>Доставка выключена — всплывающие, SMS и письма не приходят. Журнал продолжает вестись.</div>}
              {s && s.enabled && (
                <div>
                  <div style={css('display: grid; gap: 6px; margin-top: 10px')}>
                    {([['push', 'Пуш: в открытой вкладке и в браузере'], ['sms', 'SMS'], ['email', emailVerified ? 'E-mail' : 'E-mail (сначала подтвердите адрес в профиле)']] as const).map(([k, label]) => (
                      <label key={k} style={css('display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer')}>
                        <input type="checkbox" checked={s[k]} onChange={e => save({ [k]: e.target.checked })} style={css('accent-color: var(--color-accent); width: 14px; height: 14px')} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>

                  {s.push && push && push !== 'unsupported' && (
                    <div style={css('margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap')}>
                      {push === 'on' && <span className="tag tag-accent">пуш на этом устройстве включён</span>}
                      {push === 'denied' && <span style={css(NOTE)}>Браузер запретил уведомления для сайта — разрешите их в настройках браузера.</span>}
                      {push === 'off-server' && <span style={css(NOTE)}>Пуш в браузер на сервере пока не настроен — уведомления приходят в открытой вкладке.</span>}
                      {(push === 'on' || push === 'off') && (
                        <button className="btn btn-secondary" disabled={busy} style={css('height: 32px; font-size: 12.5px')} onClick={async () => {
                          setBusy(true);
                          try { setPush(push === 'on' ? await disablePush() : await enablePush()); } catch { flash('Не удалось включить пуш — попробуйте ещё раз'); } finally { setBusy(false); }
                        }}>{push === 'on' ? 'Выключить на этом устройстве' : 'Включить пуш на этом устройстве'}</button>
                      )}
                    </div>
                  )}

                  {isFree && (
                    <div>
                      <div className="hr" style={css('margin: 12px 0 10px')} />
                      <div className="field">
                        <label htmlFor="notify-radius">Радиус от дома</label>
                        <select id="notify-radius" className="input" value={s.radiusKm} onChange={e => save({ radiusKm: Number(e.target.value) })}>
                          {[10, 30, 50, 100, 300].map(r => <option key={r} value={r}>{'до ' + r + ' км'}</option>)}
                        </select>
                      </div>
                      <div style={css('font-size: 13px; margin-top: 9px; color: color-mix(in srgb, var(--color-text) 70%, transparent)')}>{'Рядом сейчас — ' + (near ? near.length : '…')}</div>
                      <div style={css('display: grid; gap: 5px; margin-top: 7px')}>
                        {(near || []).slice(0, 4).map(j => (
                          <button key={j.num} onClick={() => open('/?job=' + j.num)} style={css('text-align: left; cursor: pointer; background: transparent; border: 1px solid var(--color-divider); padding: 7px 9px; font-family: var(--font-body); color: inherit')}>
                            <span style={css('display: block; font-family: var(--font-heading); font-size: 14px; text-transform: uppercase; letter-spacing: .02em')}>{j.title}</span>
                            <span style={css('display: block; ' + NOTE)}>{(j.distanceKm != null ? j.distanceKm.toFixed(1).replace('.', ',') + ' км · ' : '') + money(j.pay, j.unit)}</span>
                          </button>
                        ))}
                      </div>
                      {near?.length === 0 && <div style={css(NOTE + '; margin-top: 6px')}>В радиусе пока ничего — увеличьте радиус.</div>}
                    </div>
                  )}

                  <div className="hr" style={css('margin: 12px 0 10px')} />
                  <div style={css('display: flex; justify-content: space-between; align-items: center; gap: 8px')}>
                    <div style={css(LABEL)}>Тихие часы</div>
                    <Switch on={s.quietOn} onClick={() => save({ quietOn: !s.quietOn })} title={s.quietOn ? 'Выключить тихие часы' : 'Включить тихие часы'} />
                  </div>
                  {s.quietOn && (
                    <>
                      <div style={css('display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 9px')}>
                        <div className="field">
                          <label htmlFor="quiet-from">С</label>
                          <select id="quiet-from" className="input" value={s.quietFrom} onChange={e => save({ quietFrom: Number(e.target.value) })}>
                            {[...new Set([...HOURS, s.quietFrom])].map(h => <option key={h} value={h}>{hh(h)}</option>)}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="quiet-to">До</label>
                          <select id="quiet-to" className="input" value={s.quietTo} onChange={e => save({ quietTo: Number(e.target.value) })}>
                            {[...new Set([...HOURS, s.quietTo])].map(h => <option key={h} value={h}>{hh(h)}</option>)}
                          </select>
                        </div>
                      </div>
                      <label style={css('display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; margin-top: 9px')}>
                        <input type="checkbox" checked={s.urgentBypass} onChange={e => save({ urgentBypass: e.target.checked })} style={css('accent-color: var(--color-accent); width: 14px; height: 14px')} />
                        <span>Срочные смены приходят и в тихие часы</span>
                      </label>
                    </>
                  )}

                  <div className="field" style={css('margin-top: 12px')}>
                    <label htmlFor="notify-cap">Не больше уведомлений в день</label>
                    <select id="notify-cap" className="input" value={s.dailyCap} onChange={e => save({ dailyCap: Number(e.target.value) })}>
                      {[3, 5, 10, 30].map(v => <option key={v} value={v}>{'до ' + v}</option>)}
                    </select>
                  </div>
                  <div style={css(NOTE + '; margin-top: 8px')}>
                    {(s.quietOn ? 'Тихие часы с ' + hh(s.quietFrom) + ' до ' + hh(s.quietTo) + (s.urgentBypass ? ', срочные проходят' : ', срочные тоже молчат') : 'Тихие часы выключены') +
                      ' · не больше ' + s.dailyCap + ' SMS и писем в день, остальное копится в журнале.'}
                  </div>
                </div>
              )}
            </div>

            <div className="blueprint" style={css('margin-top: 14px; padding: 13px 12px')}>
              <Corners />
              <div style={css('display: flex; justify-content: space-between; align-items: center; gap: 8px')}>
                <div style={css(LABEL)}>Рабочий режим</div>
                <Switch on={live.workMode} onClick={() => live.setWorkMode(!live.workMode)} title={live.workMode ? 'Выключить рабочий режим' : 'Включить рабочий режим'} />
              </div>
              <div style={css(NOTE + '; margin-top: 7px')}>Крупные кнопки и строки — удобно в перчатках и на ходу. Реклама в рабочем режиме не показывается. Настройка хранится на этом устройстве.</div>
            </div>

            <div className="blueprint" style={css('margin-top: 14px; padding: 13px 12px')}>
              <Corners />
              <div style={css(LABEL)}>База для поиска</div>
              <div style={css('font-size: 14px; line-height: 1.45; margin-top: 7px')}>
                {'Сейчас: ' + me.baseLabel + '. От неё считаются расстояния на карте' + (isFree ? ' и оповещения о сменах рядом.' : '.')}
              </div>
              <div style={css('display: flex; gap: 6px; margin-top: 10px')}>
                <input className="input" value={baseQ} onChange={e => { setBaseQ(e.target.value); setBaseErr(''); }} onKeyDown={e => { if (e.key === 'Enter') changeBase(); }}
                  aria-label="Новая база" placeholder="город, посёлок или адрес" style={css('flex: 1; min-width: 0; height: 38px; min-height: 38px; font-size: 13px; padding: 0 10px')} />
                <button className="btn btn-secondary" onClick={changeBase} disabled={busy} style={css('height: 38px; font-size: 13px; flex: none')}>{busy ? 'Ищем…' : 'Сменить'}</button>
              </div>
              {baseErr && <div role="alert" style={css('font-size: 13px; line-height: 1.4; margin-top: 6px; color: var(--color-accent-900); font-weight: 600')}>{baseErr}</div>}
            </div>

            <div className="blueprint" style={css('margin-top: 14px; padding: 12px')}>
              <Corners />
              <div style={css(LABEL)}>Обозначения</div>
              <div style={css('display: grid; gap: 6px; margin-top: 8px; font-size: 13px; color: color-mix(in srgb, var(--color-text) 78%, transparent)')}>
                <div style={css('display: flex; align-items: center; gap: 8px')}><span style={css('width: 14px; height: 14px; border: 1px solid var(--color-accent); flex: none')} />Заказ на карте</div>
                <div style={css('display: flex; align-items: center; gap: 8px')}><span style={css('width: 14px; height: 14px; border: 1px solid var(--color-accent); background: var(--color-accent); flex: none')} />Выбранный заказ</div>
                <div style={css('display: flex; align-items: center; gap: 8px')}><span style={css('width: 14px; height: 14px; border: 1px dashed var(--color-accent); flex: none')} />Черновик заказа</div>
                <div style={css('display: flex; align-items: center; gap: 8px')}><span style={css('width: 9px; height: 9px; border: 1px solid var(--color-accent); margin: 0 2px; flex: none')} />Точка — заказ на плотной карте</div>
                <div style={css('display: flex; align-items: center; gap: 8px')}><span style={css('width: 18px; height: 18px; display: grid; place-items: center; font-family: var(--font-heading); font-size: 12px; color: var(--color-bg); background: var(--color-accent); border: 1px solid var(--color-accent-900); flex: none')}>7</span>Группа заказов — клик приближает</div>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
