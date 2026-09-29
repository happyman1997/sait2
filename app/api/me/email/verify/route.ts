import { assertSameOrigin, currentUser, route } from '@/server/http';
import { sendEmailVerification } from '@/server/verify';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  return sendEmailVerification(await currentUser());
});
