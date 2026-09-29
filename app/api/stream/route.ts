import { currentUser } from '@/server/http';
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
      const ping = setInterval(() => send(': ping\n\n'), 25_000);
      cleanup = () => { clearInterval(ping); unsub(); };
      req.signal.addEventListener('abort', () => { cleanup(); try { controller.close(); } catch { /* уже закрыт */ } });
    },
    cancel() { cleanup(); }
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' }
  });
}
