import { resendCode } from '@/server/auth';
import { assertSameOrigin, readJson, requestCtx, requireUser, route } from '@/server/http';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  await requireUser();
  const b = await readJson(req);
  return resendCode(b.challengeId, 'sms', 'phone', await requestCtx());
});
