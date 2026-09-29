import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { pushPublicKey, subscribePush, unsubscribePush } from '@/server/push';

/** Публичный ключ VAPID для подписки в браузере (null — пуш на сервере не настроен). */
export const GET = route(async () => ({ key: pushPublicKey() }));

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  return subscribePush(await currentUser(), (await readJson(req)).subscription);
});

export const DELETE = route(async (req) => {
  await assertSameOrigin(req);
  return unsubscribePush(await currentUser(), (await readJson(req)).endpoint);
});
