// Telegram-канал сервиса: раз в день бот публикует сводку открытых заказов (TELEGRAM_CHANNEL, TELEGRAM_BOT_TOKEN).
// В сводке — только то, что видит гость сайта, и меньше: вид работ, город и улица без номера дома, дата, оплата и как
// платят, инвентарь, тип заказчика и его рейтинг, объём, сколько нужно людей и откликов. Ни имён, ни телефонов, ни
// описаний — персональные данные в Telegram не уходят.
// Пост: вверху — сколько заказов, разброс ставок и каких работ больше; ближайший день — подробно, неделя, серии
// на сезон и позже — строкой на заказ. Публикует фоновая задача (server/cron.ts) раз в день в свой час.
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
  volume: string | null; payType: string | null; tools: string | null; orgType: string; rating: number | null; applicants: number;
};

const MAX_DETAILED = 4;
const MAX_LINES = 10;
// Предел Telegram — 4096 знаков; с запасом на разметку.
const MAX_LENGTH = 3900;
// После обеда разовые смены на сегодня уже не набрать — в вечерней сводке их нет.
const LATE_HOUR = 14;
const UTM = 'utm_source=telegram&utm_medium=digest&utm_campaign=channel';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const n2 = (v: number) => String(v).replace('.', ',');

function addDays(day: string, n: number) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const payFull = (j: DigestJob) => money(j.pay, j.unit) + (j.unit === 'за заказ' ? ' за заказ' : '');
const PAY_TYPE: Record<string, [full: string, short: string]> = {
  'наличными в день выхода': ['наличными в день выхода', 'наличными'],
  'перевод на карту': ['перевод на карту', 'перевод'],
  'самозанятый — чек': ['самозанятому, с чеком', 'с чеком'],
  'по договору, безнал': ['безнал по договору', 'безнал']
};
const TOOLS: Record<string, string> = {
  'инвентарь есть на объекте': 'инвентарь на месте',
  'нужен свой инвентарь': 'нужен свой инвентарь',
  'часть своя, часть на месте': 'инвентарь частично свой'
};
const cash = (j: DigestJob) => j.payType === 'наличными в день выхода';

function dayHeading(date: string, day: string) {
  const d = dateLabel(date).toUpperCase();
  return date <= day ? 'СЕГОДНЯ, ' + d : date === addDays(day, 1) ? 'ЗАВТРА, ' + d : d;
}

function seriesLabel(j: DigestJob, day: string) {
  const s = j.repeat === 'по снегопаду' ? 'по вызову после снегопада' : j.repeat || '';
  return j.date <= day ? s : s + ', с ' + (j.date === addDays(day, 1) ? 'завтра' : dateLabel(j.date));
}

function needLabel(j: DigestJob) {
  if (j.crew >= CREW_ANY) return 'людей — сколько придёт';
  const left = Math.max(1, j.crew - j.hired);
  return (left === 1 ? 'нужен ' : 'нужно ') + left + ' ' + plural(left, 'человек', 'человека', 'человек');
}

const link = (o: { site: string }, j: DigestJob, text: string) => '<a href="' + o.site + '/zakaz/' + j.num + '?' + UTM + '">' + text + '</a>';

/** Заказ ближайшего дня — подробно: что и почём, где и сколько людей, как платят и инвентарь, кто заказчик и отклики. */
function detailed(j: DigestJob, o: { site: string }) {
  const terms = [
    j.payType && (cash(j) ? '💵 ' : '💳 ') + (PAY_TYPE[j.payType]?.[0] ?? j.payType),
    j.tools && '🧰 ' + (TOOLS[j.tools] ?? j.tools)
  ].filter(Boolean).join(' · ');
  const who = '👤 ' + (j.orgType === 'частное лицо' ? 'Частный заказчик' : cap(j.orgType)) + (j.rating != null ? ' ★ ' + n2(j.rating) : '') +
    ' · ' + (j.applicants ? j.applicants + ' ' + plural(j.applicants, 'отклик', 'отклика', 'откликов') : 'откликов пока нет');
  return [
    (j.urgent ? '🔴 Срочно · ' : '') + '<b>' + esc(j.typeLabel) + '</b> — ' + esc(payFull(j)),
    esc([j.place, needLabel(j), j.volume && 'объём: ' + j.volume].filter(Boolean).join(' · ')),
    terms && esc(terms),
    esc(who),
    link(o, j, '→ Открыть заказ')
  ].filter(Boolean).join('\n');
}

/** Заказ дальше по датам — одной строкой. */
function compact(j: DigestJob, day: string, o: { site: string }) {
  const pay = j.payType ? PAY_TYPE[j.payType]?.[1] ?? j.payType : '';
  const head = (j.urgent ? '🔴 ' : '') + (j.repeat ? '' : esc(dateLabel(j.date)) + ' · ');
  const rest = j.repeat ? [j.place, needLabel(j), seriesLabel(j, day)] : [j.place, pay];
  return head + link(o, j, esc(j.typeLabel)) + ' — ' + esc([payFull(j), ...rest.filter(Boolean)].join(' · '));
}

