// Интеграционные тесты заказов на настоящем Postgres: публикация, поиск по радиусу и фильтрам, отклик, отмена.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const jobs = await import('@/server/jobs');
const { AppError } = await import('@/server/errors');
const { localISO } = await import('@/lib/jobs');

type Viewer = Parameters<typeof jobs.listJobs>[1];

const today = localISO();
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localISO(d); };

// Москва (база), Химки (~20 км), Санкт-Петербург (~630 км)
const MOSCOW = { lat: 55.7558, lng: 37.6173 };
const KHIMKI = { lat: 55.8887, lng: 37.4304 };
const SPB = { lat: 59.9386, lng: 30.3141 };

let emp: NonNullable<Viewer>, emp2: NonNullable<Viewer>, fl: NonNullable<Viewer>, fl2: NonNullable<Viewer>;

async function mkUser(role: 'freelancer' | 'employer', login: string, phoneKey: string, name: string): Promise<NonNullable<Viewer>> {
  const u = await one<{ id: string }>(
    `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version)
     VALUES ($1, $2, '+7' || $3, $3, 'x@x.ru', 'x', $4, 'Москва', $5, $6, now(), 't') RETURNING id`,
    [role, login, phoneKey, name, MOSCOW.lat, MOSCOW.lng]
  );
  if (role === 'employer') await query(`INSERT INTO employer_profiles (user_id, org_type, org_name) VALUES ($1, 'УК / ТСЖ', 'УК «Тверская»')`, [u!.id]);
  else await query(`INSERT INTO freelancer_profiles (user_id, gear) VALUES ($1, '{Триммер}')`, [u!.id]);
  return { id: u!.id, role, city: 'Москва', base_lat: MOSCOW.lat, base_lng: MOSCOW.lng };
}

const form = (over: Record<string, unknown> = {}) => ({
  ...MOSCOW, address: 'Москва, ул. Тверская, 18', district: 'Москва', type: 'snow', typeOther: '', desc: 'Двор 320 м², вывоз не нужен',
  volume: '4–5 часов', crew: '1', req: '', pay: '6 000', unit: 'за заказ', payType: 'перевод на карту', dateISO: plusDays(5),
  urgent: false, regular: false, repeat: '', repeatNote: '', access: ['домофон 12'], tools: 'нужен свой инвентарь',
  meetName: 'Марат', meetPhone: '+7 900 000-00-00', ...over
});

async function expectErr(p: Promise<unknown>, field: string | undefined, text?: RegExp) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as InstanceType<typeof AppError>).field).toBe(field);
    if (text) expect((e as Error).message).toMatch(text);
    return e as InstanceType<typeof AppError>;
  }
  throw new Error('ожидалась ошибка');
}

beforeAll(async () => {
  await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool(), undefined, () => {});
});

beforeEach(async () => {
  // TRUNCATE users CASCADE стёр бы и справочник типов (created_by → users), поэтому пользователей удаляем DELETE.
  await query('TRUNCATE jobs, rate_limits CASCADE');
  await query('DELETE FROM job_types WHERE is_custom');
  await query('DELETE FROM users');
  emp = await mkUser('employer', 'aigul_t', '9161111111', 'Айгуль Тлеубаева');
  emp2 = await mkUser('employer', 'other_emp', '9162222222', 'Пётр Иванов');
  fl = await mkUser('freelancer', 'daniyar_s', '9160000000', 'Данияр Сапаров');
  fl2 = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга Кузнецова');
});

afterAll(async () => { await pool().end(); });

