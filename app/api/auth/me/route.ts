import { loadProfile, publicUser } from '@/server/auth';
import { currentUser, route } from '@/server/http';

export const GET = route(async () => {
  const u = await currentUser();
  if (!u) return { user: null };
  return { user: publicUser(u), profile: await loadProfile(u.id, u.role) };
});
