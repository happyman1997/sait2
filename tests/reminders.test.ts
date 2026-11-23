// Напоминания перед сменой: вечером накануне — нанятым и работодателю, за 2 часа до начала — нанятым; серия — по дням.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const jobs = await import('@/server/jobs');
const sh = await import('@/server/shifts');
const { localClock } = await import('@/server/events');
const { remindShifts } = await import('@/server/reminders');

type Viewer = Parameters<typeof jobs.listJobs>[1];
type U = NonNullable<Viewer>;

const MOSCOW = { lat: 55.7558, lng: 37.6173 };
// «Сегодня» — по времени площадки (Москва, UTC+3 без перехода на летнее время).
const today = localClock(new Date()).day;
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const tomorrow = addDays(today, 1);
/** Момент «hh:mm по Москве» сегодня (или через plus дней). */
const at = (hh: number, mm = 0, plus = 0) => { const [y, m, d] = addDays(today, plus).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, hh - 3, mm)); };

let emp: U, fl: U, fl2: U, fl3: U;

async function mkUser(role: 'freelancer' | 'employer', login: string, phoneKey: string, name: string): Promise<U> {
  const u = await one<{ id: string }>(
    `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version)
     VALUES ($1, $2, '+7' || $3, $3, $2 || '@x.ru', 'x', $4, 'Москва', $5, $6, now(), 't') RETURNING id`,
    [role, login, phoneKey, name, MOSCOW.lat, MOSCOW.lng]);
  return { id: u!.id, role, city: 'Москва', base_lat: MOSCOW.lat, base_lng: MOSCOW.lng };
}

const form = (over: Record<string, unknown> = {}) => ({
  ...MOSCOW, address: 'Москва, ул. Тверская, 18', district: 'Москва', type: 'snow', desc: 'Двор 320 м²', crew: '1', pay: '6000',
  unit: 'за заказ', payType: 'перевод на карту', dateISO: tomorrow, access: ['домофон'], tools: 'нужен свой инвентарь', ...over
});

/** Заказ, на который наняты люди (в порядке списка). */
async function hiredJob(people: U[], over: Record<string, unknown> = {}) {
  const j = await jobs.createJob(form({ crew: String(people.length || 1), ...over }), emp, today);
  for (const p of people) await jobs.applyToJob(j.num, { reqConfirmed: true }, p, today);
  const d = await jobs.getJob(j.num, emp);
  for (const a of d.applicantList!) await sh.staffAction(j.num, a.id, 'hire', emp);
  return j.num;
}
const reminders = async () => (await query<{ user_id: string; text: string }>(`SELECT user_id, text FROM events WHERE kind = 'reminder' ORDER BY created_at`)).rows;

beforeAll(async () => {
  await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool(), undefined, () => {});
});

beforeEach(async () => {
  await query('TRUNCATE jobs, rate_limits, events, notification_outbox CASCADE');
  await query('DELETE FROM users');
  emp = await mkUser('employer', 'aigul_t', '9161111111', 'Айгуль Тлеубаева');
  fl = await mkUser('freelancer', 'daniyar_s', '9160000000', 'Данияр Сапаров');
  fl2 = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга Кузнецова');
  fl3 = await mkUser('freelancer', 'ivan_p', '9164444444', 'Иван Петров');
});

afterAll(async () => { await pool().end(); });

