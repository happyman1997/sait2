// Этап 8: споры по расчёту — открыть, ответить, снять, решение поддержки.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const jobs = await import('@/server/jobs');
const sh = await import('@/server/shifts');
const dsp = await import('@/server/disputes');
const prof = await import('@/server/profile');
const { sessionUser, createSession } = await import('@/server/session');
const { AppError } = await import('@/server/errors');
const { localISO } = await import('@/lib/jobs');

type SU = NonNullable<Awaited<ReturnType<typeof sessionUser>>>;
const today = localISO();
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localISO(d); };
const MOSCOW = { lat: 55.7558, lng: 37.6173 };

async function mkUser(role: 'freelancer' | 'employer', login: string, phoneKey: string, name: string, staff = false): Promise<SU> {
  const u = await one<{ id: string }>(
    `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version, is_staff)
     VALUES ($1, $2, '+7' || $3, $3, $2 || '@x.ru', 'x', $4, 'Москва', $5, $6, now(), 't', $7) RETURNING id`,
    [role, login, phoneKey, name, MOSCOW.lat, MOSCOW.lng, staff]);
  await query('INSERT INTO notification_settings (user_id) VALUES ($1)', [u!.id]);
  const { token } = await createSession(u!.id, {});
  return (await sessionUser(token))!;
}
const form = (over: Record<string, unknown> = {}) => ({
  ...MOSCOW, address: 'Москва, ул. Тверская, 18', district: 'Москва', type: 'snow', desc: 'Двор 320 м²', crew: '1', pay: '6000',
  unit: 'за заказ', payType: 'перевод на карту', dateISO: plusDays(3), access: ['домофон'], tools: 'нужен свой инвентарь', ...over
});
async function expectErr(p: Promise<unknown>, text: RegExp) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(AppError); expect((e as Error).message).toMatch(text); return; }
  throw new Error('ожидалась ошибка');
}
async function hiredShift() {
  const j = await jobs.createJob(form(), emp, today);
  await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
  const app = (await jobs.getJob(j.num, emp)).applicantList![0].id;
  await sh.staffAction(j.num, app, 'hire', emp);
  return { num: j.num, app };
}
const claim = { reason: 'оплата не пришла в срок', sum: '6 000', text: 'Работа принята три дня назад, перевода нет' };

let emp: SU, fl: SU, staff: SU;

beforeAll(async () => {
  await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool(), undefined, () => {});
});
beforeEach(async () => {
  await query('TRUNCATE jobs, rate_limits, notification_outbox CASCADE');
  await query('DELETE FROM users');
  emp = await mkUser('employer', 'aigul_t', '9161111111', 'Айгуль Тлеубаева');
  fl = await mkUser('freelancer', 'daniyar_s', '9160000000', 'Данияр Сапаров');
  staff = await mkUser('employer', 'support_1', '9169999999', 'Поддержка', true);
});
afterAll(async () => { await pool().end(); });

