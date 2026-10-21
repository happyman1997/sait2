// Ежедневная сводка владельцу на почту (server/digest.ts). Запускает deploy/digest.sh в контейнере приложения,
// проверки сервера приходят строками на stdin:  … | docker compose exec -T app node scripts/digest.mjs
// Без них (вручную) — только цифры площадки. --print — показать письмо, не отправляя.
import { pool } from '../server/db';
import { collectStats, composeDigest, digestRecipient, parseHostFacts } from '../server/digest';
import { getMailer, mailErrorText } from '../server/mail';

async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  let s = '';
  for await (const c of process.stdin) s += c;
  return s.trim() ? s : null;
}

async function main() {
  const print = process.argv.includes('--print');
  const raw = await readStdin();
  const d = composeDigest(await collectStats(), raw ? parseHostFacts(raw) : null);
  const to = digestRecipient();
  if (print || !to) {
    console.log(d.subject + '\n\n' + d.text);
    if (!print) console.log('\n(Не отправлено: в .env.production DIGEST_EMAIL=off или не задан OPERATOR_EMAIL.)');
    return;
  }
  await getMailer().send(to, d.subject, d.text);
  console.log(new Date().toISOString() + ' сводка отправлена на ' + to + (d.attention ? ': требует внимания — ' + d.attention : ': всё в порядке'));
}

main()
  .then(() => pool().end())
  .catch(e => {
    console.error(new Date().toISOString() + ' сводка не отправлена: ' + (mailErrorText(e) || (e as Error).message));
    process.exit(1);
  });
