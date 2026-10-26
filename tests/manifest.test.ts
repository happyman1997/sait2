import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '@/app/manifest';

const pub = (p: string) => path.join(process.cwd(), 'public', p);
// Ширина и высота PNG — из заголовка IHDR.
const pngSize = (file: string) => { const b = fs.readFileSync(file); return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20); };

describe('сайт как приложение', () => {
  it('манифест: иконки на месте и нужного размера, есть maskable, ярлыки внутри сайта', () => {
    const m = manifest();
    expect(m.display).toBe('standalone');
    for (const i of m.icons!) expect(pngSize(pub(i.src))).toBe(i.sizes);
    expect(m.icons!.some(i => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
    for (const s of m.shortcuts!) expect(s.url.startsWith('/')).toBe(true);
  });

  it('страница «Нет интернета»: скрипт разрешён своей CSP (хеш совпадает)', () => {
    const html = fs.readFileSync(pub('offline.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    const hash = crypto.createHash('sha256').update(script).digest('base64');
    expect(html).toContain(`script-src 'sha256-${hash}'`);
    expect(fs.readFileSync(pub('sw.js'), 'utf8')).toContain("'/offline.html'");
  });
});
