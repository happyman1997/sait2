import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { config } from '@/server/config';
import { AppError } from '@/server/errors';
import { currentUser, requestCtx, setSessionCookie } from '@/server/http';
import { finishOAuth, isProvider, NONCE_COOKIE } from '@/server/oauth';
import { createSession } from '@/server/session';

/** Возврат от Яндекс ID / VK ID: вход, привязка или анкета регистрации с заполненными данными. */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const base = config.publicUrl();
  const go = (path: string) => NextResponse.redirect(new URL(path, base));
  const viewer = await currentUser();
  try {
    if (!isProvider(provider)) throw new AppError(404, 'Неизвестный сервис входа.');
    const nonce = (await cookies()).get(NONCE_COOKIE)?.value;
    const r = await finishOAuth(provider, new URL(req.url).searchParams, nonce, viewer?.id ?? null);
    if (r.kind === 'linked') return go('/profile?linked=' + r.provider);
    if (r.kind === 'signup') return go('/auth?oauth=' + encodeURIComponent(r.ticket) + (r.applyNum ? '&apply=' + r.applyNum : ''));
    const session = await createSession(r.userId, await requestCtx());
    return setSessionCookie(go(r.applyNum ? '/?job=' + r.applyNum : '/'), session.token, session.expiresAt);
  } catch (e) {
    const msg = e instanceof AppError ? e.message : 'Не получилось войти через сервис — попробуйте ещё раз или войдите по почте.';
    if (!(e instanceof AppError)) console.error('[oauth]', (e as Error).message);
    return go((viewer ? '/profile' : '/auth?mode=login') + (viewer ? '?' : '&') + 'oauth_error=' + encodeURIComponent(msg));
  }
}
