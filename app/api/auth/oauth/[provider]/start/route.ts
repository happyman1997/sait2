import { NextResponse } from 'next/server';
import { config } from '@/server/config';
import { AppError } from '@/server/errors';
import { currentUser, requestCtx } from '@/server/http';
import { isProvider, NONCE_COOKIE, startOAuth } from '@/server/oauth';

/** «Войти через Яндекс ID / VK ID» (и «Привязать» в профиле: ?intent=link) — переход к сервису. */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const intent = q.get('intent') === 'link' ? 'link' : 'login';
  const apply = parseInt(q.get('apply') || '', 10);
  const base = config.publicUrl();
  const back = (path: string, msg: string) => NextResponse.redirect(new URL(path + (path.includes('?') ? '&' : '?') + 'oauth_error=' + encodeURIComponent(msg), base));
  try {
    if (!isProvider(provider)) throw new AppError(404, 'Неизвестный сервис входа.');
    const u = await currentUser();
    const r = await startOAuth(provider, intent, u?.id ?? null, Number.isSafeInteger(apply) && apply > 0 ? apply : null, await requestCtx());
    const res = NextResponse.redirect(r.url);
    // Браузер, начавший вход: без этой cookie возврат от сервиса и билет регистрации не сработают.
    res.cookies.set(NONCE_COOKIE, r.nonce, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies(), path: '/', maxAge: 40 * 60 });
    return res;
  } catch (e) {
    const msg = e instanceof AppError ? e.message : 'Не получилось начать вход — попробуйте ещё раз.';
    return back(intent === 'link' ? '/profile' : '/auth?mode=login', msg);
  }
}
