// Этап 6: объекты работодателя, подтверждение e-mail, статус самозанятого (НПД), веб-пуш.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const jobs = await import('@/server/jobs');
const sh = await import('@/server/shifts');
const objects = await import('@/server/objects');
const verify = await import('@/server/verify');
const push = await import('@/server/push');
const ev = await import('@/server/events');
const prof = await import('@/server/profile');
const { setMailer } = await import('@/server/mail');
const { setCodeSender } = await import('@/server/sms');
const { sessionUser, createSession } = await import('@/server/session');
const { AppError } = await import('@/server/errors');
const { localISO } = await import('@/lib/jobs');

type SU = NonNullable<Awaited<ReturnType<typeof sessionUser>>>;
const today = localISO();
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localISO(d); };
const MOSCOW = { lat: 55.7558, lng: 37.6173 };

const mails: { to: string; subject: string; text: string }[] = [];
setMailer({ async send(to, subject, text) { mails.push({ to, subject, text }); } });
setCodeSender({ async send() { return { code: '1234' }; }, async sendText() {} });

async function mkUser(role: 'freelancer' | 'employer', login: string, phoneKey: string, name: string): Promise<SU> {
  const u = await one<{ id: string }>(
    `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version)
     VALUES ($1, $2, '+7' || $3, $3, $2 || '@x.ru', 'x', $4, 'Москва', $5, $6, now(), 't') RETURNING id`,
    [role, login, phoneKey, name, MOSCOW.lat, MOSCOW.lng]);
  await query('INSERT INTO notification_settings (user_id, quiet_on) VALUES ($1, false)', [u!.id]);
  if (role === 'freelancer') await query(`INSERT INTO freelancer_profiles (user_id, skills, work_cities) VALUES ($1, '{snow}', '{Москва}')`, [u!.id]);
  else await query(`INSERT INTO employer_profiles (user_id) VALUES ($1)`, [u!.id]);
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
/** ИНН физлица с правильными контрольными цифрами. */
function makeInn(base10: string) {
  const d = base10.split('').map(Number);
  const k = (w: number[]) => (w.reduce((s, x, i) => s + x * d[i], 0) % 11) % 10;
  d.push(k([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]));
  d.push(k([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]));
  return d.join('');
}

let emp: SU, fl: SU;

beforeAll(async () => {
  await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool(), undefined, () => {});
});
beforeEach(async () => {
  await query('TRUNCATE jobs, rate_limits, notification_outbox CASCADE');
  await query('DELETE FROM users');
  mails.length = 0;
  emp = await mkUser('employer', 'aigul_t', '9161111111', 'Айгуль Тлеубаева');
  fl = await mkUser('freelancer', 'daniyar_s', '9160000000', 'Данияр Сапаров');
});
afterAll(async () => { await pool().end(); });

describe('объекты работодателя', () => {
  it('создать, изменить, заказ с объекта попадает в историю; чужой объект не привязать', async () => {
    const o = await objects.saveObject(emp, { name: 'Двор на Гиляровского', address: 'ул. Гиляровского, 24', ...MOSCOW, area: '320 м²', contact: 'консьерж', access: ['домофон', 'хак'], tools: 'инвентарь есть на объекте' });
    expect(o).toMatchObject({ name: 'Двор на Гиляровского', access: ['домофон'], shifts: 0 });
    const o2 = await objects.saveObject(emp, { name: 'Двор, корпус 2', address: 'ул. Гиляровского, 24к2', area: '400 м²' }, o.id);
    expect(o2).toMatchObject({ name: 'Двор, корпус 2', lat: MOSCOW.lat, area: '400 м²' });
    const j = await jobs.createJob(form({ objectId: o.id }), emp, today);
    const list = await objects.listObjects(emp);
    expect(list[0]).toMatchObject({ id: o.id, shifts: 1, lastDate: plusDays(3) });
    expect((await objects.objectShifts(emp, o.id))[0]).toMatchObject({ num: j.num });

    const emp2 = await mkUser('employer', 'petr_i', '9162222222', 'Пётр Иванов');
    const j2 = await jobs.createJob(form({ objectId: o.id }), emp2, today);
    expect((await objects.objectShifts(emp, o.id)).map(x => x.num)).toEqual([j.num]);
    expect(j2.num).toBeGreaterThan(j.num);
    await expectErr(objects.saveObject(emp2, { name: 'Чужой', address: 'x' }, o.id), /не найден/);
    await expectErr(objects.listObjects(fl), /работодатель/);
    await expectErr(objects.saveObject(emp, { name: '', address: 'x', ...MOSCOW }), /название/);
    await expectErr(objects.saveObject(emp, { name: 'Без точки', address: 'x' }), /точку/);
    await objects.deleteObject(emp, o.id);
    expect(await objects.listObjects(emp)).toEqual([]);
    const still = await one<{ object_id: string | null }>('SELECT object_id FROM jobs WHERE num = $1', [j.num]);
    expect(still!.object_id).toBeNull();
  });
});

