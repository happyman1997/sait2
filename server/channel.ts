// Telegram-канал сервиса: раз в день бот публикует сводку открытых заказов (TELEGRAM_CHANNEL, TELEGRAM_BOT_TOKEN).
// В сводке — только то, что видит гость сайта, и меньше: вид работ, город и улица без номера дома, дата, оплата,
// сколько нужно людей, ссылка. Ни имён, ни телефонов, ни описаний — персональные данные в Telegram не уходят.
// Публикует фоновая задача (server/cron.ts): в час TELEGRAM_DIGEST_HOUR по времени сервиса, один раз за день.
import { cityPoint } from '@/lib/city-point';
import { CREW_ANY } from '@/lib/catalog';
import { dateLabel, money, plural } from '@/lib/jobs';
import { config } from './config';
import { query } from './db';
import { localClock } from './events';
import { roughAddress } from './privacy';

export type DigestJob = {
  num: number; typeLabel: string; place: string; pay: number; unit: string; date: string;
  crew: number; hired: number; urgent: boolean; repeat: string | null;
};

const MAX_ITEMS = 10;
// После обеда разовые смены на сегодня уже не набрать — в вечерней сводке их нет.
const LATE_HOUR = 14;
const UTM = 'utm_source=telegram&utm_medium=digest&utm_campaign=channel';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function nextDay(day: string) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function whenLabel(j: DigestJob, day: string) {
  const d = j.date <= day ? 'сегодня' : j.date === nextDay(day) ? 'завтра' : dateLabel(j.date);
  if (!j.repeat) return d;
  const series = j.repeat === 'по снегопаду' ? 'по вызову после снегопада' : j.repeat;
  return j.date <= day ? series : series + ', с ' + (d === 'завтра' ? 'завтра' : d);
}

function needLabel(j: DigestJob) {
  if (j.crew >= CREW_ANY) return 'людей — сколько придёт';
  const left = Math.max(1, j.crew - j.hired);
  return (left === 1 ? 'нужен ' : 'нужно ') + left + ' ' + plural(left, 'человек', 'человека', 'человек');
}

/** Текст поста (HTML для Telegram) или null, если публиковать нечего. */
export function digestText(jobs: DigestJob[], o: { day: string; site: string; area: string | null }): string | null {
  if (!jobs.length) return null;
  const n = jobs.length;
  const waits = n % 10 === 1 && n % 100 !== 11 ? 'ждёт' : 'ждут';
  const head = [
    '<b>Открытые смены · ' + dateLabel(o.day) + '</b>',
    (o.area ? esc(o.area) + ': ' : '') + n + ' ' + plural(n, 'заказ', 'заказа', 'заказов') + ' ' + waits + ' исполнителей'
  ].join('\n');
  const items = jobs.slice(0, MAX_ITEMS).map(j => [
    (j.urgent ? 'Срочно · ' : '') + '<b>' + esc(j.typeLabel) + '</b> — ' + esc(money(j.pay, j.unit)),
    esc([whenLabel(j, o.day), needLabel(j), j.place].join(' · ')),
    '<a href="' + o.site + '/zakaz/' + j.num + '?' + UTM + '">Открыть заказ</a>'
  ].join('\n'));
  const rest = n - Math.min(n, MAX_ITEMS);
  const tail = rest
    ? 'Ещё ' + rest + ' ' + plural(rest, 'заказ', 'заказа', 'заказов') + ' — <a href="' + o.site + '/?' + UTM + '">на карте</a>'
    : 'Все заказы — <a href="' + o.site + '/?' + UTM + '">на карте</a>';
  return [head, ...items, tail].join('\n\n');
}

