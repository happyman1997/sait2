import { currentUser, route } from '@/server/http';
import { myJobs } from '@/server/shifts';

export const GET = route(async () => ({ jobs: await myJobs(await currentUser()) }));
