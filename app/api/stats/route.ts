import { platformStats } from '@/server/auth';
import { route } from '@/server/http';

export const GET = route(async () => platformStats());
