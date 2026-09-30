import { assertSameOrigin, currentUser, parseNum, readJson, route } from '@/server/http';
import { seriesDayAction } from '@/server/shifts';

export async function POST(req: Request, ctx: { params: Promise<{ num: string }> }) {
  const { num } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return { job: await seriesDayAction(parseNum(num), await readJson(req), await currentUser()) };
  })(req);
}
