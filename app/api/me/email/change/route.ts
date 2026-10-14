import { startEmailChange } from '@/server/auth';
import { assertSameOrigin, readJson, requestCtx, requireUser, route } from '@/server/http';

/** Смена почты: новый адрес + текущий пароль → код в письме на новый адрес. */
export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const u = await requireUser();
  return startEmailChange(u.id, await readJson(req), await requestCtx());
});
