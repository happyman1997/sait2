import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { assign } from '@/server/support';

export async function POST(req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return assign(await currentUser(), kind, id, await readJson(req));
  })(req);
}
