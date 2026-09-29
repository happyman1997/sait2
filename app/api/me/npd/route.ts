import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { checkNpd } from '@/server/verify';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const b = await readJson(req);
  return checkNpd(await currentUser(), b.inn);
});
