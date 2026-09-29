import { currentUser, route } from '@/server/http';
import { findUsers } from '@/server/support';

export const GET = route(async (req) => ({ users: await findUsers(await currentUser(), new URL(req.url).searchParams.get('q')) }));
