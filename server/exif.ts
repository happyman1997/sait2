// Удаление метаданных из загруженных фото: EXIF (GPS-координаты места съёмки, модель телефона, время), XMP, IPTC,
// комментарии. Браузер пережимает крупные снимки сам, но небольшие уходят как есть — и аватар, видный всем,
// выдал бы, где человек живёт. Пиксели не трогаем: из EXIF сохраняется только ориентация, иначе фото с телефона
// повернулось бы набок.
import type { Mime } from './files';

export function stripMetadata(buf: Uint8Array, mime: Mime): Uint8Array {
  try {
    if (mime === 'image/jpeg') return stripJpeg(buf);
    if (mime === 'image/png') return stripPng(buf);
    return stripWebp(buf);
  } catch {
    // Повреждённая структура: не рискуем отдать метаданные — такой файл не принимаем.
    return new Uint8Array(0);
  }
}

// ── JPEG: сегменты APPn/COM до начала данных (SOS) ──

function stripJpeg(b: Uint8Array): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not jpeg');
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let orientation = 0;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('bad marker');
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // заполняющие байты
    if (marker === 0xda) { out.push(b.subarray(i)); break; } // дальше — сжатые данные изображения
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) throw new Error('bad length');
    const seg = b.subarray(i, Math.min(b.length, i + 2 + len));
    const isExif = marker === 0xe1 && ascii(seg, 4, 10) === 'Exif\0\0';
    if (isExif) orientation = exifOrientation(seg.subarray(10)) || orientation;
    // APP1 (EXIF/XMP), APP13 (IPTC/Photoshop), APP2..APP15 кроме ICC-профиля (APP2 «ICC_PROFILE»), COM — выбрасываем.
    const keep = marker === 0xe0 || (marker === 0xe2 && ascii(seg, 4, 16) === 'ICC_PROFILE\0') || marker === 0xee ||
      !((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe);
    if (keep) out.push(seg);
    i += 2 + len; // обрыв посреди сегмента — цикл закончится, недокачанный хвост выброшенного сегмента не попадёт
  }
  if (orientation > 1 && orientation <= 8) out.splice(1, 0, orientationApp1(orientation));
  return concat(out);
}

/** Ориентация (тег 0x0112) из TIFF-заголовка EXIF; 0 — нет. */
function exifOrientation(t: Uint8Array): number {
  if (t.length < 8) return 0;
  const le = t[0] === 0x49 && t[1] === 0x49;
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16)) + t[o + 3] * 0x1000000 : t[o] * 0x1000000 + ((t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]));
  const ifd = u32(4);
  if (ifd + 2 > t.length) return 0;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) return 0;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return 0;
}

/** Минимальный APP1 с одним тегом — ориентацией. */
function orientationApp1(o: number): Uint8Array {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0, 0, 0];
  const body = [...'Exif\0\0'].map(c => c.charCodeAt(0)).concat(tiff);
  const len = body.length + 2;
  return Uint8Array.from([0xff, 0xe1, len >> 8, len & 0xff, ...body]);
}

// ── PNG: текстовые чанки и eXIf ──

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function stripPng(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
    const type = ascii(b, i + 4, i + 8);
    const end = i + 12 + len;
    if (end > b.length) throw new Error('bad chunk');
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') return concat(out);
  }
  // Обрыв посреди чанка: хвост — не метаданные, а недокачанные данные изображения.
  if (i < b.length) out.push(b.subarray(i));
  return concat(out);
}

// ── WebP (RIFF): чанки EXIF и XMP, флаги в VP8X ──

function stripWebp(b: Uint8Array): Uint8Array {
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 12) !== 'WEBP') throw new Error('not webp');
  const out: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, i + 4);
    const len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] * 0x1000000);
    const end = i + 8 + len + (len & 1);
    if (i + 8 + len > b.length) throw new Error('bad chunk');
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = b.slice(i, Math.min(end, b.length));
      if (type === 'VP8X' && chunk.length > 8) chunk[8] &= ~0x0c; // флаги «есть EXIF» и «есть XMP»
      out.push(chunk);
    }
    i = end;
  }
  const body = concat(out);
  const size = body.length + 4;
  const head = Uint8Array.from([0x52, 0x49, 0x46, 0x46, size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff, 0x57, 0x45, 0x42, 0x50]);
  return concat([head, body]);
}

function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, to));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
