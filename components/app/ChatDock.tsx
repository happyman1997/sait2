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
import sty from './ChatDock.module.css';

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
    if (e.t === 'resync' && showChat) load();
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
        <div className={sty.ca2b78a5}>
          <div className={'fh ' + sty.cfb36ef6}>новое сообщение</div>
          <div className={sty.c8388489}>Переписка живёт здесь — откройте «Сообщения».</div>
          <div className={sty.cd99d3cf}>▼</div>
        </div>
      )}
      {!narrow && <><i className="corner tl" /><i className="corner tr" /></>}
      <button onClick={() => setDock({ open: !dock.open })} aria-expanded={dock.open} title="Переписка с работодателями и исполнителями"
        style={css('width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 11px; padding: 0 14px; min-height: ' + (narrow ? '48px' : '52px') + '; border: 0; background: var(--color-accent); color: #fff; cursor: pointer; text-align: left')}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        <span className={'fh ' + sty.ced0a3ae}>Сообщения</span>
        {unread > 0 && <span className={'fh ' + sty.cbf6add9}>{unread}</span>}
        <span className={'fh ' + sty.c074b79a}>{dock.open ? 'свернуть ▾' : 'открыть ▴'}</span>
      </button>

      {dock.open && (
        <div style={css('display: flex; flex-direction: column; min-height: 0; ' + (narrow ? 'flex: 1' : 'height: min(620px, 72vh)') + '; background: var(--color-bg)')}>
          {!showChat && (
            <div className={sty.ce04d486}>
              <div className={'fh ' + sty.c1ef22c9}>Выберите диалог</div>
              {chats.map(c => (
                <div key={c.num + ':' + c.thread} className={sty.cbc4626e}>
                  <button onClick={() => setDock({ view: 'chat', num: c.num, thread: c.thread })} className={'job-row ' + sty.cdd3e782}>
                    <span className={'fh ' + sty.cf0a9aae}>{initialsOf(c.who)}</span>
                    <span className={sty.cba2e0b7}>
                      <span className={'fh ' + sty.c7d1228b}>{c.who} · {jobNum(c.num)}</span>
                      <span className={sty.cb335980}>{(c.lastMine ? 'Вы: ' : '') + c.last}</span>
                    </span>
                    {c.unread > 0 && <span className={'fh ' + sty.c164bdf3}>{c.unread}</span>}
                    <span className={sty.c854d3df}>→</span>
                  </button>
                </div>
              ))}
              {!chats.length && <div className={sty.c4e0813c}>Переписка открывается после найма — тогда диалог появится здесь.</div>}
            </div>
          )}

          {showChat && (
            <div className={sty.c30bd7cc}>
              <div className={sty.cc2dfd1f}>
                <button onClick={() => setDock({ view: 'list' })} className={'fh ' + sty.c30a4f79}>← все</button>
                <span className={'fh ' + sty.cb741258}>{thread?.initials || initialsOf(active?.who || '')}</span>
                <div className={sty.c33f2a66}>
                  <div className={'fh ' + sty.c0b950a1}>{thread?.who || active?.who || ''}</div>
                  <a href={'/?job=' + dock.num} className={sty.cef05be1}>Заказ {jobNum(dock.num!)} · {thread?.title || active?.title || ''}</a>
                </div>
              </div>
              <div ref={listRef} className={sty.c1c558ba}>
                {!thread && !error && <div className={sty.c1645d7b}>Загружаем переписку…</div>}
                {thread?.messages.map(m => (
                  <div key={m.id} style={css('display: flex; justify-content: ' + (m.mine ? 'flex-end' : 'flex-start'))}>
                    <div style={css('max-width: 74%; padding: 9px 12px; border: 1px solid ' + (m.mine ? 'var(--color-accent)' : 'var(--color-divider)') + (m.mine ? '; background: color-mix(in srgb, var(--color-accent) 12%, transparent)' : ''))}>
                      <div className={sty.c9088c99}>{m.text}</div>
                      <div style={css('font-size: 12px; letter-spacing: .14em; text-transform: uppercase; margin-top: 5px; color: ' + (m.mine ? 'var(--color-accent-700)' : 'color-mix(in srgb, var(--color-text) 62%, transparent)'))}>
                        {time(m.at) + (m.mine ? (m.read ? ' · прочитано' : ' · отправлено') : '')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {error && <div role="alert" className={sty.c8cd2397}>{error}</div>}
              <div className={sty.c6374bad}>
                {thread && !thread.canSend
                  ? <div className={sty.c1ce46b9}>Смена отменена или исполнитель снят — переписка только для чтения.</div>
                  : (
                    <>
                    <div className={sty.c969623c}>
                      {QUICK_REPLIES.map(q => (
                        <button key={q} className={'tag tag-outline ' + sty.c43790e9} onClick={() => send(q)} disabled={sending}>{q}</button>
                      ))}
                    </div>
                    <div className={sty.c09a5cc8}>
                      <input className={'input ' + sty.c6611d9c} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey} placeholder="Напишите сообщение…" aria-label="Сообщение" />
                      <button className={'btn btn-primary ' + sty.c74c97d9} onClick={() => send()} disabled={sending || !draft.trim()}>Отправить</button>
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

