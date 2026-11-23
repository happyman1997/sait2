// Напоминания перед сменой — меньше неявок.
//  • Накануне вечером (18:00–21:59 по времени площадки): нанятым на этот день и работодателю.
//  • В день выхода, за 2 часа до начала: нанятым — если время указано и смена не раньше 8:00
//    (более раннюю напоминает вечернее: иначе пришлось бы будить в тихие часы).
// Разовый заказ — его дата; серия — день по графику или вызов «по снегопаду»: снявшие день не получают, замена на день —
// получает. Каждое напоминание — один раз на человека, заказ, день и вид (shift_reminders), даже при параллельном запуске.
// Текст с датой, а не «завтра»: если письмо задержат тихие часы получателя, оно останется верным.
import { dateLabel, jobNum, plural, timeLabel } from '@/lib/jobs';
import { pool, query, tx, type Db } from './db';
import { addEvents, localClock } from './events';
import { seriesDatesFor } from './jobs';

export const EVE_FROM = 18;
export const EVE_TO = 22;
export const SOON_MINUTES = 120;
/** Раньше этого времени «за 2 часа» не шлём — пришлось бы в тихие часы. */
export const SOON_EARLIEST = '08:00';

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const hhmm = (mins: number) => String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');

type Cand = {
  id: string; num: string; title: string; date: string; start_time: string | null; repeat: string | null; series_len: number; employer_id: string;
};
type Due = { job: Cand; day: string; kind: 'eve' | 'soon' };

/** Кто выходит в этот день: разовый — нанятые; серия — нанятые без снявших день плюс замены на день. */
async function workersOf(j: Cand, day: string, db: Db): Promise<string[]> {
  const r = await query<{ id: string }>(
    j.repeat
      ? `SELECT h.freelancer_id AS id FROM hires h
          WHERE h.job_id = $1 AND NOT EXISTS (SELECT 1 FROM series_skips k WHERE k.job_id = h.job_id AND k.freelancer_id = h.freelancer_id AND k.day = $2::date)
         UNION
         SELECT s.freelancer_id FROM series_subs s WHERE s.job_id = $1 AND s.day = $2::date AND s.status = 'hired'`
      : `SELECT freelancer_id AS id FROM hires WHERE job_id = $1 AND $2::date IS NOT NULL`,
    [j.id, day], db);
  return r.rows.map(x => x.id);
}

function texts(j: Cand, day: string, kind: 'eve' | 'soon', workers: number) {
  const num = Number(j.num), t = 'заказ № ' + jobNum(num) + ' «' + j.title + '»';
  const at = j.start_time ? ' в ' + timeLabel(j.start_time) : '';
  if (kind === 'soon') {
    return { worker: 'Сегодня' + at + ' смена · ' + t + '. Адрес и кто встречает — на экране смены.', employer: null };
  }
  return {
    worker: 'Напоминание: смена ' + dateLabel(day) + at + ' · ' + t + '.' + (j.start_time ? '' : ' Время выхода уточните в чате с работодателем.') +
      ' Адрес, кто встречает и что взять — на экране смены.',
    employer: 'Напоминание: выход ' + dateLabel(day) + at + ' · ' + t + ' — ' +
      (workers === 1 ? 'придёт 1 исполнитель.' : 'придут ' + workers + ' ' + plural(workers, 'исполнитель', 'исполнителя', 'исполнителей') + '.')
  };
}

/** Разослать напоминания, срок которых наступил. Возвращает число отправленных. Вызывается из cron раз в 10 минут. */
export async function remindShifts(now = new Date(), db: Db = pool()): Promise<number> {
  const { hour, minute, day: today } = localClock(now);
  const tomorrow = addDays(today, 1);
  const eve = hour >= EVE_FROM && hour < EVE_TO;
  const mins = hour * 60 + minute;
  // Окно «за 2 часа»: начало позже текущей минуты и не дальше 2 часов (без перехода через полночь).
  const soonLo = hhmm(mins), soonHi = hhmm(Math.min(mins + SOON_MINUTES, 24 * 60 - 1));
  const cands = await query<Cand>(
    `SELECT j.id, j.num, j.title, to_char(j.date, 'YYYY-MM-DD') AS date, to_char(j.start_time, 'HH24:MI') AS start_time,
            j.repeat, j.series_len, j.employer_id
       FROM jobs j
      WHERE j.status IN ('open', 'staffed')
        AND (EXISTS (SELECT 1 FROM hires h WHERE h.job_id = j.id)
             OR EXISTS (SELECT 1 FROM series_subs s WHERE s.job_id = j.id AND s.status = 'hired' AND s.day BETWEEN $1::date AND $2::date))
        AND CASE WHEN j.repeat IS NULL THEN j.date BETWEEN $1::date AND $2::date
                 ELSE j.date <= $2::date AND (j.series_end IS NULL OR j.series_end >= $1::date) END
        AND ($3 OR (j.start_time >= $6::time AND j.start_time > $4::time AND j.start_time <= $5::time))`,
    [today, tomorrow, eve, soonLo, soonHi, SOON_EARLIEST], db);

  const due: Due[] = [];
  for (const j of cands.rows) {
    const days = j.repeat ? new Set(await seriesDatesFor(j, db)) : new Set([j.date]);
    if (eve && days.has(tomorrow)) due.push({ job: j, day: tomorrow, kind: 'eve' });
    if (j.start_time && j.start_time >= SOON_EARLIEST && j.start_time > soonLo && j.start_time <= soonHi && days.has(today)) {
      due.push({ job: j, day: today, kind: 'soon' });
    }
  }

  let sent = 0;
  for (const d of due) {
    sent += await tx(async (t) => {
      const workers = await workersOf(d.job, d.day, t);
      if (!workers.length) return 0;
      const people = d.kind === 'eve' ? [...workers, d.job.employer_id] : workers;
      // Отметка и событие — в одной транзакции: сбой рассылки не оставит «отправлено» без письма.
      const fresh = await query<{ user_id: string }>(
        `INSERT INTO shift_reminders (job_id, user_id, day, kind)
         SELECT $1, u, $2::date, $3 FROM unnest($4::uuid[]) AS u
         ON CONFLICT DO NOTHING RETURNING user_id`,
        [d.job.id, d.day, d.kind, people], t);
      if (!fresh.rows.length) return 0;
      const tx_ = texts(d.job, d.day, d.kind, workers.length), num = Number(d.job.num);
      await addEvents(fresh.rows.map(r => {
        const emp = r.user_id === d.job.employer_id && !workers.includes(r.user_id);
        return {
          userId: r.user_id, kind: 'reminder', text: emp ? tx_.employer! : tx_.worker, jobId: d.job.id, num,
          deliver: true, essential: true, path: emp ? undefined : '/shift?job=' + num
        };
      }), t);
      return fresh.rows.length;
    });
  }
  return sent;
}
