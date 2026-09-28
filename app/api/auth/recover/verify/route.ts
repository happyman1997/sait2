import { verifyRecover } from '@/server/auth';
import { assertSameOrigin, readJson, route } from '@/server/http';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const b = await readJson(req);
  return verifyRecover(b.challengeId, b.code);
});
