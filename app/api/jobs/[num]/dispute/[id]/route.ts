import { actDispute } from '@/server/disputes';
import { assertSameOrigin, currentUser, parseNum, readJson, route } from '@/server/http';

export async function POST(req: Request, ctx: { params: Promise<{ num: string; id: string }> }) {
  const { num, id } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return { job: await actDispute(parseNum(num), id, await readJson(req), await currentUser()) };
  })(req);
}
