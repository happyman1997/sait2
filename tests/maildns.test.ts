import { describe, expect, it } from 'vitest';
import { checkMailDns, senderDomain } from '@/server/maildns';

// Подставной DNS: имя → TXT-записи; нет имени — «записи нет».
const fake = (zone: Record<string, string[]>) => async (name: string) => {
  if (!(name in zone)) throw Object.assign(new Error('nf'), { code: 'ENOTFOUND' });
  return zone[name].map(r => [r]);
};
const byName = (r: Awaited<ReturnType<typeof checkMailDns>>) => Object.fromEntries(r.map(c => [c.name, c]));

describe('записи домена для почты', () => {
  it('домен отправителя — из EMAIL_FROM или логина ящика', () => {
    expect(senderDomain('Арена Работы <info@arenarabot.ru>')).toBe('arenarabot.ru');
    expect(senderDomain('info@Arenarabot.ru')).toBe('arenarabot.ru');
    expect(senderDomain('', 'info@arenarabot.ru')).toBe('arenarabot.ru');
  });

  it('нет SPF, DKIM и DMARC — для каждой записи сказано, что добавить', async () => {
    const r = byName(await checkMailDns('arenarabot.ru', 'smtp.yandex.ru', fake({ 'arenarabot.ru': [] })));
    expect(r.SPF.ok).toBe(false);
    expect(r.SPF.fix).toContain('v=spf1 redirect=_spf.yandex.net');
    expect(r.DKIM.ok).toBe(false);
    expect(r.DKIM.fix).toContain('mail._domainkey');
    expect(r.DMARC.ok).toBe(false);
    expect(r.DMARC.fix).toContain('v=DMARC1; p=none');
  });

  it('всё настроено — всё «есть»', async () => {
    const r = await checkMailDns('arenarabot.ru', 'smtp.yandex.ru', fake({
      'arenarabot.ru': ['v=spf1 redirect=_spf.yandex.net'],
      'mail._domainkey.arenarabot.ru': ['v=DKIM1; k=rsa; t=s; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GN'],
      '_dmarc.arenarabot.ru': ['v=DMARC1; p=none']
    }));
    expect(r.every(c => c.ok)).toBe(true);
  });

  it('SPF без Яндекса или две записи SPF — ошибка', async () => {
    const a = byName(await checkMailDns('arenarabot.ru', 'smtp.yandex.ru', fake({ 'arenarabot.ru': ['v=spf1 include:_spf.mail.ru ~all'] })));
    expect(a.SPF.ok).toBe(false);
    expect(a.SPF.fix).toContain('_spf.yandex.net');
    const b = byName(await checkMailDns('arenarabot.ru', 'smtp.yandex.ru', fake({ 'arenarabot.ru': ['v=spf1 redirect=_spf.yandex.net', 'v=spf1 -all'] })));
    expect(b.SPF.ok).toBe(false);
    expect(b.SPF.note).toContain('2');
  });

  it('общая почта (yandex.ru) — настраивать нечего; DNS не ответил — «проверьте позже», без совета', async () => {
    expect((await checkMailDns('yandex.ru', 'smtp.yandex.ru', fake({})))[0].ok).toBe(true);
    const down = async () => { throw Object.assign(new Error('t'), { code: 'ETIMEOUT' }); };
    const r = await checkMailDns('arenarabot.ru', 'smtp.yandex.ru', down);
    expect(r.every(c => !c.ok && !c.fix)).toBe(true);
    // Сам домен «не существует» — сбой DNS, а не отсутствие записей.
    expect((await checkMailDns('arenarabot.ru', 'smtp.yandex.ru', fake({}))).every(c => !c.ok && !c.fix)).toBe(true);
  });
});
