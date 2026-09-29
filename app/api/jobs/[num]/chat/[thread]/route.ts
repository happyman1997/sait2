import { assertSameOrigin, currentUser, parseNum, readJson, route } from '@/server/http';
import { listMessages, sendMessage } from '@/server/shifts';

type Ctx = { params: Promise<{ num: string; thread: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { num, thread } = await ctx.params;
  return route(async () => listMessages(parseNum(num), thread, await currentUser()))(req);
}

export async function POST(req: Request, ctx: Ctx) {
  const { num, thread } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return { message: await sendMessage(parseNum(num), thread, await readJson(req), await currentUser()) };
  })(req);
}
