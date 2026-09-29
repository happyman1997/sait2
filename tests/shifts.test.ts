// Интеграционные тесты жизненного цикла смены: найм → чат → сдача → приёмка/автоприёмка → расчёт → отзыв/жалоба.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const jobs = await import('@/server/jobs');
const sh = await import('@/server/shifts');
const live = await import('@/server/live');
const { runDueTasks } = await import('@/server/cron');
const { AppError } = await import('@/server/errors');
const { localISO, HIRE_GREETING, REPORT_MESSAGE } = await import('@/lib/jobs');

type Viewer = Parameters<typeof jobs.listJobs>[1];
type U = NonNullable<Viewer>;

const today = localISO();
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localISO(d); };
const MOSCOW = { lat: 55.7558, lng: 37.6173 };

let emp: U, emp2: U, fl: U, fl2: U, fl3: U;

async function mkUser(role: 'freelancer' | 'employer', login: string, phoneKey: string, name: string): Promise<U> {
  const u = await one<{ id: string }>(
    `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version)
     VALUES ($1, $2, '+7' || $3, $3, 'x@x.ru', 'x', $4, 'Москва', $5, $6, now(), 't') RETURNING id`,
    [role, login, phoneKey, name, MOSCOW.lat, MOSCOW.lng]);
  return { id: u!.id, role, city: 'Москва', base_lat: MOSCOW.lat, base_lng: MOSCOW.lng };
}

const form = (over: Record<string, unknown> = {}) => ({
  ...MOSCOW, address: 'Москва, ул. Тверская, 18', district: 'Москва', type: 'snow', desc: 'Двор 320 м²', crew: '1', pay: '6000',
  unit: 'за заказ', payType: 'перевод на карту', dateISO: plusDays(3), access: ['домофон'], tools: 'нужен свой инвентарь',
  meetName: 'Марат', meetPhone: '+7 900 000-00-00', ...over
});

async function expectErr(p: Promise<unknown>, text?: RegExp, field?: string) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    if (text) expect((e as Error).message).toMatch(text);
    if (field !== undefined) expect((e as InstanceType<typeof AppError>).field).toBe(field);
    return e as InstanceType<typeof AppError>;
  }
  throw new Error('ожидалась ошибка');
}

/** Заказ с откликами: возвращает номер и id откликов в порядке откликнувшихся. */
async function jobWithApps(people: U[], over: Record<string, unknown> = {}) {
  const j = await jobs.createJob(form(over), emp, today);
  for (const p of people) await jobs.applyToJob(j.num, { reqConfirmed: true }, p, today);
  const d = await jobs.getJob(j.num, emp);
  const ids = people.map(p => d.applicantList!.find(a => a.name === shortOf(p))!.id);
  return { num: j.num, ids };
}
const names = new Map<string, string>();
const shortOf = (u: U) => names.get(u.id)!;

beforeAll(async () => {
  await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool(), undefined, () => {});
});

beforeEach(async () => {
  await query('TRUNCATE jobs, rate_limits CASCADE');
  await query('DELETE FROM job_types WHERE is_custom');
  await query('DELETE FROM users');
  emp = await mkUser('employer', 'aigul_t', '9161111111', 'Айгуль Тлеубаева');
  emp2 = await mkUser('employer', 'petr_i', '9162222222', 'Пётр Иванов');
  fl = await mkUser('freelancer', 'daniyar_s', '9160000000', 'Данияр Сапаров');
  fl2 = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга Кузнецова');
  fl3 = await mkUser('freelancer', 'ivan_p', '9164444444', 'Иван Петров');
  names.set(fl.id, 'Данияр С.'); names.set(fl2.id, 'Ольга К.'); names.set(fl3.id, 'Иван П.');
});

afterAll(async () => { await pool().end(); });

