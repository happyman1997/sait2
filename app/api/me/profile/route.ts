import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { getProfile, updateProfile } from '@/server/profile';

export const GET = route(async () => getProfile(await currentUser()));

export const PATCH = route(async (req) => {
  await assertSameOrigin(req);
  const u = await currentUser();
  await updateProfile(u, await readJson(req));
  return getProfile(await currentUser());
});
