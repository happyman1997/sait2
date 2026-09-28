import type { CSSProperties } from 'react';

// Инлайн-стили прототипа переносятся строками CSS как есть — так проще держать пиксельное соответствие.
const cache = new Map<string, CSSProperties>();

export function css(text: string): CSSProperties {
  const hit = cache.get(text);
  if (hit) return hit;
  const out: Record<string, string> = {};
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    const key = prop.startsWith('--') ? prop : prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = value;
  }
  cache.set(text, out as CSSProperties);
  return out as CSSProperties;
}
