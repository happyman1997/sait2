import { changePassword } from '@/server/auth';
import { assertSameOrigin, readJson, requireUser, route } from '@/server/http';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const u = await requireUser();
  return changePassword(u.id, await readJson(req), u.session_id);
});
