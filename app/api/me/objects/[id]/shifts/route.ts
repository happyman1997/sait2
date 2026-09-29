import { currentUser, route } from '@/server/http';
import { objectShifts } from '@/server/objects';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return route(async () => ({ shifts: await objectShifts(await currentUser(), id) }))(req);
}
