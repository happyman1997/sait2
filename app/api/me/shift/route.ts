import { currentUser, route } from '@/server/http';
import { currentShift } from '@/server/shifts';

export const GET = route(async () => ({ job: await currentShift(await currentUser()) }));
