import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { listTemplates, saveTemplate } from '@/server/support';

export const GET = route(async () => ({ templates: await listTemplates(await currentUser()) }));

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  return { template: await saveTemplate(await currentUser(), await readJson(req)) };
});
