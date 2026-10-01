import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { removeMark } from '@/server/support';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return removeMark(await currentUser(), id, await readJson(req));
  })(req);
}
