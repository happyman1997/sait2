import { currentUser, route } from '@/server/http';
import { listStaff } from '@/server/support';

export const GET = route(async () => ({ staff: await listStaff(await currentUser()) }));
