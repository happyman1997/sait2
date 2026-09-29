import { currentUser, route } from '@/server/http';
import { listChats } from '@/server/shifts';

export const GET = route(async () => ({ chats: await listChats(await currentUser()) }));
