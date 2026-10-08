// Общий суточный бюджет SMS (коды и уведомления) — потолок расходов. Лимиты на номер и на IP не спасают,
// если кто-то с разных адресов запрашивает коды на тысячи чужих номеров: каждое SMS — деньги.
// Уведомлениям — не больше 80% бюджета: остаток держим для кодов, без которых не зарегистрироваться и не войти.
// Счётчик — в общей таблице rate_limits (через пул, не в транзакции запроса: откат не должен «возвращать» SMS).
import { config } from './config';
import { pool, query } from './db';
import { AppError } from './errors';
import { hit, used } from './rate-limit';

const KEY = 'sms:all';
const DAY = 86400;
const NOTICE_SHARE = 0.8;

/** Перед отправкой кода (SMS или звонок). Бюджет исчерпан — понятная ошибка и одно письмо в поддержку за сутки. */
export async function spendSmsForCode() {
  const limit = config.smsDailyLimit();
  const r = await hit(KEY, limit, DAY, pool());
  if (r.ok) return;
  if ((await hit(KEY + ':alert', 1, DAY, pool())).ok) {
    await query(`INSERT INTO notification_outbox (channel, to_addr, subject, body) VALUES ('email', $1, $2, $3)`, [
      config.supportEmail(),
      'Исчерпан суточный лимит SMS',
      'За сутки отправлено ' + limit + ' SMS (SMS_DAILY_LIMIT). Новые коды не отправляются до конца суток.\n\n' +
        'Если это наплыв настоящих пользователей — увеличьте SMS_DAILY_LIMIT в .env.production и перезапустите приложение.\n' +
        'Если нет — кто-то рассылает коды на чужие номера: проверьте журнал nginx и отправки в личном кабинете SMS.ru.'
    ]);
  }
  throw new AppError(503, 'Сейчас не получается отправить код — попробуйте через несколько часов или напишите в поддержку.', undefined, { retryAfter: r.retryAfter });
}

/** Перед SMS-уведомлением: false — бюджет уведомлений на сутки исчерпан (уведомление остаётся в журнале и push/почте). */
export async function spendSmsForNotice(): Promise<boolean> {
  if ((await used(KEY, DAY)) >= Math.floor(config.smsDailyLimit() * NOTICE_SHARE)) return false;
  await hit(KEY, Number.MAX_SAFE_INTEGER, DAY);
  return true;
}
