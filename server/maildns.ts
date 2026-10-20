// Записи домена отправителя, без которых Gmail, Outlook и другие иностранные почты не принимают письма или кладут их
// в «Спам»: SPF (кто может отправлять от имени домена), DKIM (подпись письма), DMARC (что делать с неподписанными).
// Российские почты к этому мягче — поэтому «на mail.ru код приходит, а на Gmail нет». Проверка — deploy/mailcheck.sh.
import { promises as dns } from 'node:dns';

export type DnsCheck = { name: string; ok: boolean; note: string; fix?: string };
type ResolveTxt = (name: string) => Promise<string[][]>;

/** Общие почтовые сервисы: письма от их адресов подписывает сам сервис, домен настраивать не нужно. */
const PUBLIC = /^(yandex\.(ru|com|by|kz)|ya\.ru|mail\.ru|bk\.ru|inbox\.ru|list\.ru|internet\.ru|rambler\.ru|gmail\.com|outlook\.com|hotmail\.com)$/i;

/** Что знаем о почтовом сервисе по адресу SMTP: имя записи SPF и селектор DKIM. */
function provider(smtpHost: string): { name: string; spf: string; dkim: string; where: string } | null {
  if (/yandex/i.test(smtpHost)) {
    return { name: 'Яндекс 360', spf: '_spf.yandex.net', dkim: 'mail', where: 'admin.yandex.ru → «Домены» → ваш домен → «DKIM-подпись» (скопируйте значение)' };
  }
  if (/mail\.ru/i.test(smtpHost)) {
    return { name: 'Mail.ru для бизнеса', spf: '_spf.mail.ru', dkim: 'mailru', where: 'biz.mail.ru → ваш домен → «Подтверждение домена» / DKIM' };
  }
  return null;
}

/** Домен из «Арена Работы <info@arenarabot.ru>» или из логина ящика. */
export function senderDomain(emailFrom: string, smtpUser = ''): string {
  const m = /@([^\s>]+)>?\s*$/.exec(emailFrom.trim()) || /@(.+)$/.exec(smtpUser.trim());
  return m ? m[1].toLowerCase() : '';
}

/** TXT-записи имени; [] — записей нет; null — DNS не ответил. root: у самого домена «имени нет» — это сбой DNS, а не пустая зона. */
async function txt(resolve: ResolveTxt, name: string, root = false): Promise<string[] | null> {
  try {
    return (await resolve(name)).map(parts => parts.join(''));
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'ENODATA' || (code === 'ENOTFOUND' && !root)) return [];
    return null;
  }
}

export async function checkMailDns(domain: string, smtpHost: string, resolve: ResolveTxt = dns.resolveTxt): Promise<DnsCheck[]> {
  if (!domain) return [{ name: 'Домен', ok: false, note: 'не удалось понять домен отправителя из EMAIL_FROM' }];
  if (PUBLIC.test(domain)) return [{ name: 'Домен', ok: true, note: `${domain} — общая почта, письма подписывает сам сервис` }];
  const p = provider(smtpHost);
  const where = 'в управлении DNS домена (reg.ru → «Домены» → ' + domain + ' → «DNS-серверы и управление зоной» → «Добавить запись» → TXT)';
  const out: DnsCheck[] = [];

  const spfAll = await txt(resolve, domain, true);
  // Сам домен не нашёлся — DNS сервера не работает (или домен не тот): советовать нечего.
  if (spfAll == null) return ['SPF', 'DKIM', 'DMARC'].map(name => ({ name, ok: false, note: `DNS не ответил про ${domain} — проверьте позже` }));
  const spf = spfAll?.filter(r => /^v=spf1\b/i.test(r)) ?? null;
  const spfValue = p ? `v=spf1 redirect=${p.spf}` : 'v=spf1 include:<SPF вашего почтового сервиса> ~all';
  if (spf == null) out.push({ name: 'SPF', ok: false, note: 'DNS не ответил — проверьте позже' });
  else if (!spf.length) out.push({ name: 'SPF', ok: false, note: 'записи нет', fix: `${where}: подимя «@», значение «${spfValue}»` });
  else if (spf.length > 1) out.push({ name: 'SPF', ok: false, note: `записей ${spf.length} — почты считают это ошибкой`, fix: `оставьте одну запись SPF, например «${spfValue}»` });
  else if (p && !spf[0].includes(p.spf)) out.push({ name: 'SPF', ok: false, note: `«${spf[0]}» — нет ${p.name}`, fix: `замените на «${spfValue}» (или добавьте include:${p.spf} перед ~all)` });
  else out.push({ name: 'SPF', ok: true, note: spf[0] });

  if (p) {
    const dkim = await txt(resolve, `${p.dkim}._domainkey.${domain}`);
    if (dkim == null) out.push({ name: 'DKIM', ok: false, note: 'DNS не ответил — проверьте позже' });
    else if (!dkim.some(r => /p=/.test(r))) {
      out.push({ name: 'DKIM', ok: false, note: 'подписи нет — Gmail и Outlook такие письма отклоняют',
        fix: `возьмите значение: ${p.where}; добавьте ${where}: подимя «${p.dkim}._domainkey», значение — скопированное` });
    } else out.push({ name: 'DKIM', ok: true, note: 'подпись настроена' });
  } else {
    out.push({ name: 'DKIM', ok: true, note: 'почтовый сервис не узнан — проверьте DKIM в его настройках' });
  }

  const dmarc = (await txt(resolve, `_dmarc.${domain}`))?.filter(r => /^v=DMARC1\b/i.test(r)) ?? null;
  if (dmarc == null) out.push({ name: 'DMARC', ok: false, note: 'DNS не ответил — проверьте позже' });
  else if (!dmarc.length) out.push({ name: 'DMARC', ok: false, note: 'записи нет', fix: `${where}: подимя «_dmarc», значение «v=DMARC1; p=none»` });
  else out.push({ name: 'DMARC', ok: true, note: dmarc[0] });
  return out;
}
