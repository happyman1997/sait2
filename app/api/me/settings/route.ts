import { one } from '@/server/db';
import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { getSettings, saveSettings } from '@/server/profile';

export const GET = route(async () => {
  const u = await currentUser();
  const settings = await getSettings(u);
  const v = await one<{ ok: boolean }>('SELECT email_verified_at IS NOT NULL AS ok FROM users WHERE id = $1', [u!.id]);
  return { settings, emailVerified: !!v?.ok };
});

export const PUT = route(async (req) => {
  await assertSameOrigin(req);
  return { settings: await saveSettings(await currentUser(), await readJson(req)) };
});
