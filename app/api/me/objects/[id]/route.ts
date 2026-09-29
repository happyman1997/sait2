import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { deleteObject, saveObject } from '@/server/objects';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return { object: await saveObject(await currentUser(), await readJson(req), id) };
  })(req);
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return deleteObject(await currentUser(), id);
  })(req);
}
