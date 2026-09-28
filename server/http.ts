import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { config } from './config';
import { AppError } from './errors';
import { SESSION_COOKIE, sessionUser, type Ctx } from './session';

export async function requestCtx(): Promise<Ctx> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = fwd || h.get('x-real-ip') || null;
  return { ip: ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null, userAgent: h.get('user-agent') };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new AppError(415, 'Ожидается JSON.');
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    throw new AppError(400, 'Некорректный JSON.');
  }
}

/** Обёртка маршрута: AppError → JSON { error: { message, field, ... } }. */
export function route<T>(fn: (req: Request) => Promise<T | NextResponse>) {
  return async (req: Request) => {
    try {
      const out = await fn(req);
      return out instanceof NextResponse ? out : NextResponse.json(out);
    } catch (e) {
      if (e instanceof AppError) {
        const res = NextResponse.json({ error: { message: e.message, field: e.field, ...e.extra } }, { status: e.status });
        if (e.status === 429 && e.extra?.retryAfter) res.headers.set('Retry-After', String(e.extra.retryAfter));
        return res;
      }
      console.error(e);
      return NextResponse.json({ error: { message: 'Что-то пошло не так на сервере — попробуйте ещё раз.' } }, { status: 500 });
    }
  };
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.secureCookies(), path: '/', expires: expiresAt
  });
  return res;
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: config.secureCookies(), path: '/', maxAge: 0 });
  return res;
}

export async function currentUser() {
  const c = await cookies();
  return sessionUser(c.get(SESSION_COOKIE)?.value);
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new AppError(401, 'Нужно войти в аккаунт.');
  return u;
}

/** Защита от CSRF для изменяющих запросов: Origin должен совпадать с Host. */
export async function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return; // не-браузерные клиенты; cookie SameSite=Lax закрывает кросс-сайтовые формы
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  try {
    if (new URL(origin).host !== host) throw new AppError(403, 'Запрос с чужого сайта отклонён.');
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(403, 'Запрос с чужого сайта отклонён.');
  }
}
