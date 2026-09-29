'use client';

// Живые данные вошедшего пользователя: поток событий (SSE), список диалогов, плашка «Сообщения», окно отзыва.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { ChatThread, JobDetail } from '@/lib/jobs';
import { useFlash } from '@/components/Toast';

export type LiveEvent =
  | { t: 'message'; num: number; thread: string }
  | { t: 'read'; num: number; thread: string }
  | { t: 'job'; num: number }
  | { t: 'event'; text: string; num: number | null };

export type Me = { name: string; role: 'freelancer' | 'employer'; city: string; baseLat: number | null; baseLng: number | null } | null;

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
};

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
  ref.current = fn;
  useEffect(() => onLive(e => ref.current(e)), [onLive]);
}

export function LiveProvider({ me, children }: { me: Me; children: ReactNode }) {
  const flash = useFlash();
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [dock, setDockState] = useState<Dock>({ open: false, view: 'list', num: null, thread: null });
  const [review, setReview] = useState<ReviewRequest | null>(null);
  const [place, setPlace] = useState<'map' | 'form' | 'page'>('page');
  const listeners = useRef(new Set<(e: LiveEvent) => void>());

  // me — новый объект при каждом обновлении серверной части; поток и список зависят только от того, кто вошёл.
  const meKey = me ? me.role + '|' + me.name : '';
  const reloadChats = useCallback(() => {
    if (!meKey) { setChats([]); return; }
    api<{ chats: ChatThread[] }>('/api/chats').then(r => setChats(r.chats)).catch(() => {});
  }, [meKey]);

  useEffect(() => { reloadChats(); }, [reloadChats]);

  // Один поток на вкладку; браузер сам переподключается (retry: 5000).
  useEffect(() => {
    if (!meKey || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/stream');
    let reloadT: ReturnType<typeof setTimeout> | undefined;
    es.onmessage = (m) => {
      let e: LiveEvent;
      try { e = JSON.parse(m.data); } catch { return; }
      if (e.t === 'event') flash(e.text);
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
    me, chats, unread: chats.reduce((n, c) => n + c.unread, 0), reloadChats, dock, setDock, openChat, onLive, review, openReview: setReview, place, setPlace
  }), [me, chats, reloadChats, dock, setDock, openChat, onLive, review, place]);

  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}