describe('найм', () => {
  it('нанять: открывает чат с приветствием, телефон встречающего — нанятому, смена набрана', async () => {
    const { num, ids } = await jobWithApps([fl, fl2]);
    expect((await jobs.getJob(num, fl)).meetPhone).toBeNull();
    const d = await sh.staffAction(num, ids[0], 'hire', emp);
    expect(d.status).toBe('staffed');
    expect(d.hired).toBe(1);
    const mine = await jobs.getJob(num, fl);
    expect(mine.myStatus).toBe('hired');
    expect(mine.meetPhone).toBe('+7 900 000-00-00');
    expect(mine.shift?.canChat).toBe(true);
    const chat = await sh.listMessages(num, fl.id, fl);
    expect(chat.messages).toEqual([expect.objectContaining({ mine: false, text: HIRE_GREETING })]);
    expect(chat.canSend).toBe(true);
    await expectErr(sh.staffAction(num, ids[1], 'hire', emp), /набрана/);
    await expectErr(sh.staffAction(num, ids[0], 'hire', emp), /уже нанят/);
  });

  it('права: нанимает только работодатель своего заказа', async () => {
    const { num, ids } = await jobWithApps([fl]);
    await expectErr(sh.staffAction(num, ids[0], 'hire', emp2), /только работодатель/);
    await expectErr(sh.staffAction(num, ids[0], 'hire', fl), /только работодатель/);
    await expectErr(sh.staffAction(num, 'не-uuid', 'hire', emp), /не найден/);
  });

  it('отказ: нанятого нельзя отклонить — для него «Не вышел»; «Отказать остальным»', async () => {
    const { num, ids } = await jobWithApps([fl, fl2, fl3], { crew: '3' });
    await sh.staffAction(num, ids[0], 'hire', emp);
    await expectErr(sh.staffAction(num, ids[0], 'reject', emp), /Не вышел/);
    await sh.staffAction(num, ids[1], 'reject', emp);
    expect((await jobs.getJob(num, fl2)).myStatus).toBe('rejected');
    await expectErr(sh.staffAction(num, ids[1], 'hire', emp), /отклонили/);
    const r = await sh.rejectRest(num, emp);
    expect(r.rejected).toBe(1);
    expect((await jobs.getJob(num, fl3)).myStatus).toBe('rejected');
  });

  it('старший: только в бригаде и только нанятый; телефон встречающего в бригаде — только старшему', async () => {
    const solo = await jobWithApps([fl]);
    await sh.staffAction(solo.num, solo.ids[0], 'hire', emp);
    await expectErr(sh.staffAction(solo.num, solo.ids[0], 'lead', emp), /только в бригаде/);

    const { num, ids } = await jobWithApps([fl, fl2, fl3], { crew: '2' });
    await expectErr(sh.staffAction(num, ids[0], 'lead', emp), /только нанятого/);
    await sh.staffAction(num, ids[0], 'hire', emp);
    expect((await jobs.getJob(num, fl)).meetPhone).toBe('+7 900 000-00-00'); // пока один нанятый
    await sh.staffAction(num, ids[1], 'hire', emp);
    expect((await jobs.getJob(num, fl)).meetPhone).toBeNull();
    await sh.staffAction(num, ids[1], 'lead', emp);
    expect((await jobs.getJob(num, fl2)).meetPhone).toBe('+7 900 000-00-00');
    expect((await jobs.getJob(num, fl)).meetPhone).toBeNull();
    const d = await jobs.getJob(num, fl);
    expect(d.shift).toMatchObject({ leadName: 'Ольга К.', iAmLead: false });
    // смена старшего — у бригады один старший
    await sh.staffAction(num, ids[0], 'lead', emp);
    expect((await one<{ n: number }>('SELECT count(*)::int n FROM hires WHERE is_lead'))!.n).toBe(1);
  });

  it('«Не вышел» снимает только этого исполнителя, +1 к неявкам, набор открывается', async () => {
    const { num, ids } = await jobWithApps([fl, fl2], { crew: '2' });
    await sh.staffAction(num, ids[0], 'hire', emp);
    await sh.staffAction(num, ids[1], 'hire', emp);
    const d = await sh.staffAction(num, ids[0], 'no-show', emp);
    expect(d.hired).toBe(1);
    expect(d.status).toBe('open');
    expect((await jobs.getJob(num, fl2)).myStatus).toBe('hired');
    const u = await one<{ no_show_count: number }>('SELECT no_show_count FROM users WHERE id = $1', [fl.id]);
    expect(u!.no_show_count).toBe(1);
    const mine = await jobs.getJob(num, fl);
    expect(mine.myStatus).toBe('rejected');
    expect(mine.shift?.noShow).toBe(true);
    // снятый читает историю, но писать не может
    const chat = await sh.listMessages(num, fl.id, fl);
    expect(chat.canSend).toBe(false);
    await expectErr(sh.sendMessage(num, fl.id, { text: 'я тут' }, fl), /только для чтения/);
  });
});

