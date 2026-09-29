import { pickAds } from '@/server/ads';
import { currentUser, route } from '@/server/http';

export const GET = route(async (req) => {
  const p = new URL(req.url).searchParams;
  const u = await currentUser();
  return { ads: await pickAds(p.get('place'), u?.role ?? null, Number(p.get('n')) || 1) };
});
