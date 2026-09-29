import { assertSameOrigin, currentUser, parseNum, route } from '@/server/http';
import { markSettled } from '@/server/shifts';

export async function POST(req: Request, ctx: { params: Promise<{ num: string }> }) {
  const { num } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return { job: await markSettled(parseNum(num), await currentUser()) };
  })(req);
}
