import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { assertSameOrigin, clearSessionCookie, route } from '@/server/http';
import { deleteSession, sessionCookieName } from '@/server/session';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const c = await cookies();
  await deleteSession(c.get(sessionCookieName())?.value);
  return clearSessionCookie(NextResponse.json({ ok: true }));
});