describe('исполнитель', () => {
  it('отказ от смены: причина и срок; меньше суток — пометка на 90 дней, набор открывается', async () => {
    const { num, ids } = await jobWithApps([fl]);
    await sh.staffAction(num, ids[0], 'hire', emp);
    await expectErr(sh.leaveShift(num, { notice: 'меньше суток' }, fl), /причину/, 'reason');
    const d = await sh.leaveShift(num, { reason: 'болезнь', notice: 'меньше суток' }, fl);
    expect(d.myStatus).toBe('withdrawn');
    expect(d.status).toBe('open');
    expect(d.shift?.withdrawal).toMatchObject({ reason: 'болезнь', late: true });
    const mark = await one<{ until: Date }>(`SELECT until FROM user_marks WHERE user_id = $1 AND kind = 'late_withdrawal'`, [fl.id]);
    expect(Math.round((mark!.until.getTime() - Date.now()) / 86400000)).toBe(90);
    await expectErr(sh.leaveShift(num, { reason: 'x', notice: 'больше суток' }, fl), /не наняты/);
  });

  it('сдать работу: только нанятый; в бригаде — старший; дальше 7 дней на приёмку', async () => {
    const { num, ids } = await jobWithApps([fl, fl2, fl3], { crew: '2' });
    await expectErr(sh.reportDone(num, fl), /только нанятый/);
    await sh.staffAction(num, ids[0], 'hire', emp);
    await sh.staffAction(num, ids[1], 'hire', emp);
    await expectErr(sh.reportDone(num, fl), /назначить старшего/);
    await sh.staffAction(num, ids[1], 'lead', emp);
    await expectErr(sh.reportDone(num, fl), /сдаёт старший/);
    const d = await sh.reportDone(num, fl2);
    expect(d.status).toBe('reported');
    expect(d.shift?.reportedAt).toBeTruthy();
    expect(Date.parse(d.shift!.autoAcceptAt!) - Date.parse(d.shift!.reportedAt!)).toBe(7 * 86400000);
    expect((await sh.listMessages(num, fl2.id, emp)).messages.at(-1)).toMatchObject({ mine: false, text: REPORT_MESSAGE });
    await expectErr(sh.reportDone(num, fl2), /уже сдана/);
    // после сдачи — ни отказа, ни «Не вышел», ни найма
    await expectErr(sh.leaveShift(num, { reason: 'болезнь', notice: 'больше суток' }, fl), /сдана/);
    await expectErr(sh.staffAction(num, ids[0], 'no-show', emp), /сдана/);
    await expectErr(sh.staffAction(num, ids[2], 'hire', emp), /закрыт/);
  });

  it('отменённую смену сдать нельзя', async () => {
    const { num, ids } = await jobWithApps([fl]);
    await sh.staffAction(num, ids[0], 'hire', emp);
    await jobs.cancelJob(num, { reason: 'погода изменилась', notice: 'больше суток' }, emp);
    await expectErr(sh.reportDone(num, fl), /отменена/);
  });
});

