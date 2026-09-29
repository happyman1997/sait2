import { listDisputes } from '@/server/disputes';
import { AppError } from '@/server/errors';
import { currentUser, route } from '@/server/http';
import { isStaff } from '@/server/support';

export const GET = route(async (req) => {
  const u = await currentUser();
  if (!u || !(await isStaff(u))) throw new AppError(404, 'Страница не найдена.');
  const p = new URL(req.url).searchParams;
  return { disputes: await listDisputes(p.get('status'), p.get('mine') === '1' ? u.id : undefined) };
});
