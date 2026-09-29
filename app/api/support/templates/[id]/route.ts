import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { deleteTemplate, saveTemplate } from '@/server/support';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return { template: await saveTemplate(await currentUser(), await readJson(req), id) };
  })(req);
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return route(async () => {
    await assertSameOrigin(req);
    return deleteTemplate(await currentUser(), id);
  })(req);
}
