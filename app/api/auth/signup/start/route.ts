import { startSignup } from '@/server/auth';
import { assertSameOrigin, readJson, requestCtx, route } from '@/server/http';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  return startSignup(await readJson(req), await requestCtx());
});
