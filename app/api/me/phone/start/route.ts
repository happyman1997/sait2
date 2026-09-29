import { startPhoneChange } from '@/server/auth';
import { assertSameOrigin, readJson, requestCtx, requireUser, route } from '@/server/http';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const u = await requireUser();
  return startPhoneChange(u.id, await readJson(req), await requestCtx());
});