describe('публикация', () => {
  it('создаёт заказ с номером, автозаголовком и срочностью по дате', async () => {
    const j = await jobs.createJob(form({ dateISO: plusDays(1) }), emp, today);
    expect(j.num).toBeGreaterThan(0);
    expect(j.title).toBe('Уборка снега — ул. Тверская, 18');
    expect(j.pay).toBe(6000);
    expect(j.urgent).toBe(true);
    expect(j.mine).toBe(true);
    expect(j.meetPhone).toBe('+7 900 000-00-00');         // владелец видит телефон
    expect(j.employer.name).toBe('УК «Тверская»');
    const later = await jobs.createJob(form(), emp, today);
    expect(later.urgent).toBe(false);
    expect(later.num).toBe(j.num + 1);
  });

  it('только работодатель', async () => {
    await expectErr(jobs.createJob(form(), fl, today), undefined, /только работодатель/);
    await expectErr(jobs.createJob(form(), null, today), undefined, /войти/);
  });

  it('проверки по шагам — ошибка у первого по порядку поля, все поля в extra', async () => {
    const e = await expectErr(jobs.createJob(form({ address: '', desc: '', pay: '', access: [] }), emp, today), 'address', /Укажите адрес/);
    expect(Object.keys(e.extra!.fields as object).sort()).toEqual(['access', 'address', 'desc', 'pay']);
    expect(e.extra!.step).toBe(1);
    await expectErr(jobs.createJob(form({ lat: null }), emp, today), 'address', /метку/);
    await expectErr(jobs.createJob(form({ type: '', typeOther: '' }), emp, today), 'type', /тип работы/);
    await expectErr(jobs.createJob(form({ dateISO: plusDays(-2) }), emp, today), 'date', /прошла/);
    await expectErr(jobs.createJob(form({ regular: true, repeat: '' }), emp, today), 'repeat', /график/);
    await expectErr(jobs.createJob(form({ tools: '' }), emp, today), 'tools');
    await expectErr(jobs.createJob(form({ crew: '40' }), emp, today), 'crew');
    await expectErr(jobs.createJob(form({ unit: 'за всё' }), emp, today), 'unit');
  });

  it('модерация текста заказа на сервере', async () => {
    const e = await expectErr(jobs.createJob(form({ desc: 'Оплата вперёд, потом выход' }), emp, today), 'desc');
    expect(e.extra).toMatchObject({ moderation: { label: 'Что нужно сделать', category: 'признак мошенничества' } });
    await expectErr(jobs.createJob(form({ access: ['домофон', 'спросить у суки'] }), emp, today), 'access');
  });

  it('свой тип работы попадает в справочник и в фильтр только после публикации', async () => {
    expect((await jobs.jobTypes(today)).some(t => t.custom)).toBe(false);
    const j = await jobs.createJob(form({ type: '', typeOther: 'мойка брусчатки' }), emp, today);
    expect(j.typeLabel).toBe('Мойка брусчатки');
    const types = await jobs.jobTypes(today);
    const own = types.find(t => t.custom)!;
    expect(own).toMatchObject({ label: 'Мойка брусчатки', count: 1 });
    // тот же тип в другом регистре не плодит дубль
    const j2 = await jobs.createJob(form({ type: '', typeOther: 'Мойка БРУСЧАТКИ' }), emp, today);
    expect(j2.typeId).toBe(own.id);
  });
});

describe('поиск', () => {
  beforeEach(async () => {
    await jobs.createJob(form({ pay: '6000', dateISO: plusDays(0) }), emp, today);                                           // Москва, снег, сегодня
    await jobs.createJob(form({ ...KHIMKI, address: 'Химки, Ленинградская, 29', type: 'load', pay: '1200', unit: 'за час' }), emp, today);
    await jobs.createJob(form({ ...SPB, address: 'Санкт-Петербург, Лиговский пр-т, 5', type: 'grass', pay: '12000' }), emp2, today);
  });

  it('все открытые, ближайшие считают расстояние от базы', async () => {
    const r = await jobs.listJobs({ today }, fl);
    expect(r.jobs).toHaveLength(3);
    expect(r.base).toMatchObject({ label: 'Москва' });
    const khimki = r.jobs.find(j => j.typeId === 'load')!;
    expect(khimki.distanceKm).toBeGreaterThan(15);
    expect(khimki.distanceKm).toBeLessThan(25);
  });

  it('радиус от базы, тип, оплата от, сегодня-завтра, текст', async () => {
    expect((await jobs.listJobs({ today, km: 10 }, fl)).jobs.map(j => j.typeId)).toEqual(['snow']);
    expect((await jobs.listJobs({ today, km: 50 }, fl)).jobs).toHaveLength(2);
    expect((await jobs.listJobs({ today, types: ['grass', 'load'] }, fl)).jobs).toHaveLength(2);
    expect((await jobs.listJobs({ today, minPay: 5000 }, fl)).jobs).toHaveLength(2);
    expect((await jobs.listJobs({ today, when: 'soon' }, fl)).jobs.map(j => j.typeId)).toEqual(['snow']);
    expect((await jobs.listJobs({ today, q: 'лиговский' }, fl)).jobs.map(j => j.typeId)).toEqual(['grass']);
    expect((await jobs.listJobs({ today, q: 'погрузка' }, fl)).jobs.map(j => j.typeId)).toEqual(['load']);
    expect((await jobs.listJobs({ today, q: '100%_' }, fl)).jobs).toHaveLength(0); // спецсимволы LIKE экранируются
  });

  it('гость ищет от Москвы или от переданной точки', async () => {
    expect((await jobs.listJobs({ today, km: 10 }, null)).jobs).toHaveLength(1);
    expect((await jobs.listJobs({ today, km: 10, ...SPB }, null)).jobs.map(j => j.typeId)).toEqual(['grass']);
  });

  it('поиск с матом отклоняется', async () => {
    await expectErr(jobs.listJobs({ today, q: 'сука' }, fl), 'q');
  });

  it('вошедшим — общая выдача из кэша, но свой статус отклика и «мой заказ» всегда свежие', async () => {
    const first = (await jobs.listJobs({ today }, fl)).jobs;
    const snow = first.find(j => j.typeId === 'snow')!;
    expect(snow.myStatus).toBeNull();
    await jobs.applyToJob(snow.num, { reqConfirmed: true }, fl, today);
    const again = (await jobs.listJobs({ today }, fl)).jobs;
    expect(again.find(j => j.num === snow.num)!.myStatus).toBe('sent');
    const forEmp = (await jobs.listJobs({ today }, emp)).jobs;
    expect(forEmp.find(j => j.num === snow.num)!).toMatchObject({ mine: true, myStatus: null });
    expect((await jobs.listJobs({ today }, null)).jobs.every(j => !j.mine && j.myStatus === null)).toBe(true);
  });

  it('отменённые и прошедшие не показываются', async () => {
    const all = (await jobs.listJobs({ today }, fl)).jobs;
    await jobs.cancelJob(all.find(j => j.typeId === 'grass')!.num, { reason: 'погода изменилась', notice: 'больше суток' }, emp2);
    await query(`UPDATE jobs SET date = current_date - 3 WHERE type_id = 'load'`);
    jobs.invalidateSearch();   // прямой SQL в обход приложения — кэш выдачи о нём не знает
    expect((await jobs.listJobs({ today }, fl)).jobs.map(j => j.typeId)).toEqual(['snow']);
    // серия с прошедшей первой датой остаётся в поиске
    await query(`UPDATE jobs SET repeat = 'график 2/2' WHERE type_id = 'load'`);
    jobs.invalidateSearch();
    expect((await jobs.listJobs({ today }, fl)).jobs).toHaveLength(2);
  });
});

