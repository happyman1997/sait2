// Android-приложение (TWA из PWABuilder / Bubblewrap): файл /.well-known/assetlinks.json связывает сайт с приложением —
// без него приложение открывается со строкой адреса браузера. Пакет и отпечатки ключа — не секреты: их видит каждый.
import { ANDROID_PACKAGE_RE, certFingerprints } from '@/lib/android';
import { config } from './config';

/** Содержимое assetlinks.json или null, если приложение не настроено. */
export function assetLinks(pkg = config.androidPackage(), certs = config.androidCertSha256()) {
  if (!ANDROID_PACKAGE_RE.test(pkg)) return null;
  const fps = certFingerprints(certs).ok;
  if (!fps.length) return null;
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fps }
  }];
}
