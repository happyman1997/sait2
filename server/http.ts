import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { config } from './config';
import { AppError } from './errors';
import { observe } from './metrics';
import { sessionCookieName, sessionUser, type Ctx } from './session';

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

const JSON_LIMIT = 256 * 1024;

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new AppError(415, 'Ожидается JSON.');
  // Формы площадки — единицы килобайт; большой JSON — ошибка или попытка забить память.
  if (Number(req.headers.get('content-length') || 0) > JSON_LIMIT) throw new AppError(413, 'Слишком большой запрос.');
  let text: string;
  try { text = await req.text(); } catch { throw new AppError(400, 'Не удалось прочитать запрос.'); }
  if (text.length > JSON_LIMIT) throw new AppError(413, 'Слишком большой запрос.');
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    throw new AppError(400, 'Некорректный JSON.');
  }
}

/** Обёртка маршрута: AppError → JSON { error: { message, field, ... } }. */
export function route<T>(fn: (req: Request) => Promise<T | NextResponse>) {
  return async (req: Request) => {
    const t0 = performance.now();
    const res = await handle(fn, req);
    observe(res.status, (performance.now() - t0) / 1000);
    return res;
  };
}

const gzip = promisify(zlib.gzip);
const COMPRESS_MIN = 2048;

/**
 * JSON-ответ; крупный (поиск по карте — до 500 заказов, ~270 КБ) сжимается gzip, если клиент умеет.
 * Сжатие идёт в пуле потоков libuv и не держит цикл событий. За nginx с gzip можно выключить: COMPRESS_JSON=0.
 */
// Один и тот же объект (кэш выдачи для гостей) кодируется один раз: строка и сжатые байты запоминаются по ссылке.
const encoded = new WeakMap<object, { body: string; gz?: Promise<Buffer> }>();

async function json(out: unknown, req: Request): Promise<NextResponse> {
  const memo = out && typeof out === 'object' ? encoded.get(out) : undefined;
  const e = memo ?? { body: JSON.stringify(out) };
  if (!memo && out && typeof out === 'object') encoded.set(out, e);
  const body = e.body;
  const accepts = /\bgzip\b/.test(req.headers.get('accept-encoding') || '');
  if (body.length < COMPRESS_MIN || !accepts || !config.compressJson()) {
    return new NextResponse(body, { headers: { 'Content-Type': 'application/json' } });
  }
  e.gz ??= gzip(body, { level: 5 });
  const buf = await e.gz;
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' }
  });
}

async function handle<T>(fn: (req: Request) => Promise<T | NextResponse>, req: Request): Promise<NextResponse> {
  try {
    const out = await fn(req);
    return out instanceof NextResponse ? out : await json(out, req);
  } catch (e) {
    if (e instanceof AppError) {
      const res = NextResponse.json({ error: { message: e.message, field: e.field, ...e.extra } }, { status: e.status });
      if (e.status === 429 && e.extra?.retryAfter) res.headers.set('Retry-After', String(e.extra.retryAfter));
      return res;
    }
    // Ошибки Postgres, которые означают не сбой, а состояние данных или нагрузку.
    const code = (e as { code?: string }).code;
    if (code === '23505') return NextResponse.json({ error: { message: 'Такая запись уже есть — обновите страницу.' } }, { status: 409 });
    if (code === '40001' || code === '40P01') return NextResponse.json({ error: { message: 'Одновременное изменение — повторите действие.' } }, { status: 409 });
    if (code === '57014') {
      console.error('[db] statement timeout', req.url);
      return NextResponse.json({ error: { message: 'Сервер сейчас перегружен — попробуйте через минуту.' } }, { status: 503, headers: { 'Retry-After': '30' } });
    }
    console.error(e);
    return NextResponse.json({ error: { message: 'Что-то пошло не так на сервере — попробуйте ещё раз.' } }, { status: 500 });
  }
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(sessionCookieName(), token, {
    httpOnly: true, sameSite: 'lax', secure: config.secureCookies(), path: '/', expires: expiresAt
  });
  return res;
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(sessionCookieName(), '', { httpOnly: true, sameSite: 'lax', secure: config.secureCookies(), path: '/', maxAge: 0 });
  return res;
}

export async function currentUser() {
  const c = await cookies();
  return sessionUser(c.get(sessionCookieName())?.value);
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new AppError(401, 'Нужно войти в аккаунт.');
  return u;
}

/**
 * Защита от CSRF для изменяющих запросов. Браузер сам сообщает, откуда запрос: Sec-Fetch-Site (cross-site —
 * отказ) и Origin — он должен совпадать с адресом сайта: PUBLIC_URL в продакшене (заголовкам Host/X-Forwarded-Host
 * там не верим), Host — на стенде. Запрос без обоих заголовков — не из браузера; формы с чужих сайтов
 * без cookie (SameSite=Lax) и без JSON (readJson) ничего не сделают.
 */
export async function assertSameOrigin(req: Request) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new AppError(403, 'Запрос с чужого сайта отклонён.');
  const origin = req.headers.get('origin');
  if (!origin) return;
  const expected = config.isProd ? new URL(config.publicUrl()).host : req.headers.get('x-forwarded-host') || req.headers.get('host');
  let host = '';
  try { host = new URL(origin).host; } catch { /* «null» и мусор — чужой */ }
  if (!host || host !== expected) throw new AppError(403, 'Запрос с чужого сайта отклонён.');
}

/** multipart/form-data (загрузка файлов). Размер тела ограничен на уровне прокси и проверкой в files.ts. */
export async function readForm(req: Request): Promise<FormData> {
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('multipart/form-data')) throw new AppError(415, 'Ожидается загрузка файла.');
  // Без длины тело читалось бы целиком в память — браузер для FormData длину всегда присылает.
  const len = Number(req.headers.get('content-length') || 0);
  if (!len) throw new AppError(411, 'Не указан размер загрузки — обновите страницу и попробуйте ещё раз.');
  if (len > 9 * 1024 * 1024) throw new AppError(413, 'Файл больше 8 МБ — уменьшите фото.', 'file');
  try {
    return await req.formData();
  } catch {
    throw new AppError(400, 'Не удалось прочитать файл — попробуйте ещё раз.');
  }
}
