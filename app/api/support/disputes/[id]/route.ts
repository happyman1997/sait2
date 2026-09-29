import { resolveDispute } from '@/server/disputes';
import { AppError } from '@/server/errors';
import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { isStaff } from '@/server/support';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    const u = await currentUser();
    if (!u || !(await isStaff(u))) throw new AppError(404, 'Страница не найдена.');
    return resolveDispute(u.id, id, await readJson(req));
  })(req);
}
