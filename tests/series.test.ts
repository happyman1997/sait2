// Этап 9: серия выходов — даты по правилу, «Не смогу» по дню, пометка за три дня подряд, продление.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const jobs = await import('@/server/jobs');
const sh = await import('@/server/shifts');
const support = await import('@/server/support');
const disputes = await import('@/server/disputes');
const { doneSql } = await import('@/server/stats');
const { AppError } = await import('@/server/errors');
const { seriesDates, seriesDayLabel } = await import('@/lib/jobs');
const { localClock } = await import('@/server/events');

type U = NonNullable<Parameters<typeof jobs.listJobs>[1]>;
const MOSCOW = { lat: 55.7558, lng: 37.6173 };
// «Сегодня» — по часовому поясу площадки, как считает сервер (ночью по UTC это может быть ещё вчера).
const today = localClock().day;
const plus = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

describe('даты серии', () => {
  it('будни, 2/2, раз в неделю, ежедневно; по снегопаду — по вызову', () => {
    // 2026-10-02 — пятница
    expect(seriesDates('ежедневно, будни', '2026-10-02', 3)).toEqual(['2026-10-02', '2026-10-05', '2026-10-06']);
    expect(seriesDates('ежедневно, будни', '2026-10-03', 1)).toEqual(['2026-10-05']);
    expect(seriesDates('график 2/2', '2026-10-01', 4)).toEqual(['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06']);
    expect(seriesDates('раз в неделю', '2026-10-01', 3)).toEqual(['2026-10-01', '2026-10-08', '2026-10-15']);
    expect(seriesDates('ежедневно до конца сезона', '2026-12-31', 2)).toEqual(['2026-12-31', '2027-01-01']);
    expect(seriesDates('по снегопаду', '2026-10-01', 5)).toBeNull();
    expect(seriesDayLabel('2026-10-05')).toBe('5 октября, пн');
  });
});

async function mkUser(role: 'freelancer' | 'employer', login: string, phoneKey: string, name: string): Promise<U> {
  const u = await one<{ id: string }>(
    `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version)
     VALUES ($1, $2, '+7' || $3, $3, 'x@x.ru', 'x', $4, 'Москва', $5, $6, now(), 't') RETURNING id`,
    [role, login, phoneKey, name, MOSCOW.lat, MOSCOW.lng]);
  return { id: u!.id, role, city: 'Москва', base_lat: MOSCOW.lat, base_lng: MOSCOW.lng } as U;
}
const form = (over: Record<string, unknown> = {}) => ({
  ...MOSCOW, address: 'Москва, ул. Тверская, 18', district: 'Москва', type: 'snow', desc: 'Двор 320 м²', crew: '1', pay: '3000',
  unit: 'за смену', payType: 'перевод на карту', dateISO: plus(today, 2), access: ['домофон'], tools: 'нужен свой инвентарь',
  regular: true, repeat: 'ежедневно до конца сезона', ...over
});
async function expectErr(p: Promise<unknown>, text: RegExp) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(AppError); expect((e as Error).message).toMatch(text); return; }
  throw new Error('ожидалась ошибка');
}

let emp: U, fl: U;
beforeAll(async () => {
  await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool(), undefined, () => {});
});
beforeEach(async () => {
  await query('TRUNCATE jobs, rate_limits CASCADE');
  await query('DELETE FROM users');
  emp = await mkUser('employer', 'aigul_t', '9161111111', 'Айгуль Тлеубаева');
  fl = await mkUser('freelancer', 'daniyar_s', '9160000000', 'Данияр Сапаров');
});
afterAll(async () => { await pool().end(); });

