import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { config } from './config';
import { AppError } from './errors';
import { SESSION_COOKIE, sessionUser, type Ctx } from './session';

/**
 * IP клиента. Первое значение X-Forwarded-For задаёт сам клиент — ему верить нельзя (обход лимитов).
 * Берём адрес, добавленный нашим прокси: TRUST_PROXY_HOPS-й справа (по умолчанию 1 — один nginx/балансировщик).
 */
export function clientIp(h: Headers, hops = config.trustProxyHops()): string | null {
  const ok = (v: string | null | undefined) => (v && /^[0-9a-f.:]{3,45}$/i.test(v) ? v : null);
  if (hops <= 0) return null;
  const xff = (h.get('x-forwarded-for') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (xff.length >= hops) return ok(xff[xff.length - hops]);
  return ok(h.get('x-real-ip'));
}

export async function requestCtx(): Promise<Ctx> {
  const h = await headers();
  return { ip: clientIp(h), userAgent: h.get('user-agent') };
}

/** Номер заказа из пути: только цифры. */
export function parseNum(raw: string): number {
  if (!/^\d{1,15}$/.test(raw)) throw new AppError(404, 'Заказ не найден.');
  return Number(raw);
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

/** multipart/form-data (загрузка файлов). Размер тела ограничен на уровне прокси и проверкой в files.ts. */
export async function readForm(req: Request): Promise<FormData> {
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('multipart/form-data')) throw new AppError(415, 'Ожидается загрузка файла.');
  const len = Number(req.headers.get('content-length') || 0);
  if (len > 9 * 1024 * 1024) throw new AppError(413, 'Файл больше 8 МБ — уменьшите фото.', 'file');
  try {
    return await req.formData();
  } catch {
    throw new AppError(400, 'Не удалось прочитать файл — попробуйте ещё раз.');
  }
}
