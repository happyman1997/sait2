import { describe, expect, it } from 'vitest';
import { stripMetadata } from '@/server/exif';

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap(p => (typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p)));
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));

// EXIF (little-endian): IFD0 с ориентацией 6 и «координатами» в виде строки-маркера.
function exifApp1(orientation: number) {
  const tiff = bytes([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0], [2, 0], [0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0],
    [0x25, 0x88, 4, 0, 1, 0, 0, 0, 38, 0, 0, 0], [0, 0, 0, 0], 'GPS-55.7558N-37.6173E');
  const body = bytes('Exif\0\0', [...tiff]);
  return bytes([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff], [...body]);
}

describe('удаление метаданных из фото', () => {
  it('JPEG: EXIF с GPS, XMP и комментарий убраны, ориентация и данные изображения сохранены', () => {
    const jfif = bytes([0xff, 0xe0, 0, 16], 'JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const xmp = bytes([0xff, 0xe1, 0, 31], 'http://ns.adobe.com/xap/1.0/\0');
    const com = bytes([0xff, 0xfe, 0, 9], 'iPhone!');
    const sos = bytes([0xff, 0xda, 0, 4, 1, 2], [0x11, 0x22, 0x33], [0xff, 0xd9]);
    const src = bytes([0xff, 0xd8], [...jfif], [...exifApp1(6)], [...xmp], [...com], [...sos]);
    const out = stripMetadata(src, 'image/jpeg');
    expect(has(out, 'GPS-55')).toBe(false);
    expect(has(out, 'adobe')).toBe(false);
    expect(has(out, 'iPhone')).toBe(false);
    expect(has(out, 'JFIF')).toBe(true);
    expect(Buffer.from(out.subarray(-7)).equals(Buffer.from(sos.subarray(-7)))).toBe(true);
    // Новый APP1 — только ориентация 6 (big-endian TIFF).
    const i = Buffer.from(out).indexOf(Buffer.from('Exif\0\0', 'latin1'));
    expect(i).toBeGreaterThan(0);
    expect([...out.subarray(i + 6 + 10, i + 6 + 12)]).toEqual([0x01, 0x12]);
    expect(out[i + 6 + 19]).toBe(6);
  });

  it('JPEG без ориентации — EXIF убран целиком; обрезанный файл не ломается', () => {
    const src = bytes([0xff, 0xd8], [...exifApp1(1)], [0xff, 0xda, 0, 2, 0xaa]);
    const out = stripMetadata(src, 'image/jpeg');
    expect(has(out, 'Exif')).toBe(false);
    const cut = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    expect([...stripMetadata(cut, 'image/jpeg')]).toEqual([...cut]);
  });

  it('PNG: tEXt и eXIf убраны, IHDR/IDAT/IEND на месте', () => {
    const chunk = (type: string, data: number[] | string) => {
      const d = typeof data === 'string' ? [...data].map(c => c.charCodeAt(0)) : data;
      return bytes([0, 0, 0, d.length], type, d, [0, 0, 0, 0]);
    };
    const src = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])],
      [...chunk('tEXt', 'Comment\0home')], [...chunk('eXIf', 'GPS-55')], [...chunk('IDAT', [1, 2, 3])], [...chunk('IEND', [])]);
    const out = stripMetadata(src, 'image/png');
    expect(has(out, 'home')).toBe(false);
    expect(has(out, 'GPS-55')).toBe(false);
    for (const t of ['IHDR', 'IDAT', 'IEND']) expect(has(out, t)).toBe(true);
  });

  it('WebP: чанк EXIF убран, флаг в VP8X снят, размер RIFF пересчитан', () => {
    const vp8x = bytes('VP8X', [10, 0, 0, 0], [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const exif = bytes('EXIF', [6, 0, 0, 0], 'GPS-55');
    const img = bytes('VP8L', [2, 0, 0, 0], [0x2f, 0]);
    const body = bytes('WEBP', [...vp8x], [...exif], [...img]);
    const src = bytes('RIFF', [body.length & 0xff, body.length >> 8, 0, 0], [...body]);
    const out = stripMetadata(src, 'image/webp');
    expect(has(out, 'GPS-55')).toBe(false);
    expect(out[20] & 0x0c).toBe(0);
    expect(out[4] | (out[5] << 8)).toBe(out.length - 8);
    expect(has(out, 'VP8L')).toBe(true);
  });
});
