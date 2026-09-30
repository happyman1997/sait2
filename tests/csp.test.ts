// Строгая CSP страниц: скрипты — только по nonce ответа, стили прототипа и внешние источники — по списку.
import { describe, expect, it } from 'vitest';
import { buildCsp, makeNonce } from '@/server/csp';

const dir = (csp: string, name: string) => csp.split('; ').find(d => d.startsWith(name + ' '))!;

describe('CSP', () => {
  it('скрипты — только nonce и strict-dynamic, без unsafe-inline; eval — только в разработке', () => {
    const csp = buildCsp('abc');
    expect(dir(csp, 'script-src')).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(dir(buildCsp('abc', { dev: true }), 'script-src')).toContain("'unsafe-eval'");
    for (const d of ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", 'report-uri /api/csp-report']) expect(csp).toContain(d);
  });

  it('соединения — свой сайт, стиль карты и дополнительные из CSP_CONNECT_SRC без повторов', () => {
    const c = dir(buildCsp('n', { connectExtra: 'https://tiles.example.org  https://tiles.openfreemap.org' }), 'connect-src');
    expect(c).toBe("connect-src 'self' https://tiles.openfreemap.org https://tiles.example.org");
  });

  it('nonce — 128 бит, каждый раз новый', () => {
    const a = makeNonce(), b = makeNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64')).toHaveLength(16);
  });
});
