import { verifyPhoneChange } from '@/server/auth';
import { assertSameOrigin, readJson, requireUser, route } from '@/server/http';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const u = await requireUser();
  const b = await readJson(req);
  return verifyPhoneChange(u.id, b.challengeId, b.code);
});