describe('приёмка, расчёт, отзывы, жалобы', () => {
  async function accepted() {
    const { num, ids } = await jobWithApps([fl]);
    await sh.staffAction(num, ids[0], 'hire', emp);
    await sh.reportDone(num, fl);
    await sh.acceptWork(num, emp);
    return { num, ids };
  }

  it('принять можно, только если кто-то нанят и смена не отменена; принятую не отменить', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await expectErr(sh.acceptWork(j.num, emp), /никто не нанят/);
    const { num } = await accepted();
    const d = await jobs.getJob(num, fl);
    expect(d.status).toBe('accepted');
    expect(d.shift).toMatchObject({ autoAccepted: false, settle: { employer: false, freelancer: false }, reviewTargets: [{ target: 'employer' }] });
    await expectErr(sh.acceptWork(num, emp), /уже принята/);
    await expectErr(jobs.cancelJob(num, { reason: 'x', notice: 'больше суток' }, emp), /напишите в чат/);
  });

  it('приёмка без сдачи тоже возможна (работодатель доволен сразу)', async () => {
    const { num, ids } = await jobWithApps([fl]);
    await sh.staffAction(num, ids[0], 'hire', emp);
    expect((await sh.acceptWork(num, emp)).status).toBe('accepted');
  });

  it('расчёт: обе стороны отмечают, только после приёмки', async () => {
    const { num, ids } = await jobWithApps([fl]);
    await sh.staffAction(num, ids[0], 'hire', emp);
    await expectErr(sh.markSettled(num, emp), /Сначала работодатель/);
    await sh.acceptWork(num, emp);
    await sh.markSettled(num, emp);
    const d = await sh.markSettled(num, fl);
    expect(d.shift?.settle).toEqual({ employer: true, freelancer: true });
    await expectErr(sh.markSettled(num, fl2), /стороны смены/);
    const ev = await one<{ n: number }>(`SELECT count(*)::int n FROM events WHERE kind = 'settle' AND text LIKE 'Расчёт подтверждён%'`);
    expect(ev!.n).toBe(1);
  });

  it('отзыв: 1–5, обе стороны, 10 минут на правку', async () => {
    const { num, ids } = await accepted();
    await expectErr(sh.saveReview(num, { rating: 7, target: ids[0] }, emp), /от 1 до 5/);
    await expectErr(sh.saveReview(num, { rating: 5, text: 'ты идиот', target: ids[0] }, emp), undefined, 'text');
    await sh.saveReview(num, { rating: 4, text: 'Пришёл вовремя', target: ids[0] }, emp);
    const e1 = await sh.saveReview(num, { rating: 5, text: 'Пришёл вовремя, двор чистый', target: ids[0] }, emp);
    expect(e1.shift?.myReviews).toEqual([expect.objectContaining({ target: ids[0], rating: 5, editable: true })]);
    const f = await sh.saveReview(num, { rating: 5, text: 'Рассчитались сразу' }, fl);
    expect(f.shift?.myReviews[0]).toMatchObject({ target: 'employer', rating: 5 });
    expect((await jobs.getJob(num, fl)).employer.rating).toBe(5);
    // окно правки прошло
    await query(`UPDATE reviews SET editable_until = now() - interval '1 second'`);
    await expectErr(sh.saveReview(num, { rating: 1, target: ids[0] }, emp), /нельзя изменить/);
    await expectErr(sh.deleteReview(num, { target: ids[0] }, emp), /нельзя удалить/);
    // посторонний и не участник
    await expectErr(sh.saveReview(num, { rating: 5 }, fl2), /стороны смены/);
  });

  it('отзыв до приёмки нельзя', async () => {
    const { num, ids } = await jobWithApps([fl]);
    await sh.staffAction(num, ids[0], 'hire', emp);
    await expectErr(sh.saveReview(num, { rating: 5 }, fl), /после приёмки/);
  });

  it('жалоба: после приёмки, одна, с модерацией', async () => {
    const { num, ids } = await jobWithApps([fl]);
    await sh.staffAction(num, ids[0], 'hire', emp);
    await expectErr(sh.fileComplaint(num, { reason: 'не рассчитались', text: 'денег нет' }, fl), /после приёмки/);
    await sh.acceptWork(num, emp);
    await expectErr(sh.fileComplaint(num, { reason: 'грабёж', text: 'x' }, fl), /тему/);
    await expectErr(sh.fileComplaint(num, { reason: 'не рассчитались', text: '' }, fl), /Опишите/);
    const d = await sh.fileComplaint(num, { reason: 'не рассчитались', text: 'Работа принята, денег нет третий день' }, fl);
    expect(d.shift?.myComplaint?.reason).toBe('не рассчитались');
    await expectErr(sh.fileComplaint(num, { reason: 'грубое общение', text: 'ещё' }, fl), /уже подана/);
    await sh.fileComplaint(num, { reason: 'работа не выполнена', text: 'Половина двора в снегу', target: ids[0] }, emp);
  });

  it('автоприёмка: через 7 дней после сдачи смена закрывается и засчитывается исполнителю', async () => {
    const { num, ids } = await jobWithApps([fl]);
    await sh.staffAction(num, ids[0], 'hire', emp);
    await sh.reportDone(num, fl);
    expect(await sh.autoAcceptDue()).toEqual([]);
    await query(`UPDATE reports SET reported_at = now() - interval '7 days 1 minute'`);
    const r = await runDueTasks();
    expect(r.autoAccepted).toEqual([num]);
    const d = await jobs.getJob(num, fl);
    expect(d.status).toBe('accepted');
    expect(d.shift).toMatchObject({ autoAccepted: true });
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM events WHERE kind = 'accept' AND text LIKE '%автоматически%'`))!.n).toBe(2);
  });

  it('фоновые задачи не выполняются дважды параллельно', async () => {
    const [a, b] = await Promise.all([runDueTasks(), runDueTasks()]);
    expect([a.skipped, b.skipped].filter(Boolean).length).toBeLessThanOrEqual(1);
  });
});

describe('перенос даты', () => {
  it('уведомляет нанятых и откликнувшихся; закрытую переносить нельзя', async () => {
    const { num, ids } = await jobWithApps([fl, fl2]);
    await sh.staffAction(num, ids[0], 'hire', emp);
    await expectErr(sh.moveDate(num, { date: plusDays(-1) }, emp, today), /прошла/, 'date');
    const d = await sh.moveDate(num, { date: plusDays(1) }, emp, today);
    expect(d.date).toBe(plusDays(1));
    expect(d.urgent).toBe(true);
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM events WHERE kind = 'move'`))!.n).toBe(2);
    await expectErr(sh.moveDate(num, { date: plusDays(2) }, emp2, today), /только работодатель/);
    await sh.acceptWork(num, emp);
    await expectErr(sh.moveDate(num, { date: plusDays(4) }, emp, today), /переносить нельзя/);
  });
});

