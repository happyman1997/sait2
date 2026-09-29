'use client';

/**
 * Уменьшает фото с телефона перед загрузкой (снимки по 5–10 МБ не пролезут в лимит и долго грузятся по мобильной сети).
 * Если браузер не справился — отдаёт исходный файл, сервер сам проверит тип и размер.
 */
export async function shrinkImage(file: File, maxSide: number, quality = 0.85): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || typeof createImageBitmap === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 1.5 * 1024 * 1024 && file.type !== 'image/heic') { bmp.close(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const out = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', quality));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

export async function uploadForm(file: File, maxSide: number, extra: Record<string, string> = {}) {
  const fd = new FormData();
  const blob = await shrinkImage(file, maxSide);
  fd.append('file', blob, blob === file ? file.name : 'photo.jpg');
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}
