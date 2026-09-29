import { addJobPhoto } from '@/server/files';
import { assertSameOrigin, currentUser, parseNum, readForm, route } from '@/server/http';
import { getJob } from '@/server/jobs';

export async function POST(req: Request, ctx: { params: Promise<{ num: string }> }) {
  const { num } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    const n = parseNum(num);
    const u = await currentUser();
    const form = await readForm(req);
    await addJobPhoto(n, form.get('kind'), form.get('file'), u);
    return { job: await getJob(n, u) };
  })(req);
}
