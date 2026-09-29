import { listDisputes } from '@/server/disputes';
import { AppError } from '@/server/errors';
import { currentUser, route } from '@/server/http';
import { isStaff } from '@/server/support';

export const GET = route(async (req) => {
  if (!(await isStaff(await currentUser()))) throw new AppError(404, 'Страница не найдена.');
  return { disputes: await listDisputes(new URL(req.url).searchParams.get('status')) };
});
