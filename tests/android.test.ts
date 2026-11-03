// Android-приложение: assetlinks.json по настройкам и проверка настроек перед запуском.
import { describe, expect, it } from 'vitest';
import { certFingerprint, certFingerprints } from '@/lib/android';
import { assetLinks } from '@/server/android';
import { productionProblems } from '@/server/startup-check';

const FP = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');

describe('отпечаток ключа', () => {
  it('с двоеточиями и без, в любом регистре — в одном виде', () => {
    expect(certFingerprint(FP.toLowerCase())).toBe(FP);
    expect(certFingerprint(FP.replace(/:/g, ''))).toBe(FP);
    expect(certFingerprint('AB:CD')).toBeNull();
    expect(certFingerprints(FP + ', ' + FP.toLowerCase() + ' мусор')).toEqual({ ok: [FP], bad: ['мусор'] });
  });
});

describe('assetlinks.json', () => {
  it('пакет и отпечатки — ссылка на приложение; чего-то нет — файла нет', () => {
    expect(assetLinks('ru.arenarabot.app', FP)).toEqual([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'ru.arenarabot.app', sha256_cert_fingerprints: [FP] }
    }]);
    expect(assetLinks('', FP)).toBeNull();
    expect(assetLinks('ru.arenarabot.app', '')).toBeNull();
    expect(assetLinks('Arena App', FP)).toBeNull();
  });
});

describe('проверка настроек', () => {
  const problems = (env: Record<string, string>) => productionProblems(env).filter(p => p.startsWith('ANDROID'));
  it('пакет без ошибок, отпечаток — 32 пары; отпечаток без пакета — ошибка', () => {
    expect(problems({ ANDROID_PACKAGE: 'ru.arenarabot.app', ANDROID_CERT_SHA256: FP })).toEqual([]);
    expect(problems({ ANDROID_PACKAGE: 'arena' })).toHaveLength(1);
    expect(problems({ ANDROID_PACKAGE: 'ru.arenarabot.app', ANDROID_CERT_SHA256: 'AB:CD' })).toHaveLength(1);
    expect(problems({ ANDROID_CERT_SHA256: FP })).toEqual([expect.stringMatching(/^ANDROID_PACKAGE/)]);
  });
});
