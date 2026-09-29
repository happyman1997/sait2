import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { getJob, updateJob } from '@/server/jobs';

type Ctx = { params: Promise<{ num: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { num } = await ctx.params;
  return route(async () => ({ job: await getJob(parseInt(num, 10), await currentUser()) }))(req);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { num } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    const b = await readJson(req);
    return { job: await updateJob(parseInt(num, 10), b.job, await currentUser(), b.today) };
  })(req);
}
