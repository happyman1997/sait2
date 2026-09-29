import { adReport } from '@/server/ads';
import { AppError } from '@/server/errors';
import { currentUser, route } from '@/server/http';
import { isStaff } from '@/server/support';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const GET = route(async (req) => {
  if (!(await isStaff(await currentUser()))) throw new AppError(404, 'Страница не найдена.');
  const p = new URL(req.url).searchParams;
  const from = p.get('from') || '', to = p.get('to') || '';
  if (!DAY.test(from) || !DAY.test(to)) throw new AppError(422, 'Укажите период: даты с и по.');
  return { rows: await adReport(from, to) };
});
