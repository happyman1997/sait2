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
import sty from './NotifyRail.module.css';

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
      <div onClick={() => setRail(null)} className={sty.c88cdade} />
      <aside role="dialog" aria-label={rail === 'settings' ? 'Настройки' : 'Журнал'}
        className={sty.c61f6465}>
        <div className={sty.ca68f838}>
          <div className={'fh ' + sty.c41db1e5}>{rail === 'settings' ? 'Настройки' : 'Журнал'}</div>
          <button className={'btn btn-ghost ' + sty.c165129c} onClick={() => setRail(null)}>Закрыть</button>
        </div>

        {rail === 'journal' && (
          <div className={'blueprint ' + sty.c57daa0f}>
            <Corners />
            <div className={sty.cad948e3}>
              <div style={css(LABEL)}>{heading}</div>
              {!!events?.length && <button className={'btn btn-ghost ' + sty.c2fc1dcc} onClick={clear}>Очистить</button>}
            </div>
            <div className={sty.cfcfa205}>
              {(events || []).map(ev => (
                <button key={ev.id} onClick={() => open(ev.href)} disabled={!ev.href}
                  style={css('text-align: left; cursor: ' + (ev.href ? 'pointer' : 'default') + '; background: transparent; border: 1px solid ' +
                    (!ev.read ? 'var(--color-accent)' : 'var(--color-divider)') + '; padding: 7px 9px; font-family: var(--font-body); color: inherit')}>
                  <span className={'fh ' + sty.c69bcb57}>
                    {ev.kind + (ev.muted ? ' · без доставки' : '')}
                  </span>
                  <span className={sty.cde65327}>{ev.text}</span>
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
            <div className={'blueprint ' + sty.c57daa0f}>
              <Corners />
              <div className={sty.c962b5bc}>
                <div style={css(LABEL)}>Оповещения</div>
                {s && <Switch on={s.enabled} onClick={() => save({ enabled: !s.enabled })} title={s.enabled ? 'Выключить оповещения' : 'Включить оповещения'} />}
              </div>
              {!s && <div style={css(NOTE + '; margin-top: 9px')}>Загружаем…</div>}
              {s && !s.enabled && <div className={sty.ceccbb76}>Доставка выключена — всплывающие, SMS и письма не приходят. Журнал продолжает вестись.</div>}
              {s && s.enabled && (
                <div>
                  <div className={sty.cc60885d}>
                    {([['push', 'Пуш: в открытой вкладке и в браузере'], ['sms', 'SMS'], ['email', emailVerified ? 'E-mail' : 'E-mail (сначала подтвердите адрес в профиле)']] as const).map(([k, label]) => (
                      <label key={k} className={sty.c0a06f94}>
                        <input type="checkbox" checked={s[k]} onChange={e => save({ [k]: e.target.checked })} className={sty.c9002738} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>

                  {s.push && push && push !== 'unsupported' && (
                    <div className={sty.c9e6b1c6}>
                      {push === 'on' && <span className="tag tag-accent">пуш на этом устройстве включён</span>}
                      {push === 'denied' && <span style={css(NOTE)}>Браузер запретил уведомления для сайта — разрешите их в настройках браузера.</span>}
                      {push === 'off-server' && <span style={css(NOTE)}>Пуш в браузер на сервере пока не настроен — уведомления приходят в открытой вкладке.</span>}
                      {(push === 'on' || push === 'off') && (
                        <button className={'btn btn-secondary ' + sty.cc6828af} disabled={busy} onClick={async () => {
                          setBusy(true);
                          try { setPush(push === 'on' ? await disablePush() : await enablePush()); } catch { flash('Не удалось включить пуш — попробуйте ещё раз'); } finally { setBusy(false); }
                        }}>{push === 'on' ? 'Выключить на этом устройстве' : 'Включить пуш на этом устройстве'}</button>
                      )}
                    </div>
                  )}

                  {isFree && (
                    <div>
                      <div className={'hr ' + sty.ce4bd369} />
                      <div className="field">
                        <label htmlFor="notify-radius">Радиус от дома</label>
                        <select id="notify-radius" className="input" value={s.radiusKm} onChange={e => save({ radiusKm: Number(e.target.value) })}>
                          {[10, 30, 50, 100, 300].map(r => <option key={r} value={r}>{'до ' + r + ' км'}</option>)}
                        </select>
                      </div>
                      <div className={sty.cd5c0860}>{'Рядом сейчас — ' + (near ? near.length : '…')}</div>
                      <div className={sty.cfcfa205}>
                        {(near || []).slice(0, 4).map(j => (
                          <button key={j.num} onClick={() => open('/?job=' + j.num)} className={sty.cf1cae7a}>
                            <span className={'fh ' + sty.c532e21a}>{j.title}</span>
                            <span style={css('display: block; ' + NOTE)}>{(j.distanceKm != null ? j.distanceKm.toFixed(1).replace('.', ',') + ' км · ' : '') + money(j.pay, j.unit)}</span>
                          </button>
                        ))}
                      </div>
                      {near?.length === 0 && <div style={css(NOTE + '; margin-top: 6px')}>В радиусе пока ничего — увеличьте радиус.</div>}
                    </div>
                  )}

                  <div className={'hr ' + sty.ce4bd369} />
                  <div className={sty.c962b5bc}>
                    <div style={css(LABEL)}>Тихие часы</div>
                    <Switch on={s.quietOn} onClick={() => save({ quietOn: !s.quietOn })} title={s.quietOn ? 'Выключить тихие часы' : 'Включить тихие часы'} />
                  </div>
                  {s.quietOn && (
                    <>
                      <div className={sty.c714f50b}>
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
                      <label className={sty.cd663655}>
                        <input type="checkbox" checked={s.urgentBypass} onChange={e => save({ urgentBypass: e.target.checked })} className={sty.c9002738} />
                        <span>Срочные смены приходят и в тихие часы</span>
                      </label>
                    </>
                  )}

                  <div className={'field ' + sty.c4bb9003}>
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

            <div className={'blueprint ' + sty.cfddee99}>
              <Corners />
              <div className={sty.c962b5bc}>
                <div style={css(LABEL)}>Рабочий режим</div>
                <Switch on={live.workMode} onClick={() => live.setWorkMode(!live.workMode)} title={live.workMode ? 'Выключить рабочий режим' : 'Включить рабочий режим'} />
              </div>
              <div style={css(NOTE + '; margin-top: 7px')}>Крупные кнопки и строки — удобно в перчатках и на ходу. Реклама в рабочем режиме не показывается. Настройка хранится на этом устройстве.</div>
            </div>

            <div className={'blueprint ' + sty.cfddee99}>
              <Corners />
              <div style={css(LABEL)}>База для поиска</div>
              <div className={sty.c7275f29}>
                {'Сейчас: ' + me.baseLabel + '. От неё считаются расстояния на карте' + (isFree ? ' и оповещения о сменах рядом.' : '.')}
              </div>
              <div className={sty.ce4947c8}>
                <input className={'input ' + sty.c168acf6} value={baseQ} onChange={e => { setBaseQ(e.target.value); setBaseErr(''); }} onKeyDown={e => { if (e.key === 'Enter') changeBase(); }}
                  aria-label="Новая база" placeholder="город, посёлок или адрес" />
                <button className={'btn btn-secondary ' + sty.c07b4ee6} onClick={changeBase} disabled={busy}>{busy ? 'Ищем…' : 'Сменить'}</button>
              </div>
              {baseErr && <div role="alert" className={sty.ca8c5b3d}>{baseErr}</div>}
            </div>

            <div className={'blueprint ' + sty.c8562f72}>
              <Corners />
              <div style={css(LABEL)}>Обозначения</div>
              <div className={sty.c51837f3}>
                <div className={sty.cca8dfae}><span className={sty.c4729215} />Заказ на карте</div>
                <div className={sty.cca8dfae}><span className={sty.c5981d15} />Выбранный заказ</div>
                <div className={sty.cca8dfae}><span className={sty.cf3db642} />Черновик заказа</div>
                <div className={sty.cca8dfae}><span className={sty.cd0f69c5} />Точка — заказ на плотной карте</div>
                <div className={sty.cca8dfae}><span className={'fh ' + sty.cfc1c96f}>7</span>Группа заказов — клик приближает</div>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