describe('споры по расчёту', () => {
  it('открывается после сдачи работы, с доказательствами; второй незакрытый — нельзя', async () => {
    const { num } = await hiredShift();
    await expectErr(dsp.openDispute(num, claim, fl), /после сдачи/);
    await sh.reportDone(num, fl);
    await sh.acceptWork(num, emp);
    await expectErr(dsp.openDispute(num, { ...claim, reason: 'исполнитель требует больше договорённого' }, fl), /что произошло/);
    await expectErr(dsp.openDispute(num, { ...claim, text: 'коротко' }, fl), /Опишите/);
    const d = await dsp.openDispute(num, claim, fl);
    const info = d.shift!.disputes[0];
    expect(info).toMatchObject({ status: 'open', openedBy: 'freelancer', mine: true, sum: 6000, reason: 'оплата не пришла в срок' });
    expect(info.num).toMatch(/^СП-\d+$/);
    expect(info.evidence.map(e => e.label)).toContain('Приёмка работ отмечена работодателем');
    expect(info.evidence.some(e => /Переписка по заказу/.test(e.label))).toBe(true);
    expect(d.shift!.canDispute).toBe(false);
    await expectErr(dsp.openDispute(num, claim, fl), /уже есть незакрытый/);

    const empView = await jobs.getJob(num, emp);
    expect(empView.shift!.disputes[0]).toMatchObject({ mine: false, other: 'Данияр С.' });
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND kind = 'dispute'`, [emp.id]))!.text).toMatch(/Открыт спор/);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM notification_outbox WHERE to_addr = 'support@arena-raboty.ru'`))!.n).toBe(1);
    // Незакрытый спор виден в профиле обеих сторон.
    expect((await prof.getProfile(emp)).marks[0].label).toMatch(/Незакрытый спор/);
    expect((await prof.getProfile(fl)).marks[0].label).toMatch(/Незакрытый спор/);
  });

  it('работодатель отправил оплату — спор закрыт, расчёт отмечен', async () => {
    const { num } = await hiredShift();
    await sh.reportDone(num, fl);
    await sh.acceptWork(num, emp);
    const id = (await dsp.openDispute(num, claim, fl)).shift!.disputes[0].id;
    await expectErr(dsp.actDispute(num, id, { action: 'paid' }, fl), /работодатель/);
    const d = await dsp.actDispute(num, id, { action: 'paid', text: 'Перевёл на карту' }, emp);
    expect(d.shift!.disputes[0]).toMatchObject({ status: 'paid', response: 'Перевёл на карту' });
    expect(d.shift!.settle).toMatchObject({ employer: true });
    expect(d.shift!.canDispute).toBe(true);
    await expectErr(dsp.actDispute(num, id, { action: 'withdraw' }, fl), /закрыт/);
  });

  it('пояснение — на разбор поддержке; решение ставит пометку проигравшей стороне', async () => {
    const { num, app } = await hiredShift();
    await sh.reportDone(num, fl);
    await sh.acceptWork(num, emp);
    const id = (await dsp.openDispute(num, { reason: 'исполнитель требует больше договорённого', sum: 9000, text: 'Договаривались на 6000, просит 9000', target: app }, emp)).shift!.disputes[0].id;
    await expectErr(dsp.actDispute(num, id, { action: 'explain', text: 'Объём оказался вдвое больше' }, emp), /вторая сторона/);
    await dsp.actDispute(num, id, { action: 'explain', text: 'Объём оказался вдвое больше описанного' }, fl);
    const q = await dsp.listDisputes('open');
    expect(q[0]).toMatchObject({ status: 'review', response: 'Объём оказался вдвое больше описанного', jobNum: num });
    await expectErr(dsp.resolveDispute(staff.id, id, { for: 'freelancer', note: '' }), /пару слов/);
    await dsp.resolveDispute(staff.id, id, { for: 'freelancer', note: 'По фото объём больше заявленного' });
    expect(await dsp.listDisputes('open')).toEqual([]);
    expect((await dsp.listDisputes('closed'))[0]).toMatchObject({ status: 'resolved', resolvedFor: 'freelancer' });
    expect((await one<{ user_id: string }>(`SELECT user_id FROM user_marks`))!.user_id).toBe(emp.id);
    const evs = await query<{ user_id: string }>(`SELECT user_id FROM events WHERE text LIKE 'Поддержка решила спор%'`);
    expect(evs.rows.map(e => e.user_id).sort()).toEqual([emp.id, fl.id].sort());
  });

  it('инициатор снимает спор; исполнитель «деньги пришли» — отметка получения', async () => {
    const { num } = await hiredShift();
    await sh.reportDone(num, fl);
    const id = (await dsp.openDispute(num, { ...claim, reason: 'работу не приняли без причины' }, fl)).shift!.disputes[0].id;
    await expectErr(dsp.actDispute(num, id, { action: 'withdraw' }, emp), /открыл/);
    const d = await dsp.actDispute(num, id, { action: 'withdraw' }, fl);
    expect(d.shift!.disputes[0].status).toBe('withdrawn');
    const other = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга К.');
    await expectErr(dsp.actDispute(num, id, { action: 'withdraw' }, other), /только его стороны/);
  });
});
