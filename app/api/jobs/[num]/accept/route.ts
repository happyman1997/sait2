import { assertSameOrigin, currentUser, parseNum, route } from '@/server/http';
import { acceptWork } from '@/server/shifts';

export async function POST(req: Request, ctx: { params: Promise<{ num: string }> }) {
  const { num } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return { job: await acceptWork(parseNum(num), await currentUser()) };
  })(req);
}
