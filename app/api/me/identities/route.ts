import { assertSameOrigin, readJson, requireUser, route } from '@/server/http';
import { unlinkIdentity } from '@/server/oauth';

/** «Отвязать Яндекс ID / VK ID» в профиле. Вход по почте и паролю остаётся. */
export const DELETE = route(async (req) => {
  await assertSameOrigin(req);
  const u = await requireUser();
  return unlinkIdentity(u.id, (await readJson(req)).provider);
});
