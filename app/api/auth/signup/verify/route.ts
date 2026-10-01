import { NextResponse } from 'next/server';
import { verifySignup } from '@/server/auth';
import { sendEmailVerification } from '@/server/verify';
import { assertSameOrigin, readJson, requestCtx, route, setSessionCookie } from '@/server/http';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const b = await readJson(req);
  const { user, session } = await verifySignup(b.challengeId, b.code, { offer: b.offerAccepted, pd: b.pdConsent }, await requestCtx());
  // Письмо со ссылкой подтверждения e-mail; сбой отправки не мешает регистрации.
  await sendEmailVerification({ id: user.id, role: user.role }).catch(() => {});
  return setSessionCookie(NextResponse.json({ user }), session.token, session.expiresAt);
});
