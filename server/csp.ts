// Content-Security-Policy страниц: скрипты — только с одноразовым nonce этого ответа ('strict-dynamic' пропускает
// то, что они подгружают сами). Теги <style> и таблицы стилей — тоже по nonce или со своего сайта (CSS-инъекция
// с селекторами не пройдёт); атрибуты style разрешены — ими интерфейс прототипа задаёт оформление, nonce на них
// не действует. Старым браузерам без style-src-elem/attr остаётся общий style-src. Шрифты — свои;
// внешний источник — только стиль и тайлы карты (или свой сервер тайлов, тогда и его нет).
const MAP_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

function origin(url: string): string | null {
  try { return new URL(url).origin; } catch { return null; }
}

export function buildCsp(nonce: string, opts: { dev?: boolean; connectExtra?: string } = {}): string {
  const connect = ["'self'", origin(MAP_STYLE), ...(opts.connectExtra || '').split(/\s+/)].filter(Boolean);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // В разработке стили вставляются тегами без nonce (горячая перезагрузка).
    `style-src-elem 'self' ${opts.dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    'connect-src ' + [...new Set(connect)].join(' '),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'report-uri /api/csp-report'
  ].join('; ');
}

/** Одноразовый nonce: 128 бит случайности в base64. */
export function makeNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}
