// Сводка заказов для Telegram-канала (server/channel.ts) — посмотреть или отправить сейчас, не дожидаясь вечера:
//   docker compose -f docker-compose.prod.yml --env-file .env.production exec app node scripts/channel.mjs          — текст сводки на экран
//   docker compose -f docker-compose.prod.yml --env-file .env.production exec app node scripts/channel.mjs --send   — опубликовать сейчас
// Отправка вручную не отменяет вечернюю сводку по расписанию.
import { channelEnabled, digestJobs, digestText, sendToChannel } from '../server/channel';
import { config } from '../server/config';
import { pool } from '../server/db';
import { localClock } from '../server/events';

async function main() {
  const { day, hour } = localClock();
  const { jobs, area } = await digestJobs(day, hour);
  const text = digestText(jobs, { day, site: config.publicUrl().replace(/\/$/, ''), area });
  if (!text) { console.log('Открытых заказов' + (area ? ' (' + area + ')' : '') + ' нет — сводка сегодня не выйдет.'); return; }
  console.log(text.replace(/<[^>]+>/g, '') + '\n');
  if (!process.argv.includes('--send')) return;
  if (!channelEnabled()) { console.log('Не заданы TELEGRAM_CHANNEL и TELEGRAM_BOT_TOKEN — запустите deploy/configure.sh.'); process.exitCode = 1; return; }
  const id = await sendToChannel(text);
  console.log('Опубликовано в ' + config.telegramChannel() + ', сообщение № ' + id);
}

main()
  .catch(e => { console.error((e as Error).message); process.exitCode = 1; })
  .finally(() => pool().end());
