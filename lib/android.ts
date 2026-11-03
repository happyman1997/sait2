// Android-приложение: проверка названия пакета и отпечатков ключа подписи — общие для сервера и проверки настроек.
export const ANDROID_PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** «aa:bb:…» или 64 знака подряд → «AA:BB:…»; не отпечаток SHA-256 — null. */
export function certFingerprint(raw: string): string | null {
  const hex = raw.trim().replace(/:/g, '').toUpperCase();
  return /^[0-9A-F]{64}$/.test(hex) ? hex.match(/../g)!.join(':') : null;
}

/** Отпечатки через запятую или пробел (ключ загрузки и ключ магазина — Google Play переподписывает своим). */
export function certFingerprints(raw: string): { ok: string[]; bad: string[] } {
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  const ok = [...new Set(parts.map(certFingerprint).filter((f): f is string => !!f))];
  return { ok, bad: parts.filter(p => !certFingerprint(p)) };
}
