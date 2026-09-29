import { currentUser, route } from '@/server/http';
import { listComplaints } from '@/server/support';

export const GET = route(async (req) => {
  const p = new URL(req.url).searchParams;
  return { complaints: await listComplaints(await currentUser(), p.get('status'), p.get('mine') === '1') };
});
