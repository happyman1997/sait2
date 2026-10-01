// Удаление аккаунта: личные данные стираются, записи второй стороны остаются за «Удалённым пользователем».
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const jobs = await import('@/server/jobs');
const sh = await import('@/server/shifts');
const { deleteAccount } = await import('@/server/account');
const { hashPassword } = await import('@/server/password');
const { sessionUser, createSession } = await import('@/server/session');
const { AppError } = await import('@/server/errors');
const { localClock } = await import('@/server/events');

type SU = NonNullable<Awaited<ReturnType<typeof sessionUser>>>;
const today = localClock().day;
const plus = (n: number) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const MOSCOW = { lat: 55.7558, lng: 37.6173 };

async function mkUser(role: 'freelancer' | 'employer', login: string, phoneKey: string, name: string): Promise<SU & { token: string }> {
  const u = await one<{ id: string }>(
    `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version)
     VALUES ($1, $2, '+7' || $3, $3, $2 || '@x.ru', $4, $5, 'Москва', $6, $7, now(), 't') RETURNING id`,
    [role, login, phoneKey, await hashPassword('secret12'), name, MOSCOW.lat, MOSCOW.lng]);
  await query('INSERT INTO notification_settings (user_id) VALUES ($1)', [u!.id]);
  const { token } = await createSession(u!.id, {});
  return { ...(await sessionUser(token))!, token };
}
const form = (over: Record<string, unknown> = {}) => ({
  ...MOSCOW, address: 'Москва, ул. Тверская, 18', district: 'Москва', type: 'snow', desc: 'Двор 320 м²', crew: '1', pay: '3000',
  unit: 'за смену', payType: 'перевод на карту', dateISO: plus(2), access: ['домофон'], tools: 'нужен свой инвентарь', ...over
});
async function expectErr(p: Promise<unknown>, text: RegExp, status?: number) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(AppError); expect((e as Error).message).toMatch(text);
    if (status) expect((e as InstanceType<typeof AppError>).status).toBe(status);
    return;
  }
  throw new Error('ожидалась ошибка');
}
const ok = { password: 'secret12', confirm: 'удалить' };

let emp: Awaited<ReturnType<typeof mkUser>>, fl: Awaited<ReturnType<typeof mkUser>>;
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

describe('удаление аккаунта', () => {
  it('нужны пароль и слово-подтверждение; при идущей смене — нельзя, с объяснением', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    await expectErr(deleteAccount(fl, { password: 'secret12', confirm: 'да' }), /УДАЛИТЬ/, 422);
    await expectErr(deleteAccount(fl, { password: 'wrong-pass', confirm: 'УДАЛИТЬ' }), /Пароль неверный/, 401);
    await sh.staffAction(j.num, (await jobs.getJob(j.num, emp)).applicantList![0].id, 'hire', emp);
    await expectErr(deleteAccount(fl, ok), /Вы в смене: № .*Откажитесь/, 409);
    await expectErr(deleteAccount(emp, ok), /нанятыми исполнителями/, 409);
  });

  it('исполнитель: данные стёрты, вход закрыт, отклики отозваны, отзыв остаётся за «Удалённым пользователем», номер свободен', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    await query(`INSERT INTO reviews (job_id, author_id, target_id, rating, text, editable_until) SELECT id, $1, $2, 5, 'Хороший заказчик', now() FROM jobs`, [fl.id, emp.id]);
    await deleteAccount(fl, ok);
    const u = (await one<Record<string, unknown>>('SELECT * FROM users WHERE id = $1', [fl.id]))!;
    expect(u).toMatchObject({ name: 'Удалённый пользователь', phone: '', email: '', city: '', status: 'deleted', base_lat: null, avatar_url: null });
    expect(u.login).toMatch(/^del_/);
    expect(u.deleted_at).not.toBeNull();
    expect(await sessionUser(fl.token)).toBeNull();
    expect((await one<{ status: string }>('SELECT status FROM applications WHERE freelancer_id = $1', [fl.id]))!.status).toBe('withdrawn');
    for (const t of ['sessions', 'events', 'notification_settings', 'freelancer_profiles']) {
      expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`, [fl.id]))!.n, t).toBe(0);
    }
    expect((await one<{ name: string }>('SELECT a.name FROM reviews r JOIN users a ON a.id = r.author_id'))!.name).toBe('Удалённый пользователь');
    // Тот же номер и логин можно зарегистрировать заново.
    await mkUser('freelancer', 'daniyar_s', '9160000000', 'Данияр Сапаров');
    await expectErr(deleteAccount(fl, ok), /не найден|войти/);
  });

  it('работодатель: открытые заказы без нанятых снимаются и уходят из поиска, объекты удаляются', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await query(`INSERT INTO objects (employer_id, name, address, lat, lng) VALUES ($1, 'Двор', 'Москва, Тверская, 18', 55.7, 37.6)`, [emp.id]);
    expect((await jobs.listJobs({ today }, null)).jobs.map(x => x.num)).toContain(j.num);
    await deleteAccount(emp, ok);
    expect((await one<{ status: string }>('SELECT status FROM jobs WHERE num = $1', [j.num]))!.status).toBe('cancelled');
    expect((await jobs.listJobs({ today }, null)).jobs.map(x => x.num)).not.toContain(j.num);
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM objects'))!.n).toBe(0);
  });
});
