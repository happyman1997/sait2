// Сводка владельцу по запросу (server/digest.ts). Запускает deploy/digest.sh в контейнере приложения,
// проверки сервера приходят строками на stdin:  … | docker compose exec -T app node scripts/digest.mjs [дней] [--mail]
// По умолчанию — за сутки, на экран; число — за столько дней (до 90); --mail — ещё и письмом владельцу.
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
  const args = process.argv.slice(2);
  const mail = args.includes('--mail');
  const n = parseInt(args.find(a => /^\d+$/.test(a)) || '1', 10);
  const period = Math.min(90, Math.max(1, n));
  const raw = await readStdin();
  const now = new Date();
  const d = composeDigest(await collectStats(now, period), raw ? parseHostFacts(raw) : null, now, period);
  console.log(d.subject + '\n\n' + d.text);
  if (!mail) return;
  const to = digestRecipient();
  if (!to) { console.log('\nНе отправлено: в .env.production не задан OPERATOR_EMAIL (или DIGEST_EMAIL).'); return; }
  await getMailer().send(to, d.subject, d.text);
  console.log('\nСводка отправлена на ' + to + '.');
}

main()
  .then(() => pool().end())
  .catch(e => {
    console.error('Сводка не сформирована: ' + (mailErrorText(e) || (e as Error).message));
    process.exit(1);
  });
