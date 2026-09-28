import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { assertSameOrigin, clearSessionCookie, route } from '@/server/http';
import { deleteSession, SESSION_COOKIE } from '@/server/session';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const c = await cookies();
  await deleteSession(c.get(SESSION_COOKIE)?.value);
  return clearSessionCookie(NextResponse.json({ ok: true }));
});
