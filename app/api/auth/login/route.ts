import { NextResponse } from 'next/server';
import { login } from '@/server/auth';
import { assertSameOrigin, readJson, requestCtx, route, setSessionCookie } from '@/server/http';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const b = await readJson(req);
  const { user, session } = await login(b.identifier, b.password, await requestCtx());
  return setSessionCookie(NextResponse.json({ user }), session.token, session.expiresAt);
});
