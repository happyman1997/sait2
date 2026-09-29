// Этап 5: реклама с маркировкой, чек-лист «Перед выходом», экран «Смена».
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const jobs = await import('@/server/jobs');
const sh = await import('@/server/shifts');
const ads = await import('@/server/ads');
const { AppError } = await import('@/server/errors');
const { localISO } = await import('@/lib/jobs');

type U = NonNullable<Parameters<typeof jobs.listJobs>[1]>;
const today = localISO();
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localISO(d); };
const MOSCOW = { lat: 55.7558, lng: 37.6173 };

async function mkUser(role: 'freelancer' | 'employer', login: string, phoneKey: string, name: string): Promise<U> {
  const u = await one<{ id: string }>(
    `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version)
     VALUES ($1, $2, '+7' || $3, $3, 'x@x.ru', 'x', $4, 'Москва', $5, $6, now(), 't') RETURNING id`,
    [role, login, phoneKey, name, MOSCOW.lat, MOSCOW.lng]);
  return { id: u!.id, role, city: 'Москва', base_lat: MOSCOW.lat, base_lng: MOSCOW.lng } as U;
}
const form = (over: Record<string, unknown> = {}) => ({
  ...MOSCOW, address: 'Москва, ул. Тверская, 18', district: 'Москва', type: 'snow', desc: 'Двор 320 м²', crew: '1', pay: '6000',
  unit: 'за заказ', payType: 'перевод на карту', dateISO: plusDays(3), access: ['домофон'], tools: 'нужен свой инвентарь', ...over
});
async function expectErr(p: Promise<unknown>, text: RegExp) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(AppError); expect((e as Error).message).toMatch(text); return; }
  throw new Error('ожидалась ошибка');
}
async function hire(num: number, who: U, emp: U) {
  await jobs.applyToJob(num, { reqConfirmed: true }, who, today);
  const app = (await jobs.getJob(num, emp)).applicantList!.find(a => a.status === 'sent')!.id;
  await sh.staffAction(num, app, 'hire', emp);
}

let emp: U, fl: U, fl2: U;

beforeAll(async () => {
  await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool(), undefined, () => {});
});
beforeEach(async () => {
  await query('TRUNCATE jobs, rate_limits, ads CASCADE');
  await query('DELETE FROM users');
  emp = await mkUser('employer', 'aigul_t', '9161111111', 'Айгуль Тлеубаева');
  fl = await mkUser('freelancer', 'daniyar_s', '9160000000', 'Данияр Сапаров');
  fl2 = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга Кузнецова');
});
afterAll(async () => { await pool().end(); });

describe('реклама', () => {
  const add = (over: Record<string, unknown> = {}) => {
    const d = { placement: 'feed', audience: null, title: 'Спецодежда', url: 'https://example.org/a', erid: 'TEST-1', ends_at: null, active: true, ...over };
    return one<{ id: string }>(
      `INSERT INTO ads (placement, audience, advertiser, title, url, erid, ends_at, active) VALUES ($1, $2, 'ООО Тест', $3, $4, $5, $6, $7) RETURNING id`,
      [d.placement, d.audience, d.title, d.url, d.erid, d.ends_at, d.active]).then(r => r!.id);
  };

  it('подбор по месту, роли и сроку; без erid креатив не сохранить', async () => {
    await add({ title: 'Всем' });
    await add({ title: 'Работодателям', audience: 'employer', erid: 'TEST-2' });
    await add({ title: 'Истёк', erid: 'TEST-3', ends_at: new Date(Date.now() - 1000) });
    await add({ title: 'Выключен', erid: 'TEST-4', active: false });
    await add({ title: 'В профиле', placement: 'profile', erid: 'TEST-5' });
    const forFl = (await ads.pickAds('feed', 'freelancer', 3)).map(a => a.title);
    expect(forFl).toEqual(['Всем']);
    expect((await ads.pickAds('feed', 'employer', 3)).map(a => a.title).sort()).toEqual(['Всем', 'Работодателям']);
    expect((await ads.pickAds('feed', null, 3)).map(a => a.title)).toEqual(['Всем']);
    await expectErr(ads.pickAds('header', null), /места/);
    await expect(add({ erid: '' })).rejects.toThrow();
    await expect(add({ url: 'javascript:alert(1)', erid: 'TEST-9' })).rejects.toThrow();
  });

  it('показы и клики по дням; переход только на адрес рекламодателя с erid', async () => {
    const id = await add();
    await ads.countView([id, id, 'мусор']);
    await ads.countView([id]);
    const url = await ads.clickAd(id);
    expect(url).toBe('https://example.org/a?erid=TEST-1');
    const rep = await ads.adReport(plusDays(-1), plusDays(1));
    expect(rep[0]).toMatchObject({ erid: 'TEST-1', impressions: 2, clicks: 1 });
    await expectErr(ads.clickAd('00000000-0000-0000-0000-000000000000'), /не найдено/);
  });
});

describe('чек-лист и экран «Смена»', () => {
  it('отмечает только нанятый; работодатель видит отметки, чужой — нет', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await expectErr(sh.setSafety(j.num, ['brief'], fl), /нанятый/);
    await hire(j.num, fl, emp);
    const d = await sh.setSafety(j.num, ['brief', 'brief', 'хак'], fl);
    expect(d.shift!.safety).toEqual([{ name: 'Данияр С.', items: ['brief'], me: true }]);
    expect((await jobs.getJob(j.num, emp)).shift!.safety).toEqual([{ name: 'Данияр С.', items: ['brief'], me: false }]);
  });

  it('текущая смена: нанят → раньше отклика; работодателю — сданная раньше идущей', async () => {
    expect(await sh.currentShift(fl)).toBeNull();
    const a = await jobs.createJob(form({ dateISO: plusDays(1), desc: 'А' }), emp, today);
    const b = await jobs.createJob(form({ dateISO: plusDays(5), desc: 'Б' }), emp, today);
    const c = await jobs.createJob(form({ dateISO: plusDays(2), desc: 'В' }), emp, today);
    await jobs.applyToJob(a.num, { reqConfirmed: true }, fl, today);
    expect((await sh.currentShift(fl))!.num).toBe(a.num);
    await hire(b.num, fl, emp);
    expect((await sh.currentShift(fl))!.num).toBe(b.num);
    await hire(c.num, fl2, emp);
    expect((await sh.currentShift(emp))!.num).toBe(c.num);   // раньше по дате
    await query("UPDATE jobs SET date = current_date - 1 WHERE num = $1", [b.num]);
    await sh.reportDone(b.num, fl);
    expect((await sh.currentShift(emp))!.num).toBe(b.num);   // сдана — наверх
    await sh.acceptWork(b.num, emp);
    expect((await sh.currentShift(fl))!.num).toBe(b.num);    // принята, расчёт не отмечен
    await sh.markSettled(b.num, fl);
    expect((await sh.currentShift(fl))!.num).toBe(a.num);    // остался отклик
  });
});
