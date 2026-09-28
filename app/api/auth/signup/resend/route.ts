import { resendCode } from '@/server/auth';
import { assertSameOrigin, readJson, requestCtx, route } from '@/server/http';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const b = await readJson(req);
  return resendCode(b.challengeId, b.channel, 'signup', await requestCtx());
});
