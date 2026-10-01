// HTTPS-агент для запросов по адресам, пришедшим от пользователей (подписки веб-пуша):
// адрес проверяется после DNS-разрешения, поэтому частные и служебные сети недоступны при любой записи хоста
// (десятичный IP, IPv6, домен на внутренний адрес, DNS rebinding). Соединения переиспользуются.
import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';

const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(a, p, 'ipv6');

/** Внутренний адрес: частные сети, localhost, link-local, CGNAT, multicast; IPv4 внутри IPv6 — по IPv4. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (v4) return blocked.check(v4, 'ipv4');
  return net.isIPv4(ip) ? blocked.check(ip, 'ipv4') : net.isIPv6(ip) ? blocked.check(ip, 'ipv6') : true;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function safeLookup(host: string, opts: dns.LookupOptions, cb: LookupCb) {
  dns.lookup(host, { ...opts, all: true }, (err, list) => {
    if (err) return cb(err, '');
    const ok = (list as dns.LookupAddress[]).filter(x => !isPrivateAddress(x.address));
    if (!ok.length) return cb(Object.assign(new Error('Адрес ' + host + ' ведёт во внутреннюю сеть.'), { code: 'EPRIVATE' }), '');
    if (opts.all) cb(null, ok);
    else cb(null, ok[0].address, ok[0].family);
  });
}

export const safeHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32, lookup: safeLookup as never });
