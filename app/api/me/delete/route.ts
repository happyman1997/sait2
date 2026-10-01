import { NextResponse } from 'next/server';
import { deleteAccount } from '@/server/account';
import { assertSameOrigin, clearSessionCookie, readJson, requireUser, route } from '@/server/http';

// Удаление аккаунта: пароль и слово-подтверждение; после — выход на этом устройстве.
export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const u = await requireUser();
  await deleteAccount(u, await readJson(req));
  return clearSessionCookie(NextResponse.json({ ok: true }));
});
