import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { listObjects, orderDefaults, saveObject } from '@/server/objects';

export const GET = route(async () => {
  const u = await currentUser();
  const [objects, defaults] = await Promise.all([listObjects(u), orderDefaults(u)]);
  return { objects, defaults };
});

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  return { object: await saveObject(await currentUser(), await readJson(req)) };
});