describe('напоминания перед сменой', () => {
  it('накануне вечером: нанятому и работодателю, один раз; до 18:00 — нет', async () => {
    await hiredJob([fl], { startTime: '09:00' });
    expect(await remindShifts(at(17, 50))).toBe(0);
    expect(await remindShifts(at(19))).toBe(2);
    expect(await remindShifts(at(19, 10))).toBe(0);
    const ev = await reminders();
    expect(ev.find(e => e.user_id === fl.id)!.text).toMatch(/^Напоминание: смена \d+ \S+ в 9:00 · заказ № \d+ «.+»\. Адрес, кто встречает/);
    expect(ev.find(e => e.user_id === emp.id)!.text).toMatch(/в 9:00 · заказ .+ — придёт 1 исполнитель\.$/);
  });

  it('без времени — просим уточнить в чате; без нанятых и после 22:00 — ничего', async () => {
    await hiredJob([fl]);
    await jobs.createJob(form(), emp, today);          // никого не наняли
    expect(await remindShifts(at(22, 5))).toBe(0);
    expect(await remindShifts(at(21, 30))).toBe(2);
    expect((await reminders()).find(e => e.user_id === fl.id)!.text).toMatch(/Время выхода уточните в чате/);
  });

  it('в день выхода — за 2 часа до начала, только нанятым; раньше 8:00 — не шлём', async () => {
    await hiredJob([fl], { dateISO: today, startTime: '11:00' });
    await hiredJob([fl2], { dateISO: today, startTime: '07:00' });
    expect(await remindShifts(at(8, 50))).toBe(0);      // до начала больше 2 часов
    expect(await remindShifts(at(5, 30))).toBe(0);      // смена в 7:00 — только вечернее накануне
    expect(await remindShifts(at(9, 30))).toBe(1);
    const ev = await reminders();
    expect(ev).toHaveLength(1);
    expect(ev[0].user_id).toBe(fl.id);
    expect(ev[0].text).toMatch(/^Сегодня в 11:00 смена · заказ/);
    expect(await remindShifts(at(10, 40))).toBe(0);
  });

  it('серия: снявший день не получает, замена на день — получает, работодателю — сколько придут', async () => {
    const num = await hiredJob([fl, fl2], { regular: true, repeat: 'каждый день до конца сезона', dateISO: today, startTime: '09:00' });
    const j = (await one<{ id: string }>('SELECT id FROM jobs WHERE num = $1', [num]))!;
    await query('INSERT INTO series_skips (job_id, freelancer_id, day) VALUES ($1, $2, $3)', [j.id, fl.id, tomorrow]);
    await query(`INSERT INTO series_subs (job_id, day, freelancer_id, status) VALUES ($1, $2, $3, 'hired')`, [j.id, tomorrow, fl3.id]);
    expect(await remindShifts(at(19))).toBe(3);
    const ev = await reminders();
    expect(ev.map(e => e.user_id).sort()).toEqual([fl2.id, fl3.id, emp.id].sort());
    expect(ev.find(e => e.user_id === emp.id)!.text).toMatch(/придут 2 исполнителя\.$/);
  });

  it('перенос даты — напоминание по новому дню уходит заново', async () => {
    const num = await hiredJob([fl], { startTime: '09:00' });
    expect(await remindShifts(at(19))).toBe(2);
    // Перенесли туда и обратно — тот же день, второй раз не напоминаем.
    await sh.moveDate(num, { date: addDays(today, 2) }, emp, today);
    await sh.moveDate(num, { date: tomorrow }, emp, today);
    expect(await remindShifts(at(19, 20))).toBe(0);
    // Перенос на послезавтра: завтра вечером — новое напоминание обоим.
    await sh.moveDate(num, { date: addDays(today, 2) }, emp, today);
    expect(await remindShifts(at(19, 0, 1))).toBe(2);
    expect((await reminders()).filter(e => e.user_id === fl.id)).toHaveLength(2);
  });

  it('напоминание доставляется сверх лимита уведомлений в сутки', async () => {
    await hiredJob([fl], { startTime: '09:00' });
    await query('UPDATE users SET email_verified_at = now() WHERE id = $1', [fl.id]);
    await query('INSERT INTO notification_settings (user_id, email, daily_cap) VALUES ($1, true, 0) ON CONFLICT (user_id) DO UPDATE SET email = true, daily_cap = 0', [fl.id]);
    expect(await remindShifts(at(19))).toBe(2);
    const out = await one<{ n: number }>(`SELECT count(*)::int AS n FROM notification_outbox WHERE user_id = $1 AND channel = 'email'`, [fl.id]);
    expect(out!.n).toBe(1);
    expect((await one<{ muted: boolean }>(`SELECT muted FROM events WHERE user_id = $1 AND kind = 'reminder'`, [fl.id]))!.muted).toBe(false);
  });
});
