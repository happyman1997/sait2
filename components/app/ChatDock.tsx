'use client';

// Плашка «Сообщения» внизу экрана (как в прототипе): список диалогов и переписка по заказу.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { css } from '@/lib/css';
import { jobNum, QUICK_REPLIES, type ChatMessage } from '@/lib/jobs';
import { showModeration } from '@/components/ModerationGuard';
import { useNarrow } from '@/components/useNarrow';
import { useLive, useLiveEvent } from './Live';
import { NAV_H } from './MobileShell';
import { initialsOf } from './ui';

type Thread = { messages: ChatMessage[]; canSend: boolean; who: string; initials: string; title: string };

const time = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? hm : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' + hm;
};

export function ChatDock({ place }: { place: 'map' | 'form' | 'page' }) {
  const { me, chats, unread, dock, setDock, reloadChats } = useLive();
  const narrow = useNarrow();
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const showChat = dock.open && dock.view === 'chat' && dock.num != null && dock.thread;

  const load = async () => {
    if (!dock.num || !dock.thread) return;
    try {
      setThread(await api<Thread>('/api/jobs/' + dock.num + '/chat/' + dock.thread));
      setError('');
      reloadChats();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось открыть чат');
    }
  };

  useEffect(() => { if (showChat) { setThread(null); load(); } }, [showChat, dock.num, dock.thread]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveEvent((e) => {
    if ((e.t === 'message' || e.t === 'read') && showChat && e.num === dock.num && e.thread === dock.thread) load();
  });
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [thread?.messages.length]);

  // На телефоне плашку заменяет пункт «Чат» нижнего меню; открытый чат — на весь экран над меню.
  if (!me || (narrow && (place === 'form' || !dock.open))) return null;

  const send = async (quick?: string) => {
    const text = (quick ?? draft).trim();
    if (!text || sending || !dock.num || !dock.thread) return;
    setSending(true);
    try {
      const r = await api<{ message: ChatMessage }>('/api/jobs/' + dock.num + '/chat/' + dock.thread, { text });
      setThread(t => (t ? { ...t, messages: t.messages.concat(r.message) } : t));
      if (quick === undefined) setDraft('');
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.body.moderation) showModeration('Сообщение', e.body.moderation.category, text);
      else setError(e instanceof ApiError ? e.message : 'Сообщение не отправилось');
    } finally { setSending(false); }
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  const left = place === 'map' ? 'left: calc(min(420px, max(320px, 100vw - 340px)) + 16px)'
    : place === 'form' ? 'left: calc(min(620px, max(420px, 100vw - 340px)) + 16px)' : 'right: 24px';
  const style = narrow
    ? 'position: fixed; left: 0; right: 0; top: 0; bottom: ' + NAV_H + '; z-index: 84; display: flex; flex-direction: column; background: var(--color-bg)'
    : 'position: fixed; ' + left + '; bottom: 0; z-index: 60; width: ' + (dock.open ? '400px' : '296px') + '; max-width: 92vw; box-sizing: border-box; display: flex; flex-direction: column; border: 1px solid var(--color-accent); border-bottom: 0; background: var(--color-bg); box-shadow: var(--shadow-lg)';
  const active = chats.find(c => c.num === dock.num && c.thread === dock.thread);

  return (
    <div className={narrow ? '' : 'blueprint'} style={css(style)} aria-label="Сообщения">
      {!dock.open && unread > 0 && !narrow && (
        <div style={css('position: absolute; left: 14px; bottom: 100%; margin-bottom: 12px; width: 232px; box-sizing: border-box; padding: 11px 12px; background: var(--ink); color: #f2efec; box-shadow: var(--shadow-lg)')}>
          <div style={css('font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .22em; text-transform: uppercase; color: rgba(242, 239, 236, .66)')}>новое сообщение</div>
          <div style={css('font-size: 13.5px; line-height: 1.4; margin-top: 4px')}>Переписка живёт здесь — откройте «Сообщения».</div>
          <div style={css('position: absolute; left: 18px; top: 100%; font-size: 20px; line-height: 1; color: var(--ink)')}>▼</div>
        </div>
      )}
      {!narrow && <><i className="corner tl" /><i className="corner tr" /></>}
      <button onClick={() => setDock({ open: !dock.open })} aria-expanded={dock.open} title="Переписка с работодателями и исполнителями"
        style={css('width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 11px; padding: 0 14px; min-height: ' + (narrow ? '48px' : '52px') + '; border: 0; background: var(--color-accent); color: #fff; cursor: pointer; text-align: left')}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        <span style={css('flex: none; font-family: var(--font-heading); font-weight: 600; font-size: 16px; letter-spacing: .14em; text-transform: uppercase; white-space: nowrap')}>Сообщения</span>
        {unread > 0 && <span style={css('flex: none; min-width: 21px; height: 21px; box-sizing: border-box; padding: 0 6px; display: grid; place-items: center; background: #fff; color: var(--color-accent-900); font-family: var(--font-heading); font-size: 13px; letter-spacing: .04em')}>{unread}</span>}
        <span style={css('flex: none; margin-left: auto; font-size: 12.5px; letter-spacing: .1em; text-transform: uppercase; font-family: var(--font-heading); opacity: .85; white-space: nowrap')}>{dock.open ? 'свернуть ▾' : 'открыть ▴'}</span>
      </button>

      {dock.open && (
        <div style={css('display: flex; flex-direction: column; min-height: 0; ' + (narrow ? 'flex: 1' : 'height: min(620px, 72vh)') + '; background: var(--color-bg)')}>
          {!showChat && (
            <div style={css('flex: 1; min-height: 0; overflow: auto')}>
              <div style={css('padding: 12px 14px 8px; font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .22em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 60%, transparent)')}>Выберите диалог</div>
              {chats.map(c => (
                <div key={c.num + ':' + c.thread} style={css('display: flex; align-items: stretch; border-bottom: 1px solid var(--color-divider)')}>
                  <button onClick={() => setDock({ view: 'chat', num: c.num, thread: c.thread })} className="job-row"
                    style={css('flex: 1; min-width: 0; box-sizing: border-box; display: flex; align-items: center; gap: 10px; text-align: left; cursor: pointer; padding: 10px 14px; border: 0; font-family: var(--font-body); color: inherit; background: transparent')}>
                    <span style={css('flex: none; width: 34px; height: 34px; display: grid; place-items: center; background: var(--color-accent); color: #fff; font-family: var(--font-heading); font-size: 13px; letter-spacing: .04em')}>{initialsOf(c.who)}</span>
                    <span style={css('min-width: 0; display: block; flex: 1')}>
                      <span style={css('display: block; font-family: var(--font-heading); font-weight: 600; font-size: 15.5px; text-transform: uppercase; letter-spacing: .02em; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{c.who} · {jobNum(c.num)}</span>
                      <span style={css('display: block; font-size: 12.5px; color: color-mix(in srgb, var(--color-text) 70%, transparent); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{(c.lastMine ? 'Вы: ' : '') + c.last}</span>
                    </span>
                    {c.unread > 0 && <span style={css('flex: none; min-width: 20px; height: 20px; padding: 0 5px; display: grid; place-items: center; background: var(--color-accent); color: #fff; font-family: var(--font-heading); font-size: 12px')}>{c.unread}</span>}
                    <span style={css('flex: none; color: var(--color-accent-900); font-size: 15px')}>→</span>
                  </button>
                </div>
              ))}
              {!chats.length && <div style={css('padding: 14px; font-size: 13.5px; line-height: 1.45; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>Переписка открывается после найма — тогда диалог появится здесь.</div>}
            </div>
          )}

          {showChat && (
            <div style={css('display: flex; flex-direction: column; min-height: 0; height: 100%')}>
              <div style={css('flex: none; display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--color-divider); background: var(--color-neutral-100)')}>
                <button onClick={() => setDock({ view: 'list' })} style={css('flex: none; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--color-divider); background: transparent; cursor: pointer; padding: 5px 9px; font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .14em; text-transform: uppercase; color: inherit')}>← все</button>
                <span style={css('flex: none; width: 30px; height: 30px; display: grid; place-items: center; background: var(--color-accent); color: #fff; font-family: var(--font-heading); font-size: 12px')}>{thread?.initials || initialsOf(active?.who || '')}</span>
                <div style={css('min-width: 0')}>
                  <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 15px; text-transform: uppercase; letter-spacing: .02em; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{thread?.who || active?.who || ''}</div>
                  <a href={'/?job=' + dock.num} style={css('display: block; font-size: 12px; color: color-mix(in srgb, var(--color-text) 66%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>Заказ {jobNum(dock.num!)} · {thread?.title || active?.title || ''}</a>
                </div>
              </div>
              <div ref={listRef} style={css('flex: 1; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px')}>
                {!thread && !error && <div style={css('font-size: 13px; color: color-mix(in srgb, var(--color-text) 60%, transparent)')}>Загружаем переписку…</div>}
                {thread?.messages.map(m => (
                  <div key={m.id} style={css('display: flex; justify-content: ' + (m.mine ? 'flex-end' : 'flex-start'))}>
                    <div style={css('max-width: 74%; padding: 9px 12px; border: 1px solid ' + (m.mine ? 'var(--color-accent)' : 'var(--color-divider)') + (m.mine ? '; background: color-mix(in srgb, var(--color-accent) 12%, transparent)' : ''))}>
                      <div style={css('font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere')}>{m.text}</div>
                      <div style={css('font-size: 12px; letter-spacing: .14em; text-transform: uppercase; margin-top: 5px; color: ' + (m.mine ? 'var(--color-accent-700)' : 'color-mix(in srgb, var(--color-text) 62%, transparent)'))}>
                        {time(m.at) + (m.mine ? (m.read ? ' · прочитано' : ' · отправлено') : '')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {error && <div role="alert" style={css('flex: none; padding: 8px 12px; font-size: 13px; color: var(--color-accent-900); border-top: 1px solid var(--color-accent)')}>{error}</div>}
              <div style={css('flex: none; border-top: 1px solid var(--color-divider); padding: 10px 12px')}>
                {thread && !thread.canSend
                  ? <div style={css('font-size: 13px; line-height: 1.4; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>Смена отменена или исполнитель снят — переписка только для чтения.</div>
                  : (
                    <>
                    <div style={css('display: flex; gap: 6px; overflow-x: auto; margin-bottom: 8px; padding-bottom: 2px')}>
                      {QUICK_REPLIES.map(q => (
                        <button key={q} className="tag tag-outline" onClick={() => send(q)} disabled={sending} style={css('flex: none; cursor: pointer; border-width: 1px; border-style: solid; white-space: nowrap')}>{q}</button>
                      ))}
                    </div>
                    <div style={css('display: flex; gap: 7px')}>
                      <input className="input" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey} placeholder="Напишите сообщение…" aria-label="Сообщение" style={css('flex: 1; min-width: 0; height: 40px')} />
                      <button className="btn btn-primary" onClick={() => send()} disabled={sending || !draft.trim()} style={css('height: 40px; font-size: 12.5px; letter-spacing: .08em; text-transform: uppercase; padding: 0 14px; flex: none')}>Отправить</button>
                    </div>
                    </>
                  )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

