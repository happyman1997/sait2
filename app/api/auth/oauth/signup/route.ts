import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { oauthSignup } from '@/server/auth';
import { assertSameOrigin, readJson, requestCtx, route, setSessionCookie } from '@/server/http';
import { NONCE_COOKIE } from '@/server/oauth';

/** Регистрация после «Войти через…», когда сервис подтвердил телефон: без кода. */
export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const b = await readJson(req);
  const { user, session } = await oauthSignup(b, { offer: b.offerAccepted, pd: b.pdConsent }, (await cookies()).get(NONCE_COOKIE)?.value, await requestCtx());
  return setSessionCookie(NextResponse.json({ user }), session.token, session.expiresAt);
});
