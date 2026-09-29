import { currentUser, route } from '@/server/http';
import { listEvents } from '@/server/profile';

export const GET = route(async (req) => {
  const n = Number(new URL(req.url).searchParams.get('limit'));
  return listEvents(await currentUser(), Number.isInteger(n) && n > 0 ? n : 30);
});
