// Живые обновления: Postgres LISTEN/NOTIFY → Server-Sent Events.
// NOTIFY внутри транзакции уходит только после COMMIT, поэтому клиент не увидит того, что откатилось.
// Каждый инстанс держит одно LISTEN-соединение и раздаёт события своим подключённым пользователям.
import { Client } from 'pg';
import { config } from './config';
import { pool, type Db } from './db';

export const LIVE_CHANNEL = 'arena_live';

export type LiveEvent =
  | { t: 'message'; num: number; thread: string }      // новое сообщение в диалоге (thread = freelancerId)
  | { t: 'read'; num: number; thread: string }         // вторая сторона прочитала
  | { t: 'job'; num: number }                          // изменился заказ/смена
  | { t: 'event'; text: string; num: number | null };  // запись журнала — показать уведомлением

type Sink = (e: LiveEvent) => void;

type Hub = { subs: Map<string, Set<Sink>>; client: Client | null; connecting: Promise<void> | null };
const g = globalThis as unknown as { __arenaLive?: Hub };
const hub: Hub = (g.__arenaLive ??= { subs: new Map<string, Set<Sink>>(), client: null, connecting: null });

async function ensureListener() {
  if (hub.client || hub.connecting) return hub.connecting ?? undefined;
  hub.connecting = (async () => {
    const c = new Client({ connectionString: config.databaseUrl() });
    c.on('notification', (n) => {
      if (n.channel !== LIVE_CHANNEL || !n.payload) return;
      try {
        const { u, e } = JSON.parse(n.payload) as { u: string[]; e: LiveEvent };
        for (const id of u) hub.subs.get(id)?.forEach(fn => fn(e));
      } catch { /* битый payload игнорируем */ }
    });
    const reconnect = () => {
      hub.client = null;
      c.end().catch(() => {});
      // Переподключаемся, только пока есть слушатели.
      setTimeout(() => { if (hub.subs.size) ensureListener().catch(() => {}); }, 2000);
    };
    c.on('error', reconnect);
    c.on('end', () => { if (hub.client === c) reconnect(); });
    await c.connect();
    await c.query('LISTEN ' + LIVE_CHANNEL);
    hub.client = c;
  })().finally(() => { hub.connecting = null; });
  return hub.connecting;
}

export async function subscribe(userId: string, sink: Sink): Promise<() => void> {
  await ensureListener();
  let set = hub.subs.get(userId);
  if (!set) hub.subs.set(userId, (set = new Set<Sink>()));
  set.add(sink);
  return () => {
    set!.delete(sink);
    if (!set!.size) hub.subs.delete(userId);
  };
}

/** Отправить событие пользователям (в транзакции — после COMMIT). */
export async function publish(userIds: (string | null | undefined)[], e: LiveEvent, db: Db = pool()) {
  const u = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!u.length) return;
  // Лимит NOTIFY — 8000 байт; события короткие, текст журнала обрезаем.
  const ev = e.t === 'event' ? { ...e, text: e.text.slice(0, 300) } : e;
  await db.query('SELECT pg_notify($1, $2)', [LIVE_CHANNEL, JSON.stringify({ u: u.slice(0, 100), e: ev })]);
}
