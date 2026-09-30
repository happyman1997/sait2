// Этап 7: кабинет поддержки — жалобы, блокировка, журнал действий.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const jobs = await import('@/server/jobs');
const sh = await import('@/server/shifts');
const sup = await import('@/server/support');
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
async function expectErr(p: Promise<unknown>, text: RegExp, status?: number) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(AppError); expect((e as Error).message).toMatch(text);
    if (status) expect((e as InstanceType<typeof AppError>).status).toBe(status);
    return;
  }
  throw new Error('ожидалась ошибка');
}
/** Смена от отклика до приёмки. */
async function acceptedShift() {
  const j = await jobs.createJob(form(), emp, today);
  await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
  const app = (await jobs.getJob(j.num, emp)).applicantList![0].id;
  await sh.staffAction(j.num, app, 'hire', emp);
  await query("UPDATE jobs SET date = LEAST(date, current_date - 1)");
  await sh.reportDone(j.num, fl);
  await sh.acceptWork(j.num, emp);
  return j.num;
}

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

describe('доступ', () => {
  it('раздел виден только сотрудникам — остальным 404', async () => {
    await expectErr(sup.listComplaints(fl, 'open'), /не найдена/, 404);
    await expectErr(sup.findUsers(null, 'da'), /войти/, 401);
    expect(await sup.isStaff(staff)).toBe(true);
    expect(await sup.isStaff(emp)).toBe(false);
  });
});

