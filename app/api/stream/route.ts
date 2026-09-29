import { currentUser } from '@/server/http';
import { one } from '@/server/db';
import { subscribe, type LiveEvent } from '@/server/live';

export const dynamic = 'force-dynamic';

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
          `SELECT true AS ok FROM sessions s JOIN users us ON us.id = s.user_id WHERE s.id = $1 AND s.expires_at > now() AND us.status = 'active'`,
          [u.session_id]).catch(() => ({ ok: true }));
        if (!alive) close();
      }, 25_000);
      cleanup = () => { clearInterval(ping); unsub(); };
      req.signal.addEventListener('abort', () => { cleanup(); try { controller.close(); } catch { /* уже закрыт */ } });
    },
    cancel() { cleanup(); }
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' }
  });
}
