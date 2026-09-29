import { assertSameOrigin, currentUser, parseNum, readJson, route } from '@/server/http';
import { setSafety } from '@/server/shifts';

export async function POST(req: Request, ctx: { params: Promise<{ num: string }> }) {
  const { num } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    const b = await readJson(req);
    return { job: await setSafety(parseNum(num), b.items, await currentUser()) };
  })(req);
}