describe('жалобы', () => {
  it('жалоба исполнителя без адресата — на работодателя; подтверждение ставит пометку и уведомляет обе стороны', async () => {
    const num = await acceptedShift();
    await sh.fileComplaint(num, { reason: 'не рассчитались', text: 'Обещали перевод, прошла неделя' }, fl);
    const list = await sup.listComplaints(staff, 'open');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: 'не рассчитались', num, author: { login: 'daniyar_s' }, target: { login: 'aigul_t', marks: 0 } });
    await expectErr(sup.resolveComplaint(staff, list[0].id, { decision: 'confirmed', note: '' }), /пару слов/);
    await sup.resolveComplaint(staff, list[0].id, { decision: 'confirmed', note: 'Работодатель не ответил на запрос поддержки' });
    await expectErr(sup.resolveComplaint(staff, list[0].id, { decision: 'rejected', note: 'повторно' }), /уже есть решение/);
    expect(await sup.listComplaints(staff, 'open')).toEqual([]);
    expect((await sup.listComplaints(staff, 'confirmed'))[0]).toMatchObject({ status: 'confirmed', target: { marks: 1 } });
    const mark = await one<{ kind: string }>(`SELECT kind FROM user_marks WHERE user_id = $1`, [emp.id]);
    expect(mark!.kind).toBe('complaint');
    const evs = await query<{ user_id: string; text: string }>(`SELECT user_id, text FROM events WHERE kind = 'complaint' AND text LIKE '%подтвер%'`);
    expect(evs.rows.map(e => e.user_id).sort()).toEqual([emp.id, fl.id].sort());
    const log = await one<{ action: string }>('SELECT action FROM staff_actions');
    expect(log!.action).toBe('complaint_confirmed');
  });

  it('отклонение — без пометки, автор узнаёт решение', async () => {
    const num = await acceptedShift();
    await sh.fileComplaint(num, { reason: 'грубое общение', text: 'Кричал при сдаче работы' }, fl);
    const [c] = await sup.listComplaints(staff, 'open');
    await sup.resolveComplaint(staff, c.id, { decision: 'rejected', note: 'В переписке грубости нет' });
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM user_marks'))!.n).toBe(0);
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND kind = 'complaint' ORDER BY created_at DESC LIMIT 1`, [fl.id]))!.text).toMatch(/отклонена/);
  });
});

describe('пользователи и блокировка', () => {
  it('поиск по логину, имени и телефону', async () => {
    expect((await sup.findUsers(staff, 'aigul')).map(u => u.login)).toEqual(['aigul_t']);
    expect((await sup.findUsers(staff, 'Сапаров')).map(u => u.login)).toEqual(['daniyar_s']);
    expect((await sup.findUsers(staff, '+7 916 000-00-00')).map(u => u.login)).toEqual(['daniyar_s']);
    expect(await sup.findUsers(staff, 'a')).toEqual([]);
  });

  it('блокировка работодателя: вход закрыт, открытые заказы сняты, откликнувшиеся предупреждены; разблокировка', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    const token = (await createSession(emp.id, {})).token;
    await expectErr(sup.setBlocked(staff, emp.id, { blocked: true, note: '' }), /причину/);
    const r = await sup.setBlocked(staff, emp.id, { blocked: true, note: 'Мошенничество с оплатой' });
    expect(r).toEqual({ ok: true, cancelled: 1 });
    expect(await sessionUser(token)).toBeNull();
    expect((await jobs.getJob(j.num, fl)).status).toBe('cancelled');
    expect((await one<{ text: string }>(`SELECT text FROM events WHERE user_id = $1 AND kind = 'cancel'`, [fl.id]))!.text).toMatch(/снят площадкой/);
    expect((await jobs.listJobs({ today }, fl)).jobs.find(x => x.num === j.num)).toBeUndefined();
    await expectErr(sup.setBlocked(staff, emp.id, { blocked: true, note: 'ещё раз' }), /Уже/);
    await sup.setBlocked(staff, emp.id, { blocked: false, note: 'Разобрались, вернули доступ' });
    expect((await one<{ status: string }>('SELECT status FROM users WHERE id = $1', [emp.id]))!.status).toBe('active');
    const [u] = await sup.findUsers(staff, 'aigul');
    expect(u.actions.map(a => a.action)).toEqual(['unblock', 'block']);
  });

  it('блокировка исполнителя снимает ожидающие отклики; себя и сотрудника не заблокировать', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    await sup.setBlocked(staff, fl.id, { blocked: true, note: 'Фейковый аккаунт' });
    expect((await jobs.getJob(j.num, emp)).applicantList).toEqual([]);
    await expectErr(sup.setBlocked(staff, staff.id, { blocked: true, note: 'проверка' }), /Себя/);
  });
});

describe('работа поддержки: срок, назначение, шаблоны', () => {
  it('срок ответа — 3 рабочих дня (выходные не считаются)', () => {
    // пятница 12:00 МСК → среда 12:00 МСК
    expect(sup.slaDeadline(new Date('2026-10-02T09:00:00Z')).toISOString()).toBe('2026-10-07T09:00:00.000Z');
    // понедельник → четверг
    expect(sup.slaDeadline(new Date('2026-10-05T09:00:00Z')).toISOString()).toBe('2026-10-08T09:00:00.000Z');
  });

  it('«взять себе», фильтр «мои», просрочка; назначить можно только сотрудника', async () => {
    const num = await acceptedShift();
    await sh.fileComplaint(num, { reason: 'не рассчитались', text: 'Перевод так и не пришёл' }, fl);
    const [c] = await sup.listComplaints(staff, 'open');
    expect(c.assignee).toBeNull();
    expect(c.overdue).toBe(false);
    await sup.assign(staff, 'complaint', c.id, {});
    expect((await sup.listComplaints(staff, 'open', true))[0].assignee).toMatchObject({ id: staff.id, name: 'Поддержка' });
    await expectErr(sup.assign(staff, 'complaint', c.id, { to: fl.id }), /сотрудника/);
    await query(`UPDATE complaints SET created_at = now() - interval '8 days'`);
    expect((await sup.listComplaints(staff, 'open'))[0].overdue).toBe(true);
    await sup.assign(staff, 'complaint', c.id, { to: null });
    expect(await sup.listComplaints(staff, 'open', true)).toEqual([]);
    await expectErr(sup.assign(staff, 'ticket', c.id, {}), /не найдена/);
  });

  it('напоминания о сроке: за сутки и после срока — по разу; назначенное — только своему сотруднику', async () => {
    const other = await mkUser('employer', 'support_2', '9168888888', 'Вторая Поддержка', true);
    await query('UPDATE users SET email_verified_at = now() WHERE id = $1', [staff.id]);
    await query('UPDATE notification_settings SET email = true WHERE user_id = $1', [staff.id]);
    const num = await acceptedShift();
    await sh.fileComplaint(num, { reason: 'не рассчитались', text: 'Перевод так и не пришёл' }, fl);
    const [c] = await sup.listComplaints(staff, 'open');
    const deadline = Date.parse(c.deadline);
    const events = (id: string) => query<{ text: string; urgent: boolean }>(`SELECT text, urgent FROM events WHERE user_id = $1 AND kind = 'support' ORDER BY created_at`, [id]).then(r => r.rows);

    expect(await sup.remindSla(new Date())).toBe(0);
    expect(await sup.remindSla(new Date(deadline - 12 * 3600_000))).toBe(1);
    expect(await sup.remindSla(new Date(deadline - 11 * 3600_000))).toBe(0);
    for (const id of [staff.id, other.id]) {
      expect(await events(id)).toEqual([{ text: expect.stringMatching(/истекает в течение суток: жалоба по заказу № \d+/), urgent: false }]);
    }
    // Письмо ведёт в кабинет поддержки, а не в карточку заказа.
    expect((await one<{ body: string }>(`SELECT body FROM notification_outbox WHERE user_id = $1 AND channel = 'email'`, [staff.id]))!.body).toMatch(/\/support\n/);

    expect(await sup.remindSla(new Date(deadline + 3600_000))).toBe(1);
    expect((await events(staff.id)).at(-1)).toEqual({ text: expect.stringMatching(/^Срок ответа прошёл/), urgent: true });

    // Передали другому — он получает своё напоминание, первый — нет.
    await sup.assign(staff, 'complaint', c.id, { to: other.id });
    expect(await sup.remindSla(new Date(deadline + 2 * 3600_000))).toBe(1);
    expect(await events(other.id)).toHaveLength(3);
    expect(await events(staff.id)).toHaveLength(2);
    // Решённое больше не напоминает.
    await sup.resolveComplaint(other, c.id, { decision: 'rejected', note: 'Перевод подтверждён выпиской' });
    await query('UPDATE complaints SET sla_stage = 0');
    expect(await sup.remindSla(new Date(deadline + 3 * 3600_000))).toBe(0);
  });

  it('шаблоны ответов: создать, изменить, удалить', async () => {
    const t = await sup.saveTemplate(staff, { kind: 'complaint', title: 'Нет доказательств', body: 'Проверили переписку и фото — подтверждений нет.' });
    await sup.saveTemplate(staff, { title: 'Общий', body: 'Спасибо за обращение.' });
    expect((await sup.listTemplates(staff)).map(x => x.kind)).toEqual(['any', 'complaint']);
    expect((await sup.saveTemplate(staff, { kind: 'complaint', title: 'Нет доказательств', body: 'Новый текст шаблона' }, t.id)).body).toBe('Новый текст шаблона');
    await expectErr(sup.saveTemplate(staff, { title: '', body: 'x' }), /Назовите/);
    await sup.deleteTemplate(staff, t.id);
    expect(await sup.listTemplates(staff)).toHaveLength(1);
    await expectErr(sup.listTemplates(fl), /не найдена/);
  });
});

