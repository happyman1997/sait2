import { deleteJobPhoto } from '@/server/files';
import { assertSameOrigin, currentUser, parseNum, route } from '@/server/http';
import { getJob } from '@/server/jobs';

export async function DELETE(req: Request, ctx: { params: Promise<{ num: string; id: string }> }) {
  const { num, id } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    const n = parseNum(num);
    const u = await currentUser();
    await deleteJobPhoto(n, id, u);
    return { job: await getJob(n, u) };
  })(req);
}
