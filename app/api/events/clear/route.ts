import { assertSameOrigin, currentUser, route } from '@/server/http';
import { clearEvents } from '@/server/profile';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  return clearEvents(await currentUser());
});
