import { assertSameOrigin, currentUser, parseNum, route } from '@/server/http';
import { withdrawApplication } from '@/server/jobs';

export async function POST(req: Request, ctx: { params: Promise<{ num: string }> }) {
  const { num } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return { job: await withdrawApplication(parseNum(num), await currentUser()) };
  })(req);
}