describe('чат', () => {
  it('до найма чата нет; посторонним — нет; модерация; прочтение и список диалогов', async () => {
    const { num, ids } = await jobWithApps([fl, fl2]);
    await expectErr(sh.listMessages(num, fl.id, fl), /после найма/);
    await sh.staffAction(num, ids[0], 'hire', emp);
    await expectErr(sh.listMessages(num, fl.id, fl2), /после найма/);
    await expectErr(sh.listMessages(num, fl.id, emp2), /после найма/);
    await expectErr(sh.sendMessage(num, fl.id, { text: 'оплата вперед' }, fl), undefined, 'text');
    await expectErr(sh.sendMessage(num, fl.id, { text: '   ' }, fl), /Напишите/);
    await sh.sendMessage(num, fl.id, { text: 'Подтверждаю выход' }, fl);
    await sh.sendMessage(num, fl.id, { text: 'Буду в 8:00' }, fl);

    const empChats = await sh.listChats(emp);
    expect(empChats).toEqual([expect.objectContaining({ num, thread: fl.id, who: 'Данияр С.', last: 'Буду в 8:00', unread: 2, lastMine: false })]);
    const read = await sh.listMessages(num, fl.id, emp);
    expect(read.messages.map(m => m.mine)).toEqual([true, false, false]);
    expect((await sh.listChats(emp))[0].unread).toBe(0);
    // исполнитель видит, что прочитано
    const flView = await sh.listMessages(num, fl.id, fl);
    expect(flView.messages.filter(m => m.mine).every(m => m.read)).toBe(true);
    expect(await sh.listChats(fl2)).toEqual([]);
  });

  it('живые события: найм и сообщение приходят подписчику через LISTEN/NOTIFY', async () => {
    const { num, ids } = await jobWithApps([fl]);
    const got: unknown[] = [];
    const unsub = await live.subscribe(fl.id, e => got.push(e));
    await sh.staffAction(num, ids[0], 'hire', emp);
    await sh.sendMessage(num, fl.id, { text: 'Ждём вас в 8:00' }, emp);
    await new Promise(r => setTimeout(r, 300));
    unsub();
    expect(got).toEqual(expect.arrayContaining([
      expect.objectContaining({ t: 'event', num }),
      expect.objectContaining({ t: 'message', num, thread: fl.id }),
      expect.objectContaining({ t: 'job', num })
    ]));
  });
});

describe('мои смены и отклики', () => {
  it('исполнитель видит свои отклики и найм, работодатель — свои заказы и людей', async () => {
    const a = await jobWithApps([fl, fl2]);
    await sh.staffAction(a.num, a.ids[0], 'hire', emp);
    const b = await jobWithApps([fl]);
    await jobs.cancelJob(b.num, { reason: 'погода изменилась', notice: 'больше суток' }, emp);

    const mine = await sh.myJobs(fl);
    expect(mine.map(j => [j.num, j.myStatus])).toEqual([[a.num, 'hired'], [b.num, 'rejected']].sort((x, y) => (x[0] === b.num ? 1 : -1)));
    expect(mine.find(j => j.num === a.num)).toMatchObject({ counterpart: 'Айгуль Т.', hasChat: true });
    expect(mine.find(j => j.num === b.num)?.cancellation?.reason).toBe('погода изменилась');

    const empJobs = await sh.myJobs(emp);
    expect(empJobs).toHaveLength(2);
    const board = await sh.applicantsBoard(emp);
    expect(board.jobs).toHaveLength(1);
    expect(board.jobs[0].people.map(p => [p.name, p.status])).toEqual([['Данияр С.', 'hired'], ['Ольга К.', 'sent']]);
    await expectErr(sh.applicantsBoard(fl), /раздел работодателя/);
  });
});
