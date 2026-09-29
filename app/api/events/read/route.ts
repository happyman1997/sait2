import { assertSameOrigin, currentUser, route } from '@/server/http';
import { markEventsRead } from '@/server/profile';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  return markEventsRead(await currentUser());
});
