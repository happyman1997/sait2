import { currentUser, route } from '@/server/http';
import { applicantsBoard } from '@/server/shifts';

export const GET = route(async () => applicantsBoard(await currentUser()));