/** Текст поста (HTML для Telegram) или null, если публиковать нечего. */
export function digestText(jobs: DigestJob[], o: { day: string; site: string; area: string | null }): string | null {
  if (!jobs.length) return null;
  const n = jobs.length;

  // Сводка: сколько, разброс ставок, каких работ больше всего.
  const byPay = [...jobs].sort((a, b) => a.pay - b.pay);
  const lo = byPay[0], hi = byPay[n - 1];
  const counts = new Map<string, number>();
  for (const j of jobs) counts.set(j.typeLabel, (counts.get(j.typeLabel) || 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const head = [
    '<b>' + esc(['Смены', o.area, dateLabel(o.day)].filter(Boolean).join(' · ')) + '</b>',
    esc(n + ' ' + plural(n, 'заказ', 'заказа', 'заказов') + (payFull(lo) !== payFull(hi) ? ' · от ' + payFull(lo) + ' до ' + payFull(hi) : '')),
    top[0][1] > 1 ? esc('Больше всего: ' + top.map(([t, c]) => low(t) + ' — ' + c).join(', ')) : ''
  ].filter(Boolean).join('\n');

  // Разовые — по дате, срочные первыми; ближайший день — подробно, остальное — строкой; серии — отдельно.
  const once = jobs.filter(j => !j.repeat).sort((a, b) => a.date.localeCompare(b.date) || Number(b.urgent) - Number(a.urgent));
  const series = jobs.filter(j => j.repeat);
  const first = once[0]?.date;
  const near = once.filter(j => j.date === first);
  const shown = near.slice(0, MAX_DETAILED);
  const week = addDays(o.day, 7);
  const after = [...near.slice(MAX_DETAILED), ...once.filter(j => j.date !== first)];
  const groups: [string, DigestJob[]][] = [
    ['НА НЕДЕЛЕ', after.filter(j => j.date <= week)],
    // Серии — раньше дальних дат: смены на всю зиму ценнее разового выхода через месяц.
    ['НА СЕЗОН', series],
    ['ПОЗЖЕ', after.filter(j => j.date > week)]
  ];

  const blocks: string[] = [head];
  if (shown.length) blocks.push('<b>' + dayHeading(first!, o.day) + '</b>\n\n' + shown.map(j => detailed(j, o)).join('\n\n'));
  let lines = 0, left = n - shown.length;
  const compactBlocks: [string, string[]][] = [];
  for (const [title, list] of groups) {
    const take = list.slice(0, Math.max(0, MAX_LINES - lines)).map(j => compact(j, o.day, o));
    lines += take.length; left -= take.length;
    if (take.length) compactBlocks.push([title, take]);
  }
  const mapLink = (text: string) => '<a href="' + o.site + '/?' + UTM + '">' + text + '</a>';
  const render = () => [
    ...blocks,
    ...compactBlocks.filter(([, l]) => l.length).map(([t, l]) => '<b>' + t + '</b>\n' + l.join('\n')),
    left > 0
      ? 'Ещё ' + left + ' ' + plural(left, 'заказ', 'заказа', 'заказов') + ' — ' + mapLink('на карте')
      : mapLink(n === 1 ? 'Заказ на карте' : 'Все ' + n + ' ' + plural(n, 'заказ', 'заказа', 'заказов') + ' — на карте')
  ].join('\n\n');
  // Длинные названия и адреса: не влезает — убираем строки с конца, они уходят в «ещё N».
  let text = render();
  while (text.length > MAX_LENGTH && compactBlocks.some(([, l]) => l.length)) {
    const last = [...compactBlocks].reverse().find(([, l]) => l.length)!;
    last[1].pop(); left++;
    text = render();
  }
  return text;
}

// Объём — свободный текст работодателя: похожее на телефон или адрес почты в канал не уходит.
const safeVolume = (v: string | null) => {
  const t = (v || '').trim();
  return t && t.length <= 60 && (t.match(/\d/g) || []).length <= 6 && !/@|https?:/i.test(t) ? t : null;
};

/** Открытые заказы, где ещё нужны люди: в районе города из настроек (или все), срочные и ближайшие — первыми. */
export async function digestJobs(day: string, hour: number): Promise<{ jobs: DigestJob[]; area: string | null }> {
  const city = config.telegramDigestCity();
  const pt = city ? cityPoint(city) : null;
  const km = config.telegramDigestKm();
  const r = await query<{ num: string; type_label: string; address: string; district: string | null; pay: number; unit: string;
    date: string; crew: number; hired: number; urgent: boolean; repeat: string | null; volume: string | null; pay_type: string | null;
    tools: string | null; org_type: string; rating: number | null; applicants: number }>(
    `SELECT j.num, t.label AS type_label, j.address, j.district, j.pay, j.unit, to_char(j.date, 'YYYY-MM-DD') AS date,
            j.crew, j.urgent, j.repeat, j.volume, j.pay_type, j.tools,
            (SELECT count(*) FROM hires h WHERE h.job_id = j.id)::int AS hired,
            coalesce((SELECT ep.org_type FROM employer_profiles ep WHERE ep.user_id = j.employer_id), 'частное лицо') AS org_type,
            (SELECT round(avg(rv.rating)::numeric, 1)::float8 FROM reviews rv WHERE rv.target_id = j.employer_id) AS rating,
            (SELECT count(*) FROM applications a WHERE a.job_id = j.id AND a.status IN ('sent', 'hired'))::int AS applicants
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
      date: x.date, crew: x.crew, hired: x.hired, urgent: x.urgent, repeat: x.repeat, volume: safeVolume(x.volume),
      payType: x.pay_type, tools: x.tools, orgType: x.org_type, rating: x.rating, applicants: x.applicants
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
