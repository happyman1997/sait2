import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { listObjects, saveObject } from '@/server/objects';

export const GET = route(async () => ({ objects: await listObjects(await currentUser()) }));

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  return { object: await saveObject(await currentUser(), await readJson(req)) };
});
