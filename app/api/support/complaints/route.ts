import { currentUser, route } from '@/server/http';
import { listComplaints } from '@/server/support';

export const GET = route(async (req) => ({ complaints: await listComplaints(await currentUser(), new URL(req.url).searchParams.get('status')) }));