describe('карточка и отклик', () => {
  it('телефон встречающего — только владельцу и нанятому', async () => {
    const j = await jobs.createJob(form(), emp, today);
    expect((await jobs.getJob(j.num, fl)).meetPhone).toBeNull();
    expect((await jobs.getJob(j.num, null)).meetPhone).toBeNull();
    expect((await jobs.getJob(j.num, emp2)).meetPhone).toBeNull();
    expect((await jobs.getJob(j.num, fl)).meetName).toBe('Марат');
    await jobs.applyToJob(j.num, {}, fl, today);
    const [{ id }] = (await query<{ id: string }>('SELECT id FROM jobs WHERE num = $1', [j.num])).rows;
    await query(`INSERT INTO hires (job_id, freelancer_id) VALUES ($1, $2)`, [id, fl.id]);
    await query(`UPDATE applications SET status = 'hired' WHERE freelancer_id = $1`, [fl.id]);
    expect((await jobs.getJob(j.num, fl)).meetPhone).toBe('+7 900 000-00-00');
  });

  it('отклик: работодателю нельзя, повторно нельзя, отзыв и повторный отклик можно', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await expectErr(jobs.applyToJob(j.num, {}, emp2, today), undefined, /только исполнитель/);
    await expectErr(jobs.applyToJob(j.num, {}, null, today), undefined, /профиль исполнителя/);
    const d = await jobs.applyToJob(j.num, {}, fl, today);
    expect(d.myStatus).toBe('sent');
    expect(d.applicants).toBe(1);
    await expectErr(jobs.applyToJob(j.num, {}, fl, today), undefined, /уже отправлен/);

    const owner = await jobs.getJob(j.num, emp);
    expect(owner.applicantList).toEqual([expect.objectContaining({ name: 'Данияр С.', status: 'sent', gear: 'Триммер' })]);
    expect((await jobs.getJob(j.num, fl)).applicantList).toBeNull();

    const w = await jobs.withdrawApplication(j.num, fl);
    expect(w.myStatus).toBe('withdrawn');
    expect(w.applicants).toBe(0);
    await expectErr(jobs.withdrawApplication(j.num, fl), undefined, /Отклика .* нет/);
    expect((await jobs.applyToJob(j.num, {}, fl, today)).myStatus).toBe('sent');

    const ev = await query<{ text: string }>('SELECT text FROM events WHERE user_id = $1 ORDER BY created_at', [emp.id]);
    expect(ev.rows.map(r => r.text).filter(t => /отклик/i.test(t))).toHaveLength(3);
  });

  it('своё условие нужно подтвердить', async () => {
    const j = await jobs.createJob(form({ req: 'нужна санкнижка' }), emp, today);
    await expectErr(jobs.applyToJob(j.num, {}, fl, today), 'req', /санкнижка/);
    expect((await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today)).myStatus).toBe('sent');
  });

  it('набранная смена, отменённый и прошедший заказ не принимают отклики', async () => {
    const j = await jobs.createJob(form({ crew: '1' }), emp, today);
    const [{ id }] = (await query<{ id: string }>('SELECT id FROM jobs WHERE num = $1', [j.num])).rows;
    await query('INSERT INTO hires (job_id, freelancer_id) VALUES ($1, $2)', [id, fl2.id]);
    await expectErr(jobs.applyToJob(j.num, {}, fl, today), undefined, /набрана/);

    const any = await jobs.createJob(form({ crew: '99' }), emp, today);   // «сколько угодно»
    const [{ id: id2 }] = (await query<{ id: string }>('SELECT id FROM jobs WHERE num = $1', [any.num])).rows;
    await query('INSERT INTO hires (job_id, freelancer_id) VALUES ($1, $2)', [id2, fl2.id]);
    expect((await jobs.applyToJob(any.num, {}, fl, today)).myStatus).toBe('sent');

    const c = await jobs.createJob(form(), emp, today);
    await jobs.cancelJob(c.num, { reason: 'ошибка в заказе', notice: 'больше суток' }, emp);
    await expectErr(jobs.applyToJob(c.num, {}, fl, today), undefined, /отменён/);

    const past = await jobs.createJob(form(), emp, today);
    await query(`UPDATE jobs SET date = current_date - 2 WHERE num = $1`, [past.num]);
    await expectErr(jobs.applyToJob(past.num, {}, fl, today), undefined, /прошла/);
  });
});