describe('серия в заказе', () => {
  it('карточка: 5 дней по правилу; нанятый снимает день и возвращает; работодатель видит, сколько сняли', async () => {
    const j = await jobs.createJob(form(), emp, today);
    const guest = await jobs.getJob(j.num, null);
    expect(guest.series!.days.map(d => d.date)).toEqual([0, 1, 2, 3, 4].map(i => plus(today, 2 + i)));
    expect(guest.series).toMatchObject({ canSkip: false, canExtend: false, onCall: false });
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    const app = (await jobs.getJob(j.num, emp)).applicantList![0].id;
    await sh.staffAction(j.num, app, 'hire', emp);
    const day = plus(today, 3);
    const d = await sh.toggleSeriesDay(j.num, { day }, fl);
    expect(d.series!.days.find(x => x.date === day)!.skipped).toBe(true);
    expect((await jobs.getJob(j.num, emp)).series!.days.find(x => x.date === day)!.skippedBy).toBe(1);
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND kind = 'withdrawal'`, [emp.id]))!.text).toMatch(/не сможет выйти/);
    const back = await sh.toggleSeriesDay(j.num, { day }, fl);
    expect(back.series!.days.find(x => x.date === day)!.skipped).toBe(false);
    await expectErr(sh.toggleSeriesDay(j.num, { day: plus(today, 30) }, fl), /нет/);
    await expectErr(sh.toggleSeriesDay(j.num, { day }, emp), /нанятый/);
  });

  it('три снятых дня подряд — пометка в профиле, один раз', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    await sh.staffAction(j.num, (await jobs.getJob(j.num, emp)).applicantList![0].id, 'hire', emp);
    for (const k of [2, 3]) await sh.toggleSeriesDay(j.num, { day: plus(today, k) }, fl);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM user_marks WHERE user_id = $1`, [fl.id]))!.n).toBe(0);
    await sh.toggleSeriesDay(j.num, { day: plus(today, 4) }, fl);
    await sh.toggleSeriesDay(j.num, { day: plus(today, 5) }, fl);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM user_marks WHERE user_id = $1 AND kind = 'late_withdrawal'`, [fl.id]))!.n).toBe(1);
  });

  it('продление: +4 выхода, нанятым — предложение; разовый и «по снегопаду» — без снятия дней', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    await sh.staffAction(j.num, (await jobs.getJob(j.num, emp)).applicantList![0].id, 'hire', emp);
    await expectErr(sh.extendSeries(j.num, fl), /работодатель/);
    const d = await sh.extendSeries(j.num, emp);
    expect(d.series!.days).toHaveLength(9);
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND text LIKE 'Серия%'`, [fl.id]))!.text).toMatch(/продлена/);
    const once = await jobs.createJob(form({ regular: false, repeat: '' }), emp, today);
    expect((await jobs.getJob(once.num, emp)).series).toBeNull();
    const snow = await jobs.createJob(form({ repeat: 'по снегопаду' }), emp, today);
    const s = (await jobs.getJob(snow.num, emp)).series!;
    expect(s).toMatchObject({ onCall: true, days: [], canCall: true, canExtend: false });
    await expectErr(sh.extendSeries(snow.num, emp), /вызывайте бригаду/);
  });

  it('«по снегопаду»: вызов на дату — день серии; снять, замена, сдать и принять как обычный день; отмена вызова', async () => {
    const other = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга Кузнецова');
    const j = await jobs.createJob(form({ repeat: 'по снегопаду' }), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    await sh.staffAction(j.num, (await jobs.getJob(j.num, emp)).applicantList![0].id, 'hire', emp);
    await expectErr(sh.toggleSeriesDay(j.num, { day: plus(today, 1) }, fl), /не вызывали/);
    await expectErr(sh.callSeries(j.num, { day: plus(today, 1) }, fl), /работодатель/);
    await expectErr(sh.callSeries(j.num, { day: plus(today, -1) }, emp), /прошла/);
    await expectErr(sh.callSeries(j.num, { day: plus(today, 40) }, emp), /месяц/);
    const called = await sh.callSeries(j.num, { day: plus(today, 1) }, emp);
    await sh.callSeries(j.num, { day: plus(today, 3) }, emp);
    await expectErr(sh.callSeries(j.num, { day: plus(today, 1) }, emp), /уже вызвана/);
    expect(called.series!.days.map(d => d.date)).toEqual([plus(today, 1)]);
    expect((await one<{ text: string; urgent: boolean }>(`SELECT text, urgent FROM events WHERE user_id = $1 AND text LIKE 'Вызов после снегопада%'`, [fl.id]))).toMatchObject({ urgent: true });

    // Вызов — обычный день серии: снять, взять замену.
    await sh.toggleSeriesDay(j.num, { day: plus(today, 3) }, fl);
    await sh.offerSubstitute(j.num, { day: plus(today, 3) }, other);
    expect((await jobs.getJob(j.num, emp)).series!.days.find(d => d.date === plus(today, 3))!.canUncall).toBe(true);
    // Отмена вызова снимает и снятия, и замены; откликнувшаяся узнаёт.
    const after = await sh.callSeries(j.num, { day: plus(today, 3), cancel: true }, emp);
    expect(after.series!.days.map(d => d.date)).toEqual([plus(today, 1)]);
    expect(await one('SELECT 1 FROM series_subs WHERE job_id = (SELECT id FROM jobs WHERE num = $1)', [j.num])).toBeNull();
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND kind = 'cancel'`, [other.id]))!.text).toMatch(/отменён/);

    // Наступил день вызова: сдать и принять, как день по графику; отменять поздно.
    await query(`UPDATE series_calls SET day = day - 1`);
    await expectErr(sh.callSeries(j.num, { day: today, cancel: true }, emp), /поздно/);
    await expectErr(sh.reportDone(j.num, fl), /Сдать день/);
    await sh.seriesDayAction(j.num, { day: today, action: 'report' }, fl);
    const acc = await sh.seriesDayAction(j.num, { day: today, action: 'accept' }, emp);
    expect(acc.series!.days[0].work).toMatchObject({ acceptedAt: expect.any(String), canPay: true, canReport: false });
    // Набор снова открыт, но у серии есть история вызовов: смена графика — отказ.
    await sh.leaveShift(j.num, { reason: 'заболел', notice: 'больше суток' }, fl);
    await expectErr(jobs.updateJob(j.num, form({ repeat: 'раз в неделю' }), emp, today), /сдвинуть её даты нельзя/);
  });

  it('замена на день: свободное место после «Не смогу», отклик, найм на день, чат; вернуть занятый день нельзя', async () => {
    const other = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга Кузнецова');
    const j = await jobs.createJob(form(), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    await sh.staffAction(j.num, (await jobs.getJob(j.num, emp)).applicantList![0].id, 'hire', emp);
    const day = plus(today, 3);
    await expectErr(sh.offerSubstitute(j.num, { day }, other), /свободных мест нет/);
    await sh.toggleSeriesDay(j.num, { day }, fl);
    // Свободное место видно даже гостю.
    expect((await jobs.getJob(j.num, null)).series!.days.find(d => d.date === day)!.free).toBe(1);
    const mine = await sh.offerSubstitute(j.num, { day }, other);
    expect(mine.series!.canSub).toBe(true);
    expect(mine.series!.days.find(d => d.date === day)!.mySub).toBe('sent');
    await expectErr(sh.offerSubstitute(j.num, { day }, fl), /уже в этой серии/);
    const empView = (await jobs.getJob(j.num, emp)).series!.days.find(d => d.date === day)!;
    expect(empView.subs).toEqual([{ id: other.id, name: 'Ольга К.', status: 'sent' }]);
    await expectErr(sh.decideSubstitute(j.num, { day, freelancer: other.id, action: 'hire' }, fl), /работодатель/);
    const after = await sh.decideSubstitute(j.num, { day, freelancer: other.id, action: 'hire' }, emp);
    expect(after.series!.days.find(d => d.date === day)!.free).toBe(0);
    // Взятому на замену открыт чат, писать можно.
    const msg = await sh.sendMessage(j.num, other.id, { text: 'Буду к 8:00' }, other);
    expect(msg.mine).toBe(true);
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND kind = 'hire'`, [other.id]))!.text).toMatch(/замену/);
    await expectErr(sh.toggleSeriesDay(j.num, { day }, fl), /уже взял замену/);
    const third = await mkUser('freelancer', 'ivan_p', '9164444444', 'Иван Петров');
    await expectErr(sh.offerSubstitute(j.num, { day }, third), /свободных мест нет/);
  });

  /** Серия на одного: исполнитель нанят и снял день; вторая — откликнулась на замену (и, если нужно, взята). */
  async function withSub(hireSub: boolean, over: Record<string, unknown> = {}) {
    const other = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга Кузнецова');
    const j = await jobs.createJob(form(over), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    await sh.staffAction(j.num, (await jobs.getJob(j.num, emp)).applicantList![0].id, 'hire', emp);
    const day = plus(today, 3);
    await sh.toggleSeriesDay(j.num, { day }, fl);
    await sh.offerSubstitute(j.num, { day }, other);
    if (hireSub) await sh.decideSubstitute(j.num, { day, freelancer: other.id, action: 'hire' }, emp);
    return { j, day, other };
  }
  const freeOn = async (num: number, day: string) => (await jobs.getJob(num, null)).series!.days.find(d => d.date === day)!.free;

  it('ушёл из серии: его снятые дни без замены больше не «свободны», день с заменой остаётся за ней', async () => {
    const { j, day, other } = await withSub(true);
    const lone = plus(today, 4);
    await sh.toggleSeriesDay(j.num, { day: lone }, fl);
    expect(await freeOn(j.num, lone)).toBe(1);
    await sh.leaveShift(j.num, { reason: 'заболел', notice: 'больше суток' }, fl);
    expect(await freeOn(j.num, lone)).toBe(0);
    expect(await freeOn(j.num, day)).toBe(0);
    expect((await jobs.getJob(j.num, other)).series!.days.find(d => d.date === day)!.mySub).toBe('hired');
    // Новый исполнитель в основной состав не получает чужих «снятых» дней.
    const next = await mkUser('freelancer', 'ivan_p', '9164444444', 'Иван Петров');
    await jobs.applyToJob(j.num, { reqConfirmed: true }, next, today);
    const app = (await jobs.getJob(j.num, emp)).applicantList!.find(a => a.thread === next.id)!.id;
    await sh.staffAction(j.num, app, 'hire', emp);
    expect((await jobs.getJob(j.num, next)).series!.days.every(d => !d.skipped)).toBe(true);
  });

  it('«Не вышел» тоже закрывает его снятые дни', async () => {
    const { j, day } = await withSub(false);
    const app = (await jobs.getJob(j.num, emp)).applicantList!.find(a => a.thread === fl.id)!.id;
    await sh.staffAction(j.num, app, 'no-show', emp);
    expect(await freeOn(j.num, day)).toBe(0);
    expect(await one('SELECT 1 FROM series_skips WHERE freelancer_id = $1', [fl.id])).toBeNull();
  });

  it('замена видна себе: в «Моих сменах» с днём и решением, на экране «Смена» — после найма на день', async () => {
    const { j, day, other } = await withSub(false);
    const before = (await sh.myJobs(other)).find(x => x.num === j.num)!;
    expect(before).toMatchObject({ myStatus: null, subDays: [{ day, status: 'sent' }] });
    expect(await sh.currentShift(other)).toBeNull();
    await sh.decideSubstitute(j.num, { day, freelancer: other.id, action: 'hire' }, emp);
    expect((await sh.myJobs(other)).find(x => x.num === j.num)!.subDays).toEqual([{ day, status: 'hired' }]);
    expect((await sh.currentShift(other))!.num).toBe(j.num);
    // Основному составу подпись не мешает.
    expect((await sh.myJobs(fl)).find(x => x.num === j.num)!.subDays).toEqual([]);
  });

  it('замену взяли в основной состав — её замены по дням снимаются, место на день снова свободно', async () => {
    const { j, day, other } = await withSub(true, { crew: '2' });
    expect(await freeOn(j.num, day)).toBe(0);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, other, today);
    const app = (await jobs.getJob(j.num, emp)).applicantList!.find(a => a.thread === other.id)!.id;
    await sh.staffAction(j.num, app, 'hire', emp);
    expect(await one('SELECT 1 FROM series_subs WHERE freelancer_id = $1', [other.id])).toBeNull();
    expect(await freeOn(j.num, day)).toBe(1);
  });

  it('отмена серии доходит и до замен', async () => {
    const { j, other } = await withSub(true);
    await jobs.cancelJob(j.num, { reason: 'объект закрыт', notice: 'больше суток' }, emp);
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND kind = 'cancel'`, [other.id]))!.text).toMatch(/отменён/);
  });

  it('блокировка исполнителя: снят со смены и с будущих замен, работодатель узнаёт сразу', async () => {
    const staff = await mkUser('employer', 'staff_1', '9165555555', 'Сотрудник Поддержки');
    await query('UPDATE users SET is_staff = true WHERE id = $1', [staff.id]);
    const { j, day, other } = await withSub(true, { crew: '2' });
    const j2 = await jobs.createJob(form({ address: 'Москва, ул. Арбат, 1' }), emp, today);
    await sh.toggleSeriesDay(j.num, { day: plus(today, 4) }, fl);
    await sh.offerSubstitute(j2.num, { day: plus(today, 2) }, other).catch(() => {});

    await support.setBlocked(staff, other.id, { blocked: true, note: 'нарушение правил площадки' });
    expect(await one('SELECT 1 FROM series_subs WHERE freelancer_id = $1', [other.id])).toBeNull();
    expect(await freeOn(j.num, day)).toBe(1);
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND text LIKE '%снят с замены%'`, [emp.id]))!.text).toMatch(/заблокирован/);

    await support.setBlocked(staff, fl.id, { blocked: true, note: 'нарушение правил площадки' });
    const after = await jobs.getJob(j.num, emp);
    expect(after.hired).toBe(0);
    expect(after.status).toBe('open');
    expect(await one('SELECT 1 FROM series_skips WHERE freelancer_id = $1', [fl.id])).toBeNull();
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND text LIKE '%снят со смены площадкой%'`, [emp.id]))!.text).toMatch(/Набор открыт/);
  });
});

describe('сдача, приёмка и расчёт по дням серии', () => {
  /** Серия, начавшаяся два дня назад: дни — позавчера, вчера, сегодня, завтра, послезавтра. */
  async function running(over: Record<string, unknown> = {}) {
    const j = await jobs.createJob(form(over), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    await sh.staffAction(j.num, (await jobs.getJob(j.num, emp)).applicantList![0].id, 'hire', emp);
    await query('UPDATE jobs SET date = $2 WHERE num = $1', [j.num, plus(today, -2)]);
    return j.num;
  }
  const dayOf = async (num: number, who: U | null, date: string) => (await jobs.getJob(num, who)).series!.days.find(d => d.date === date)!;
  const act = (num: number, who: U, day: string, action: string) => sh.seriesDayAction(num, { day, action }, who);

  it('день сдаёт тот, кто выходил, — с дня выхода; работодатель принимает; расчёт отмечают обе стороны', async () => {
    const num = await running();
    const d1 = plus(today, -2);
    expect((await dayOf(num, null, d1)).work).toBeNull();
    expect((await dayOf(num, fl, d1)).work).toMatchObject({ canReport: true, canAccept: false, workers: 1 });
    expect((await dayOf(num, emp, d1)).work).toMatchObject({ canReport: false, canAccept: true });
    await expectErr(act(num, fl, plus(today, 1), 'report'), /ещё не наступил/);
    await expectErr(sh.reportDone(num, fl), /Сдать день/);
    await act(num, fl, d1, 'report');
    await expectErr(act(num, fl, d1, 'report'), /уже сдан/);
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND kind = 'report'`, [emp.id]))!.text).toMatch(/сдан\. Примите день/);
    expect((await dayOf(num, emp, d1)).work!.autoAcceptAt).not.toBeNull();
    await expectErr(act(num, fl, d1, 'paid'), /Сначала работодатель/);
    await expectErr(act(num, fl, d1, 'accept'), /только работодатель/);
    await act(num, emp, d1, 'accept');
    expect((await dayOf(num, fl, d1)).work).toMatchObject({ canPay: true, acceptedAt: expect.any(String) });
    await act(num, fl, d1, 'paid');
    await act(num, emp, d1, 'paid');
    expect((await dayOf(num, fl, d1)).work).toMatchObject({ employerPaid: true, freelancerPaid: true, canPay: false });
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND kind = 'settle' ORDER BY created_at DESC LIMIT 1`, [fl.id]))!.text).toMatch(/обеими сторонами/);
    // Серия идёт дальше: заказ не закрыт, сданный сегодня день уже не снять.
    expect((await jobs.getJob(num, emp)).status).toBe('staffed');
    await act(num, fl, today, 'report');
    await expectErr(sh.toggleSeriesDay(num, { day: today }, fl), /уже сдан/);
  });

  it('бригада: день сдаёт старший, а если он в этот день не выходит — любой из выходящих; замена сдаёт свой день', async () => {
    const other = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга Кузнецова');
    const num = await running({ crew: '2' });
    await jobs.applyToJob(num, { reqConfirmed: true }, other, today);
    const apps = (await jobs.getJob(num, emp)).applicantList!;
    await sh.staffAction(num, apps.find(a => a.thread === other.id)!.id, 'hire', emp);
    await sh.staffAction(num, apps.find(a => a.thread === fl.id)!.id, 'lead', emp);
    await expectErr(act(num, other, plus(today, -1), 'report'), /старший/);
    await act(num, fl, plus(today, -1), 'report');
    // Старший снял сегодняшний день — сдаёт Ольга.
    await sh.toggleSeriesDay(num, { day: today }, fl);
    expect((await dayOf(num, other, today)).work).toMatchObject({ canReport: true, workers: 1 });
    await act(num, other, today, 'report');

    // Замена на день сдаёт свой день сама.
    const sub = await mkUser('freelancer', 'ivan_p', '9164444444', 'Иван Петров');
    const tomorrow = plus(today, 1);
    await sh.toggleSeriesDay(num, { day: tomorrow }, other);
    await sh.offerSubstitute(num, { day: tomorrow }, sub);
    await sh.decideSubstitute(num, { day: tomorrow, freelancer: sub.id, action: 'hire' }, emp);
    // Прошли сутки: «завтра» стало сегодня.
    for (const sql of ['UPDATE jobs SET date = date - 1', 'UPDATE series_skips SET day = day - 1', 'UPDATE series_subs SET day = day - 1', 'UPDATE series_days SET day = day - 1']) await query(sql);
    expect((await dayOf(num, sub, today)).work).toMatchObject({ workers: 2, canReport: false });
    await expectErr(act(num, sub, today, 'report'), /старший/);
    await act(num, fl, today, 'report');
    await act(num, emp, today, 'accept');
    expect((await one<{ workers: string[] }>('SELECT workers FROM series_days WHERE day = $1', [today]))!.workers.sort()).toEqual([fl.id, sub.id].sort());
    await act(num, sub, today, 'paid');
    await expectErr(act(num, other, today, 'paid'), /стороны смены этого дня/);
  });

  it('отзывы для замены: после приёмки её дня, не дожидаясь конца серии; состав — после завершения', async () => {
    const other = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга Кузнецова');
    const num = await running();
    await sh.toggleSeriesDay(num, { day: today }, fl);
    await sh.offerSubstitute(num, { day: today }, other);
    await sh.decideSubstitute(num, { day: today, freelancer: other.id, action: 'hire' }, emp);
    expect((await jobs.getJob(num, other)).series!.reviews).toEqual([]);
    await expectErr(sh.saveReview(num, { rating: 5, text: 'Всё чётко' }, other), /стороны смены/);
    await act(num, other, today, 'report');
    await act(num, emp, today, 'accept');
    expect((await jobs.getJob(num, other)).series!.reviews).toEqual([{ target: 'employer', name: 'Айгуль Т.', mine: null, complained: false }]);
    expect((await jobs.getJob(num, emp)).series!.reviews).toEqual([{ target: other.id, name: 'Ольга К.', mine: null, complained: false }]);
    // Принятый выход на замену засчитывается в закрытые смены.
    expect((await one<{ n: number }>(`SELECT ${doneSql('$1::uuid')} AS n`, [other.id]))!.n).toBe(1);
    await sh.saveReview(num, { rating: 5, text: 'Всё чётко, рассчитались сразу' }, other);
    await sh.saveReview(num, { target: other.id, rating: 4, text: 'Вышла вовремя' }, emp);
    expect((await jobs.getJob(num, other)).series!.reviews[0].mine).toMatchObject({ rating: 5, editable: true });
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM reviews WHERE target_id = $1', [other.id]))!.n).toBe(1);
    // Основной состав оценивает после завершения серии.
    await expectErr(sh.saveReview(num, { rating: 5, text: 'Хорошо' }, fl), /после приёмки/);
    await expectErr(sh.saveReview(num, { target: fl.id, rating: 5 }, emp), /работал на смене/);
    // Жалоба на замену — тоже после приёмки её дня и адресуется ей.
    await sh.fileComplaint(num, { reason: 'грубое общение', text: 'Грубила в чате', target: other.id }, emp);
    expect((await one<{ target_id: string }>('SELECT target_id FROM complaints'))!.target_id).toBe(other.id);
    expect((await jobs.getJob(num, emp)).series!.reviews[0].complained).toBe(true);
    await sh.fileComplaint(num, { reason: 'грубое общение', text: 'Грубили при встрече' }, other);
    expect((await jobs.getJob(num, other)).series!.reviews[0].complained).toBe(true);
  });

  it('закончившаяся серия уходит из поиска, не принимает отклики и закрывается сама через 7 дней', async () => {
    const other = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга Кузнецова');
    const j = await jobs.createJob(form({ repeat: 'раз в неделю', crew: '2' }), emp, today);
    expect((await one<{ e: string }>(`SELECT to_char(series_end, 'YYYY-MM-DD') AS e FROM jobs WHERE num = $1`, [j.num]))!.e).toBe(plus(today, 2 + 28));
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    await sh.staffAction(j.num, (await jobs.getJob(j.num, emp)).applicantList![0].id, 'hire', emp);
    await sh.extendSeries(j.num, emp);
    expect((await one<{ e: string }>(`SELECT to_char(series_end, 'YYYY-MM-DD') AS e FROM jobs WHERE num = $1`, [j.num]))!.e).toBe(plus(today, 2 + 56));
    const search = async () => (await jobs.listJobs({ ...MOSCOW, today, when: 'all' } as never, other)).jobs.map(x => x.num);
    expect(await search()).toContain(j.num);
    // Все 9 выходов прошли: последний — 3 дня назад.
    await query('UPDATE jobs SET date = $2 WHERE num = $1', [j.num, plus(today, -59)]);
    await jobs.syncSeriesEnd((await one<{ id: string }>('SELECT id FROM jobs WHERE num = $1', [j.num]))!.id, pool());
    jobs.invalidateSearch();   // прямой SQL в обход приложения — кэш выдачи о нём не знает
    expect(await search()).not.toContain(j.num);
    await expectErr(jobs.applyToJob(j.num, { reqConfirmed: true }, other, today), /закончилась/);
    expect(await sh.autoAcceptDue()).not.toContain(j.num);
    // Через 7 дней после последнего выхода — закрывается автоматически, отзывы открыты.
    await query('UPDATE jobs SET date = date - 5, series_end = series_end - 5 WHERE num = $1', [j.num]);
    expect(await sh.autoAcceptDue()).toContain(j.num);
    const closed = await jobs.getJob(j.num, fl);
    expect(closed.status).toBe('accepted');
    expect(closed.shift!.reviewTargets).toEqual([{ target: 'employer', name: 'Айгуль Т.' }]);
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND kind = 'accept'`, [fl.id]))!.text).toMatch(/Серия завершилась/);
  });

  it('даты серии с историей не сдвигаются: перенос начала и смена графика — отказ; без истории — можно', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await sh.moveDate(j.num, { date: plus(today, 3) }, emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    const app = (await jobs.getJob(j.num, emp)).applicantList![0].id;
    await sh.staffAction(j.num, app, 'hire', emp);
    await sh.toggleSeriesDay(j.num, { day: plus(today, 4) }, fl);
    await expectErr(sh.moveDate(j.num, { date: plus(today, 5) }, emp, today), /сдвинуть её даты нельзя/);
    // Исполнитель ушёл, набор снова открыт, но замена на день осталась — правка графика тоже не сдвигает даты.
    const other = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга Кузнецова');
    await sh.offerSubstitute(j.num, { day: plus(today, 4) }, other);
    await sh.decideSubstitute(j.num, { day: plus(today, 4), freelancer: other.id, action: 'hire' }, emp);
    await sh.leaveShift(j.num, { reason: 'заболел', notice: 'больше суток' }, fl);
    await expectErr(jobs.updateJob(j.num, form({ dateISO: plus(today, 3), repeat: 'раз в неделю' }), emp, today), /сдвинуть её даты нельзя/);
    const same = await jobs.updateJob(j.num, form({ dateISO: plus(today, 3), pay: '3500' }), emp, today);
    expect(same.pay).toBe(3500);
  });

  it('сданный день без ответа засчитывается через 7 дней; «Завершить серию» принимает сданные и сводит расчёт', async () => {
    const num = await running();
    const [d1, d2] = [plus(today, -2), plus(today, -1)];
    await act(num, fl, d1, 'report');
    await query(`UPDATE series_days SET reported_at = now() - interval '8 days'`);
    await sh.autoAcceptDue();
    expect((await dayOf(num, emp, d1)).work).toMatchObject({ autoAccepted: true, acceptedAt: expect.any(String) });
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND kind = 'accept'`, [fl.id]))!.text).toMatch(/засчитан вам автоматически/);
    expect((await jobs.getJob(num, emp)).status).toBe('staffed');
    // Спор по расчёту доступен после первого сданного дня; доказательства — по дням этого исполнителя.
    expect((await jobs.getJob(num, fl)).shift!.canDispute).toBe(true);
    await disputes.openDispute(num, { reason: 'оплата не пришла в срок', sum: 3000, text: 'За первый день оплаты так и нет' }, fl);
    const ev = (await one<{ evidence: { label: string }[] }>('SELECT evidence FROM disputes'))!.evidence.map(e => e.label);
    expect(ev).toContain('Выходы серии: сдано 1, принято 1 (из них автоматически — 1)');
    expect(ev).toContain('Работодатель отметил оплату за 0 из 1 принятых дней');

    await act(num, fl, d2, 'report');
    const closed = await sh.acceptWork(num, emp);
    expect(closed.status).toBe('accepted');
    expect((await dayOf(num, emp, d2)).work!.acceptedAt).not.toBeNull();
    expect(closed.shift!.settle).toEqual({ employer: false, freelancer: false });
    await act(num, emp, d1, 'paid');
    expect((await jobs.getJob(num, emp)).shift!.settle).toEqual({ employer: false, freelancer: false });
    await sh.markSettled(num, emp);                 // за все принятые дни разом
    expect((await jobs.getJob(num, emp)).shift!.settle!.employer).toBe(true);
    await sh.markSettled(num, fl);
    expect((await jobs.getJob(num, fl)).shift!.settle).toEqual({ employer: true, freelancer: true });
    await expectErr(act(num, fl, today, 'report'), /закрыта/);
  });
});
