import { openDispute } from '@/server/disputes';
import { assertSameOrigin, currentUser, parseNum, readJson, route } from '@/server/http';

export async function POST(req: Request, ctx: { params: Promise<{ num: string }> }) {
  const { num } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return { job: await openDispute(parseNum(num), await readJson(req), await currentUser()) };
  })(req);
}
