'use client';

// Живые данные вошедшего пользователя: поток событий (SSE), список диалогов, плашка «Сообщения», окно отзыва.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { ChatThread, JobDetail } from '@/lib/jobs';
import { useFlash } from '@/components/Toast';

export type LiveEvent =
  | { t: 'message'; num: number; thread: string }
  | { t: 'read'; num: number; thread: string }
  | { t: 'job'; num: number }
  | { t: 'event'; text: string; num: number | null };

export type Me = {
  id: string; name: string; role: 'freelancer' | 'employer'; city: string; avatarUrl: string | null;
  baseLat: number | null; baseLng: number | null; baseLabel: string; isStaff: boolean;
} | null;

export type ReviewRequest = {
  num: number; target: string; name: string; title: string; rating?: number; text?: string; editable?: boolean;
  onSaved?: (job: JobDetail) => void;
};

type Dock = { open: boolean; view: 'list' | 'chat'; num: number | null; thread: string | null };

type Ctx = {
  me: Me;
  chats: ChatThread[];
  unread: number;
  reloadChats: () => void;
  dock: Dock;
  setDock: (d: Partial<Dock>) => void;
  openChat: (num: number, thread: string) => void;
  onLive: (fn: (e: LiveEvent) => void) => () => void;
  review: ReviewRequest | null;
  openReview: (r: ReviewRequest | null) => void;
  place: 'map' | 'form' | 'page';
  setPlace: (p: 'map' | 'form' | 'page') => void;
  /** Непрочитанные события журнала. */
  journal: number;
  setJournal: (n: number) => void;
  /** Показывать события всплывающими уведомлениями (настройка «В открытой вкладке»). */
  setToasts: (on: boolean) => void;
  /** Правая панель «Журнал» / «Настройки». */
  rail: Rail;
  setRail: (r: Rail) => void;
  /** Рабочий режим: крупные кнопки и строки — удобно в перчатках на объекте. */
  workMode: boolean;
  setWorkMode: (on: boolean) => void;
};

export type Rail = 'journal' | 'settings' | null;

const LiveCtx = createContext<Ctx | null>(null);

export function useLive(): Ctx {
  const c = useContext(LiveCtx);
  if (!c) throw new Error('useLive вне LiveProvider');
  return c;
}

/** Подписка на живые события; обработчик можно менять между рендерами. */
export function useLiveEvent(fn: (e: LiveEvent) => void) {
  const { onLive } = useLive();
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  useEffect(() => onLive(e => ref.current(e)), [onLive]);
}

export function LiveProvider({ me, children }: { me: Me; children: ReactNode }) {
  const flash = useFlash();
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [dock, setDockState] = useState<Dock>({ open: false, view: 'list', num: null, thread: null });
  const [review, setReview] = useState<ReviewRequest | null>(null);
  const [place, setPlace] = useState<'map' | 'form' | 'page'>('page');
  const [journal, setJournal] = useState(0);
  const toasts = useRef(true);
  const setToasts = useCallback((on: boolean) => { toasts.current = on; }, []);
  const [rail, setRail] = useState<Rail>(null);
  const [workMode, setWorkModeState] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem('arena:work') === '1') setWorkModeState(true); } catch { /* приватный режим */ }
  }, []);
  useEffect(() => {
    if (workMode) document.documentElement.dataset.work = '1';
    else delete document.documentElement.dataset.work;
  }, [workMode]);
  const setWorkMode = useCallback((on: boolean) => {
    setWorkModeState(on);
    try { localStorage.setItem('arena:work', on ? '1' : '0'); } catch { /* не критично */ }
  }, []);
  const listeners = useRef(new Set<(e: LiveEvent) => void>());

  // me — новый объект при каждом обновлении серверной части; поток и список зависят только от того, кто вошёл.
  const meKey = me?.id ?? '';
  const reloadChats = useCallback(() => {
    if (!meKey) { setChats([]); return; }
    api<{ chats: ChatThread[] }>('/api/chats').then(r => setChats(r.chats)).catch(() => {});
  }, [meKey]);

  useEffect(() => { reloadChats(); }, [reloadChats]);
  useEffect(() => {
    if (!meKey) { setJournal(0); return; }
    api<{ unread: number; toasts: boolean }>('/api/events?limit=1').then(r => { setJournal(r.unread); toasts.current = r.toasts; }).catch(() => {});
  }, [meKey]);

  // Один поток на вкладку; браузер сам переподключается (retry: 5000).
  useEffect(() => {
    if (!meKey || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/stream');
    let reloadT: ReturnType<typeof setTimeout> | undefined;
    es.onmessage = (m) => {
      let e: LiveEvent;
      try { e = JSON.parse(m.data); } catch { return; }
      if (e.t === 'event') { if (toasts.current) flash(e.text); setJournal(n => n + 1); }
      if (e.t === 'message' || e.t === 'read') { clearTimeout(reloadT); reloadT = setTimeout(reloadChats, 150); }
      listeners.current.forEach(fn => fn(e));
    };
    return () => { clearTimeout(reloadT); es.close(); };
  }, [meKey, flash, reloadChats]);

  const onLive = useCallback((fn: (e: LiveEvent) => void) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);

  const setDock = useCallback((d: Partial<Dock>) => setDockState(s => ({ ...s, ...d })), []);
  const openChat = useCallback((num: number, thread: string) => setDockState({ open: true, view: 'chat', num, thread }), []);

  const value = useMemo<Ctx>(() => ({
    me, chats, unread: chats.reduce((n, c) => n + c.unread, 0), reloadChats, dock, setDock, openChat, onLive, review, openReview: setReview, place, setPlace,
    journal, setJournal, setToasts, rail, setRail, workMode, setWorkMode
  }), [setToasts, me, chats, reloadChats, dock, setDock, openChat, onLive, review, place, journal, rail, workMode, setWorkMode]);

  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}