describe('подтверждение e-mail', () => {
  const tokenFromMail = () => mails.at(-1)!.text.match(/t=([A-Za-z0-9_-]+)/)![1];

  it('письмо со ссылкой; уведомления на почту — только после подтверждения', async () => {
    await prof.saveSettings(fl, { email: true, sms: false });
    await jobs.createJob(form(), emp, today);
    expect((await ev.processOutbox()).sent).toBe(0);        // адрес не подтверждён
    expect(await verify.sendEmailVerification(fl)).toEqual({ sent: true, verified: false });
    await ev.processOutbox();
    expect(mails.at(-1)!.to).toBe(fl.email);
    expect(await verify.confirmEmail('неверный-токен-неверный-токен')).toBe(false);
    expect(await verify.confirmEmail(tokenFromMail())).toBe(true);
    expect(await verify.confirmEmail(tokenFromMail())).toBe(false);   // одноразовая
    mails.length = 0;
    await jobs.createJob(form({ desc: 'Ещё двор' }), emp, today);
    await ev.processOutbox();
    expect(mails).toHaveLength(1);
    expect((await prof.getProfile(fl)).user.emailVerified).toBe(true);
  });

  it('сохранение профиля с тем же адресом не шлёт повторных писем', async () => {
    await prof.updateProfile(fl, { login: 'daniyar_new', email: fl.email });
    await ev.processOutbox();
    expect(mails).toHaveLength(0);
  });

  it('смена адреса сбрасывает подтверждение; старая ссылка не подтверждает новый адрес', async () => {
    await verify.sendEmailVerification(fl);
    await ev.processOutbox();
    const oldToken = tokenFromMail();
    await prof.updateProfile(fl, { email: 'new@x.ru' });
    expect(await verify.confirmEmail(oldToken)).toBe(false);
    await ev.processOutbox();
    expect(mails.at(-1)!.to).toBe('new@x.ru');
    expect(await verify.confirmEmail(tokenFromMail())).toBe(true);
    await prof.updateProfile(fl, { email: 'other@x.ru' });
    expect((await prof.getProfile(fl)).user.emailVerified).toBe(false);
  });
});

describe('самозанятость (НПД)', () => {
  const INN = makeInn('7707083893');

  it('контрольные цифры ИНН', () => {
    expect(verify.innValid(INN)).toBe(true);
    expect(verify.innValid(INN.slice(0, 11) + ((Number(INN[11]) + 1) % 10))).toBe(false);
    expect(verify.innValid('12345')).toBe(false);
  });

  it('статус из ФНС сохраняется и виден работодателю в откликах; сбой ФНС не меняет статус', async () => {
    const asked: string[] = [];
    verify.setNpdFetcher(async (inn) => { asked.push(inn); return true; });
    await expectErr(verify.checkNpd(fl, '123456789012'), /опечатка/);
    await expectErr(verify.checkNpd(emp, INN), /исполнитель/);
    expect((await verify.checkNpd(fl, INN)).status).toBe('ok');
    expect(asked).toEqual([INN]);
    const p = await prof.getProfile(fl);
    expect(p.profile).toMatchObject({ npd: { inn: INN, status: 'ok' } });

    const j = await jobs.createJob(form(), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    expect((await jobs.getJob(j.num, emp)).applicantList![0].npd).toBe(true);
    expect((await sh.applicantsBoard(emp)).jobs[0].people[0].npd).toBe(true);

    verify.setNpdFetcher(async () => { throw new Error('down'); });
    await query('DELETE FROM rate_limits');
    await expectErr(verify.checkNpd(fl, INN), /не отвечает/);
    expect((await prof.getProfile(fl)).profile).toMatchObject({ npd: { status: 'ok' } });
    verify.setNpdFetcher(null);
  });

  it('суточная перепроверка снимает бейдж, если ФНС больше не подтверждает', async () => {
    verify.setNpdFetcher(async () => true);
    await verify.checkNpd(fl, INN);
    await query(`UPDATE freelancer_profiles SET npd_checked_at = now() - interval '2 days'`);
    await query('DELETE FROM rate_limits');
    verify.setNpdFetcher(async () => false);
    expect(await verify.recheckNpd()).toBe(1);
    expect((await prof.getProfile(fl)).profile).toMatchObject({ npd: { status: 'not_found' } });
    verify.setNpdFetcher(null);
  });
});

describe('веб-пуш', () => {
  const sub = (n = 1) => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' + n + 'defghijk', keys: { p256dh: 'B'.repeat(40) + n, auth: 'a'.repeat(16) } });

  it('подписка проверяется; событие уходит на все устройства; отозванная подписка удаляется', async () => {
    const got: { endpoint: string; body: string; url: string }[] = [];
    push.setPushSender(async (s, m) => { if (s.endpoint.includes('abc2')) return false; got.push({ endpoint: s.endpoint, body: m.body, url: m.url }); return true; });
    await expectErr(push.subscribePush(fl, { endpoint: 'http://evil', keys: {} }), /неполную/);
    await expectErr(push.subscribePush(fl, { endpoint: 'https://127.0.0.1/xxxxxxxxxxxx', keys: sub().keys }), /Недопустимый/);
    await push.subscribePush(fl, sub(1));
    await push.subscribePush(fl, sub(2));
    await prof.saveSettings(fl, { sms: false });
    const j = await jobs.createJob(form(), emp, today);
    expect((await ev.processOutbox()).sent).toBe(1);
    expect(got).toEqual([{ endpoint: sub(1).endpoint, body: expect.stringContaining('Новая смена'), url: '/?job=' + j.num }]);
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM push_subscriptions'))!.n).toBe(1);
    await push.unsubscribePush(fl, sub(1).endpoint);
    await jobs.createJob(form({ desc: 'Ещё' }), emp, today);
    expect((await ev.processOutbox()).sent).toBe(0);
    push.setPushSender(null);
  });
});
