import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { setBase } from '@/server/profile';

export const PUT = route(async (req) => {
  await assertSameOrigin(req);
  return setBase(await currentUser(), await readJson(req));
});
