import { clearAvatar, setAvatar } from '@/server/files';
import { assertSameOrigin, readForm, requireUser, route } from '@/server/http';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const u = await requireUser();
  const form = await readForm(req);
  return setAvatar(u, form.get('file'));
});

export const DELETE = route(async (req) => {
  await assertSameOrigin(req);
  return clearAvatar(await requireUser());
});
