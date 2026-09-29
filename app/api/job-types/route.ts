import { route } from '@/server/http';
import { clientToday, jobTypes } from '@/server/jobs';

export const GET = route(async (req) => ({ types: await jobTypes(clientToday(new URL(req.url).searchParams.get('today'))) }));
