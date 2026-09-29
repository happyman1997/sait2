import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { getSettings, saveSettings } from '@/server/profile';

export const GET = route(async () => ({ settings: await getSettings(await currentUser()) }));

export const PUT = route(async (req) => {
  await assertSameOrigin(req);
  return { settings: await saveSettings(await currentUser(), await readJson(req)) };
});
