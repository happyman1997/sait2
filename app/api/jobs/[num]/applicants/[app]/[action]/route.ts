import { AppError } from '@/server/errors';
import { assertSameOrigin, currentUser, parseNum, route } from '@/server/http';
import { staffAction, type StaffAction } from '@/server/shifts';

const ACTIONS: StaffAction[] = ['hire', 'reject', 'lead', 'no-show'];

export async function POST(req: Request, ctx: { params: Promise<{ num: string; app: string; action: string }> }) {
  const { num, app, action } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    if (!ACTIONS.includes(action as StaffAction)) throw new AppError(404, 'Неизвестное действие.');
    return { job: await staffAction(parseNum(num), app, action as StaffAction, await currentUser()) };
  })(req);
}