describe('правка и отмена', () => {
  it('правка до найма уведомляет откликнувшихся; после найма — нельзя', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await jobs.applyToJob(j.num, {}, fl, today);
    const upd = await jobs.updateJob(j.num, form({ pay: '7500' }), emp, today);
    expect(upd.pay).toBe(7500);
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM events WHERE user_id = $1 AND text LIKE 'Условия заказа%'`, [fl.id]))!.n).toBe(1);
    await expectErr(jobs.updateJob(j.num, form(), emp2, today), undefined, /другого работодателя/);
    const [{ id }] = (await query<{ id: string }>('SELECT id FROM jobs WHERE num = $1', [j.num])).rows;
    await query('INSERT INTO hires (job_id, freelancer_id) VALUES ($1, $2)', [id, fl.id]);
    await expectErr(jobs.updateJob(j.num, form(), emp, today), undefined, /уже нанят/);
  });

  it('отмена: причина обязательна, отклики закрываются, поздняя отмена при найме — пометка', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await jobs.applyToJob(j.num, {}, fl, today);
    await jobs.applyToJob(j.num, {}, fl2, today);
    const [{ id }] = (await query<{ id: string }>('SELECT id FROM jobs WHERE num = $1', [j.num])).rows;
    await query('INSERT INTO hires (job_id, freelancer_id) VALUES ($1, $2)', [id, fl2.id]);
    await query(`UPDATE applications SET status = 'hired' WHERE freelancer_id = $1`, [fl2.id]);

    await expectErr(jobs.cancelJob(j.num, { notice: 'меньше суток' }, emp), 'reason');
    await expectErr(jobs.cancelJob(j.num, { reason: 'погода', notice: 'через час' }, emp), 'notice');
    await expectErr(jobs.cancelJob(j.num, { reason: 'погода', notice: 'меньше суток' }, emp2), undefined, /другого/);
    const c = await jobs.cancelJob(j.num, { reason: 'погода изменилась', notice: 'меньше суток' }, emp);
    expect(c.status).toBe('cancelled');
    expect(c.cancellation).toMatchObject({ reason: 'погода изменилась', late: true });
    expect((await one<{ status: string }>('SELECT status FROM applications WHERE freelancer_id = $1', [fl.id]))!.status).toBe('rejected');
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM user_marks WHERE user_id = $1 AND kind = 'late_cancel'`, [emp.id]))!.n).toBe(1);
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM events WHERE kind = 'cancel'`))!.n).toBe(2);
    await expectErr(jobs.cancelJob(j.num, { reason: 'x', notice: 'больше суток' }, emp), undefined, /уже отменён/);
  });

  it('принятую работу отменить нельзя', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await query(`UPDATE jobs SET status = 'accepted' WHERE num = $1`, [j.num]);
    await expectErr(jobs.cancelJob(j.num, { reason: 'x', notice: 'больше суток' }, emp), undefined, /напишите в чат/);
  });
});

describe('clientToday', () => {
  it('принимает дату клиента в пределах суток, иначе серверную', () => {
    const server = new Date().toISOString().slice(0, 10);
    expect(jobs.clientToday(today)).toBe(today);
    expect(jobs.clientToday('2001-01-01')).toBe(server);
    expect(jobs.clientToday('мусор')).toBe(server);
  });
});