/** Открытые заказы, где ещё нужны люди: в районе города из настроек (или все), срочные и ближайшие — первыми. */
export async function digestJobs(day: string, hour: number): Promise<{ jobs: DigestJob[]; area: string | null }> {
  const city = config.telegramDigestCity();
  const pt = city ? cityPoint(city) : null;
  const km = config.telegramDigestKm();
  const r = await query<{ num: string; type_label: string; address: string; district: string | null; pay: number; unit: string;
    date: string; crew: number; hired: number; urgent: boolean; repeat: string | null }>(
    `SELECT j.num, t.label AS type_label, j.address, j.district, j.pay, j.unit, to_char(j.date, 'YYYY-MM-DD') AS date,
            j.crew, j.urgent, j.repeat, (SELECT count(*) FROM hires h WHERE h.job_id = j.id)::int AS hired
       FROM jobs j JOIN job_types t ON t.id = j.type_id
       -- Заказы заблокированного работодателя в канал не продвигаем.
       JOIN users u ON u.id = j.employer_id AND u.status = 'active'
      WHERE j.status = 'open'
        AND (j.date > $1::date OR (j.date = $1::date AND $2) OR (j.repeat IS NOT NULL AND (j.series_end IS NULL OR j.series_end >= $1::date)))
        AND ($3::float8 IS NULL OR earth_distance(ll_to_earth($3, $4), j.pt) <= $5 * 1000)
      ORDER BY j.urgent DESC, j.date, j.created_at DESC
      LIMIT 500`,
    [day, hour < LATE_HOUR, pt?.[0] ?? null, pt?.[1] ?? null, km]);
  return {
    // Улица без номера дома — у всех заказов, не только у частных: в канал уходит меньше, чем видно на сайте.
    jobs: r.rows.map(x => ({
      num: Number(x.num), typeLabel: x.type_label, place: roughAddress(x.address, x.district), pay: x.pay, unit: x.unit,
      date: x.date, crew: x.crew, hired: x.hired, urgent: x.urgent, repeat: x.repeat
    })),
    area: pt ? city + ' и до ' + km + ' км вокруг' : null
  };
}

/** Отправка в канал; возвращает номер сообщения. Токен в ошибки и журнал не попадает. */
export async function sendToChannel(html: string): Promise<number> {
  const res = await fetch('https://api.telegram.org/bot' + config.telegramToken() + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: config.telegramChannel(), text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
    signal: AbortSignal.timeout(15_000)
  }).catch(e => { throw new Error('Telegram недоступен: ' + (e as Error).name); });
  const body = await res.json().catch(() => null) as { ok?: boolean; description?: string; result?: { message_id: number } } | null;
  if (!body?.ok || !body.result) throw new Error('Telegram: ' + res.status + ' ' + (body?.description || 'ответ не JSON'));
  return body.result.message_id;
}

export const channelEnabled = () => !!(config.telegramToken() && config.telegramChannel());

/**
 * Сводка дня — из фоновой задачи раз в 10 минут: в час публикации и ещё два часа после (сервер мог перезапускаться),
 * один раз за день. День «занимается» строкой до отправки — два экземпляра приложения не опубликуют дважды;
 * сбой отправки строку снимает, следующий заход попробует снова. Нечего публиковать — день пропускается.
 */
export async function postDailyDigest(now = new Date()): Promise<'sent' | 'empty' | null> {
  if (!channelEnabled()) return null;
  const { hour, day } = localClock(now);
  const at = config.telegramDigestHour();
  if (hour < at || hour > at + 2) return null;
  const claimed = await query(`INSERT INTO channel_posts (kind, day) VALUES ('digest', $1) ON CONFLICT DO NOTHING RETURNING day`, [day]);
  if (!claimed.rowCount) return null;
  try {
    const { jobs, area } = await digestJobs(day, hour);
    const text = digestText(jobs, { day, site: config.publicUrl().replace(/\/$/, ''), area });
    if (!text) return 'empty';
    const id = await sendToChannel(text);
    await query(`UPDATE channel_posts SET message_id = $2 WHERE kind = 'digest' AND day = $1`, [day, id]);
    return 'sent';
  } catch (e) {
    await query(`DELETE FROM channel_posts WHERE kind = 'digest' AND day = $1`, [day]);
    throw e;
  }
}
