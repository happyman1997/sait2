import { NextResponse } from 'next/server';
import { completeRecover } from '@/server/auth';
import { assertSameOrigin, readJson, requestCtx, route, setSessionCookie } from '@/server/http';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const b = await readJson(req);
  const { user, session } = await completeRecover(b.challengeId, b.password, b.password2, await requestCtx());
  return setSessionCookie(NextResponse.json({ user }), session.token, session.expiresAt);
});
