import { checkContacts } from '@/server/auth';
import { assertSameOrigin, readJson, route } from '@/server/http';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  return checkContacts(await readJson(req));
});
