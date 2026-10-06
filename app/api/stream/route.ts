import { currentUser } from '@/server/http';
import { one } from '@/server/db';
import { subscribe, type LiveEvent } from '@/server/live';
import { SESSION_MAX_DAYS } from '@/server/session';

export const dynamic = 'force-dynamic';

// Не больше 8 потоков на пользователя в процессе (вкладки, устройства); лишний закрывает самый старый —
// иначе тысячей соединений с одного аккаунта можно выбрать память и дескрипторы сервера.
const MAX_PER_USER = 8;
const open = new Map<string, (() => void)[]>();

// Server-Sent Events: живые обновления чата, смен и журнала для вошедшего пользователя.
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return new Response('unauthorized', { status: 401 });
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => { try { controller.enqueue(enc.encode(chunk)); } catch { cleanup(); } };
      send('retry: 5000\n\n');
      const unsub = await subscribe(u.id, (e: LiveEvent) => send('data: ' + JSON.stringify(e) + '\n\n'));
      // Пинг раз в 25 с держит соединение через прокси и балансировщики.
      // Раз в 5 минут проверяем, что вход ещё действует (блокировка, смена пароля, выход на всех устройствах).
      let ticks = 0;
      const close = () => { cleanup(); try { controller.close(); } catch { /* уже закрыт */ } };
      const ping = setInterval(async () => {
        send(': ping\n\n');
        if (++ticks % 12) return;
        const alive = await one<{ ok: boolean }>(
          `SELECT true AS ok FROM sessions s JOIN users us ON us.id = s.user_id WHERE s.id = $1 AND s.expires_at > now() AND s.created_at > now() - make_interval(days => $2) AND us.status = 'active'`,
          [u.session_id, SESSION_MAX_DAYS]).catch(() => ({ ok: true }));
        if (!alive) close();
      }, 25_000);
      const mine = open.get(u.id) ?? [];
      mine.push(close);
      open.set(u.id, mine);
      if (mine.length > MAX_PER_USER) mine[0]();
      cleanup = () => {
        clearInterval(ping); unsub();
        const list = open.get(u.id);
        if (list) { const i = list.indexOf(close); if (i >= 0) list.splice(i, 1); if (!list.length) open.delete(u.id); }
        cleanup = () => {};
      };
      req.signal.addEventListener('abort', () => { cleanup(); try { controller.close(); } catch { /* уже закрыт */ } });
    },
    cancel() { cleanup(); }
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' }
  });
}
