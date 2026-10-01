// Защита от SSRF для адресов, пришедших от пользователей (подписки веб-пуша).
import https from 'node:https';
import { describe, expect, it } from 'vitest';
import { isPrivateAddress, safeHttpsAgent } from '@/server/safe-agent';

describe('safe-agent', () => {
  it('внутренние адреса — в любой записи', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['142.250.74.10', '2a00:1450:4010:c05::5f', '::ffff:8.8.8.8']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('соединение с хостом, который разрешается во внутреннюю сеть, не открывается', async () => {
    const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
      const req = https.request({ host: 'localhost', port: 9, path: '/', agent: safeHttpsAgent }, () => resolve(new Error('соединение открылось')));
      req.on('error', resolve);
      req.end();
    });
    expect(err.code).toBe('EPRIVATE');
  });
});
