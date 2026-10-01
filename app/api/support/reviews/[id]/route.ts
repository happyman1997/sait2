import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { removeReview } from '@/server/support';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return removeReview(await currentUser(), id, await readJson(req));
  })(req);
}
