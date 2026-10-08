// Этап 4: профиль, база, настройки уведомлений, журнал, доставка (тихие часы, лимит, очередь), фото смены, телефон и пароль.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';
process.env.UPLOAD_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-up-'));
process.env.SMS_DEV_FIXED_CODE = '1234';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const jobs = await import('@/server/jobs');
const sh = await import('@/server/shifts');
const prof = await import('@/server/profile');
const files = await import('@/server/files');
const auth = await import('@/server/auth');
const ev = await import('@/server/events');
const { setMailer } = await import('@/server/mail');
const { setCodeSender } = await import('@/server/sms');
const { sessionUser, createSession } = await import('@/server/session');
const { AppError } = await import('@/server/errors');
const { localISO } = await import('@/lib/jobs');
const { publishMany } = await import('@/server/live');
const cron = await import('@/server/cron');

type SU = NonNullable<Awaited<ReturnType<typeof sessionUser>>>;

const today = localISO();
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localISO(d); };
const MOSCOW = { lat: 55.7558, lng: 37.6173 };

const sms: { to: string; text: string }[] = [];
const mails: { to: string; subject: string; text: string }[] = [];
let smsFail = false;

setCodeSender({
  async send() { return { code: '1234' }; },
  async sendText(to, text) { if (smsFail) throw new Error('шлюз недоступен'); sms.push({ to, text }); }
});
setMailer({ async send(to, subject, text) { mails.push({ to, subject, text }); } });

async function mkUser(role: 'freelancer' | 'employer', login: string, phoneKey: string, name: string, at = MOSCOW): Promise<SU> {
  const { hashPassword } = await import('@/server/password');
  const u = await one<{ id: string }>(
    `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version)
     VALUES ($1, $2, '+7' || $3, $3, $2 || '@x.ru', $4, $5, 'Москва', $6, $7, now(), 't') RETURNING id`,
    [role, login, phoneKey, await hashPassword('secret1!'), name, at.lat, at.lng]);
  await query('INSERT INTO notification_settings (user_id) VALUES ($1)', [u!.id]);
  if (role === 'freelancer') await query(`INSERT INTO freelancer_profiles (user_id, skills, work_cities) VALUES ($1, '{snow}', '{Москва}')`, [u!.id]);
  else await query(`INSERT INTO employer_profiles (user_id, org_type) VALUES ($1, 'УК / ТСЖ')`, [u!.id]);
  const { token } = await createSession(u!.id, {});
  return (await sessionUser(token))!;
}

const form = (over: Record<string, unknown> = {}) => ({
  ...MOSCOW, address: 'Москва, ул. Тверская, 18', district: 'Москва', type: 'snow', desc: 'Двор 320 м²', crew: '1', pay: '6000',
  unit: 'за заказ', payType: 'перевод на карту', dateISO: plusDays(3), access: ['домофон'], tools: 'нужен свой инвентарь', ...over
});

async function expectErr(p: Promise<unknown>, text?: RegExp, field?: string) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    if (text) expect((e as Error).message).toMatch(text);
    if (field !== undefined) expect((e as InstanceType<typeof AppError>).field).toBe(field);
    return;
  }
  throw new Error('ожидалась ошибка');
}

/** Настройки без тихих часов — чтобы доставка не зависела от времени запуска тестов. */
const loud = (u: SU, over: Record<string, unknown> = {}) => prof.saveSettings(u, { quietOn: false, ...over });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

let emp: SU, fl: SU, fl2: SU;

beforeAll(async () => {
  await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool(), undefined, () => {});
});

beforeEach(async () => {
  await query('TRUNCATE jobs, rate_limits, notification_outbox, files CASCADE');
  await query('DELETE FROM users');
  sms.length = 0; mails.length = 0; smsFail = false;
  emp = await mkUser('employer', 'aigul_t', '9161111111', 'Айгуль Тлеубаева');
  fl = await mkUser('freelancer', 'daniyar_s', '9160000000', 'Данияр Сапаров');
  fl2 = await mkUser('freelancer', 'olga_k', '9163333333', 'Ольга Кузнецова', { lat: 59.93, lng: 30.33 }); // Петербург
});

afterAll(async () => {
  await pool().end();
  await fs.rm(process.env.UPLOAD_DIR!, { recursive: true, force: true });
});

describe('профиль', () => {
  it('правка имени, логина, навыков и инвентаря; занятый логин и мат отклоняются', async () => {
    await prof.updateProfile(fl, { firstName: 'Данияр', lastName: 'Сапаров-Ким', freelancer: { skills: ['snow', 'grass', 'хак'], gear: ['Лопата и скребок', 'Моё'], customGear: ['Моё'], ownCar: true } });
    const p = await prof.getProfile(fl);
    expect(p.user.name).toBe('Данияр Сапаров-Ким');
    expect(p.profile).toMatchObject({ skills: ['snow', 'grass'], gear: ['Лопата и скребок', 'Моё'], customGear: ['Моё'], ownCar: true });
    await expectErr(prof.updateProfile(fl, { login: 'OLGA_K' }), /занят/i, 'login');
    await expectErr(prof.updateProfile(fl, { login: 'a' }), /Логин/, 'login');
    await expectErr(prof.updateProfile(fl, { freelancer: { customSkills: ['хуйня'] } }));
    await expectErr(prof.updateProfile(fl, { freelancer: { workCities: [] } }), /город/, 'cities');
  });

  it('работодатель: организация и ИНН, чужие поля роли игнорируются', async () => {
    await prof.updateProfile(emp, { employer: { orgType: 'компания', orgName: 'ООО Двор', inn: '7712345678', access: ['домофон', 'выдумка'] }, freelancer: { skills: ['snow'] } });
    const p = await prof.getProfile(emp);
    expect(p.inn).toBe('7712345678');
    expect(p.profile).toMatchObject({ orgType: 'компания', orgName: 'ООО Двор', access: ['домофон'] });
    await expectErr(prof.updateProfile(emp, { employer: { inn: '123' } }), /ИНН/, 'inn');
  });

  it('история, пометки и отзывы собираются после приёмки', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    const app = (await jobs.getJob(j.num, emp)).applicantList![0].id;
    await sh.staffAction(j.num, app, 'hire', emp);
    await query("UPDATE jobs SET date = LEAST(date, current_date - 1)");
    await sh.reportDone(j.num, fl);
    await sh.acceptWork(j.num, emp);
    const target = (await jobs.getJob(j.num, emp)).shift!.reviewTargets[0].target;
    await sh.saveReview(j.num, { target, rating: 5, text: 'Чисто и вовремя' }, emp);
    const p = await prof.getProfile(fl);
    expect(p.history).toHaveLength(1);
    expect(p.history[0]).toMatchObject({ num: j.num, settle: 'расчёт не отмечен' });
    expect(p.stats).toMatchObject({ done: 1, rating: 5, reviews: 1 });
    expect(p.reviews[0]).toMatchObject({ rating: 5, text: 'Чисто и вовремя', author: 'Айгуль Т.' });
    expect(p.marks).toEqual([]);
  });
});

describe('база и настройки', () => {
  it('база по точке; неверные координаты отклоняются', async () => {
    expect((await prof.setBase(fl, { lat: 55.9, lng: 37.4, label: 'Химки' })).base.label).toBe('Химки');
    const u = await one<{ base_label: string; base_lat: number }>('SELECT base_label, base_lat FROM users WHERE id = $1', [fl.id]);
    expect(u).toMatchObject({ base_label: 'Химки', base_lat: 55.9 });
    await expectErr(prof.setBase(fl, { lat: 200, lng: 0 }), /место/);
  });

  it('настройки: допустимые значения сохраняются, мусор — нет', async () => {
    const s = await prof.saveSettings(fl, { radiusKm: 100, dailyCap: 30, quietFrom: 23, quietTo: 6, sms: false, email: 'да' });
    expect(s).toMatchObject({ radiusKm: 100, dailyCap: 30, quietFrom: 23, quietTo: 6, sms: false, email: false });
    const s2 = await prof.saveSettings(fl, { radiusKm: 77, dailyCap: 1000, quietFrom: 25 });
    expect(s2).toMatchObject({ radiusKm: 100, dailyCap: 30, quietFrom: 23 });
  });
});

describe('журнал и доставка', () => {
  it('новый заказ: оповещение «рядом» только тем, чья база в радиусе', async () => {
    await loud(fl); await loud(fl2);
    const j = await jobs.createJob(form(), emp, today);
    const near = await query<{ user_id: string }>(`SELECT user_id FROM events WHERE kind = 'nearby' AND job_id = (SELECT id FROM jobs WHERE num = $1)`, [j.num]);
    expect(near.rows.map(r => r.user_id)).toEqual([fl.id]);
    expect((await ev.processOutbox()).sent).toBe(1);
    expect(sms[0].to).toBe(fl.phone);
    expect(sms[0].text).toMatch(/^Арена Работы: /);
    // Свои действия работодателя — в журнале, но прочитаны и без доставки.
    const mine = await prof.listEvents(emp);
    expect(mine.unread).toBe(0);
  });

  it('выключенные оповещения: журнал ведётся, SMS не уходят', async () => {
    await loud(fl, { enabled: false });
    await jobs.createJob(form(), emp, today);
    const l = await prof.listEvents(fl);
    expect(l.unread).toBe(1);
    expect(l.toasts).toBe(false);
    expect((await ev.processOutbox()).sent).toBe(0);
  });

  it('дневной лимит: сверх лимита — «без доставки»', async () => {
    await loud(fl, { dailyCap: 3 });
    for (let i = 0; i < 5; i++) await jobs.createJob(form({ desc: 'Двор ' + i }), emp, today);
    const l = await prof.listEvents(fl);
    expect(l.events.filter(e => e.muted)).toHaveLength(2);
    expect((await ev.processOutbox()).sent).toBe(3);
  });

  it('общий суточный бюджет SMS: уведомлениям — до 80%, дальше SMS не уходят', async () => {
    await loud(fl);
    await query(`INSERT INTO rate_limits (key, window_start, count) VALUES ('sms:all', now(), 240)`);
    await jobs.createJob(form(), emp, today);
    expect(await ev.processOutbox()).toEqual({ sent: 0, failed: 1 });
    expect(sms).toHaveLength(0);
    expect((await one<{ error: string }>(`SELECT error FROM notification_outbox WHERE channel = 'sms'`))!.error).toMatch(/лимит SMS/);
  });

  it('тихие часы откладывают отправку; срочное проходит, если разрешено', async () => {
    const { hour } = ev.localClock();
    // Тихие часы — ровно текущий час.
    await prof.saveSettings(fl, { quietOn: true, quietFrom: hour, quietTo: (hour + 1) % 24, urgentBypass: true });
    await jobs.createJob(form(), emp, today);
    expect((await ev.processOutbox()).sent).toBe(0);
    await jobs.createJob(form({ urgent: true, dateISO: today }), emp, today);
    expect((await ev.processOutbox()).sent).toBe(1);
  });

  it('e-mail и повтор при сбое шлюза', async () => {
    await loud(fl, { email: true });
    await query('UPDATE users SET email_verified_at = now() WHERE id = $1', [fl.id]);
    smsFail = true;
    await jobs.createJob(form(), emp, today);
    const r = await ev.processOutbox();
    expect(r).toEqual({ sent: 1, failed: 1 });
    expect(mails[0].to).toBe(fl.email);
    expect(mails[0].text).toMatch(/\/\?job=\d+/);
    const o = await one<{ status: string; attempts: number }>(`SELECT status, attempts FROM notification_outbox WHERE channel = 'sms'`);
    expect(o).toMatchObject({ status: 'pending', attempts: 1 });
    smsFail = false;
    await query(`UPDATE notification_outbox SET next_try_at = now() WHERE status = 'pending'`);
    expect((await ev.processOutbox()).sent).toBe(1);
  });

  it('пачка событий одному человеку: лимит считается внутри пачки', async () => {
    await loud(fl, { dailyCap: 3 });
    await ev.addEvents([1, 2, 3, 4, 5].map(i => ({ userId: fl.id, kind: 'job', text: 'Событие ' + i, deliver: true })));
    const l = await prof.listEvents(fl);
    expect(l.events).toHaveLength(5);
    expect(l.events.filter(e => e.muted).map(e => e.text).sort()).toEqual(['Событие 4', 'Событие 5']);
    expect((await ev.processOutbox()).sent).toBe(3);
  });

  it('живое уведомление большой группе делится на части, никто не теряется', async () => {
    const ids = Array.from({ length: 250 }, () => crypto.randomUUID());
    const c = await pool().connect();
    const got: string[] = [];
    try {
      await c.query('LISTEN arena_live');
      c.on('notification', m => { got.push(...JSON.parse(m.payload!).u); });
      await publishMany([{ userIds: ids, e: { t: 'job', num: 1 } }]);
      await new Promise(r => setTimeout(r, 200));
    } finally { await c.query('UNLISTEN *'); c.release(); }
    expect(new Set(got).size).toBe(250);
  });

  it('прочитать и очистить журнал', async () => {
    await jobs.createJob(form(), emp, today);
    expect((await prof.listEvents(fl)).unread).toBe(1);
    await prof.markEventsRead(fl);
    expect((await prof.listEvents(fl)).unread).toBe(0);
    await prof.clearEvents(fl);
    expect((await prof.listEvents(fl)).events).toEqual([]);
  });
});

describe('фото', () => {
  it('тип определяется по содержимому, не по имени', () => {
    expect(files.sniff(PNG)).toBe('image/png');
    expect(files.sniff(JPEG)).toBe('image/jpeg');
    expect(files.sniff(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
  });

  it('аватар: замена удаляет старый файл', async () => {
    const a = await files.setAvatar(fl, new Blob([PNG], { type: 'image/png' }));
    const id1 = a.avatarUrl.split('/').pop()!;
    const fresh = { ...fl, avatar_url: a.avatarUrl };
    const b = await files.setAvatar(fresh, new Blob([JPEG]));
    await expect(fs.stat(path.join(process.env.UPLOAD_DIR!, id1))).rejects.toThrow();
    expect((await files.readFile(b.avatarUrl.split('/').pop()!, null)).mime).toBe('image/jpeg');
    await expectErr(files.setAvatar(fl, new Blob(['<html>'])), /JPEG, PNG/);
  });

  it('фото смены видят и прикладывают только участники', async () => {
    const j = await jobs.createJob(form(), emp, today);
    await jobs.applyToJob(j.num, { reqConfirmed: true }, fl, today);
    await expectErr(files.addJobPhoto(j.num, 'before', new Blob([JPEG]), fl), /участники/);
    const app = (await jobs.getJob(j.num, emp)).applicantList![0].id;
    await sh.staffAction(j.num, app, 'hire', emp);
    await files.addJobPhoto(j.num, 'before', new Blob([JPEG]), fl);
    const d = await jobs.getJob(j.num, emp);
    expect(d.shift!.photos).toHaveLength(1);
    const photo = d.shift!.photos[0];
    expect(photo.mine).toBe(false);
    const fileId = photo.url.split('/').pop()!;
    expect((await files.readFile(fileId, emp)).mime).toBe('image/jpeg');
    await expectErr(files.readFile(fileId, fl2), /участники/);
    await expectErr(files.readFile(fileId, null), /участники/);
    await expectErr(files.deleteJobPhoto(j.num, photo.id, emp), /приложил/);
    await files.deleteJobPhoto(j.num, photo.id, fl);
    expect((await jobs.getJob(j.num, emp)).shift!.photos).toEqual([]);
  });
});

describe('файлы и уборка', () => {
  it('срок хранения: переписка и фото смены старше 3 лет удаляются, свежие остаются', async () => {
    const oldJob = await jobs.createJob(form(), emp, today);
    const fresh = await jobs.createJob(form(), emp, today);
    const ids = (await query<{ id: string; num: string }>('SELECT id, num FROM jobs WHERE num = ANY($1)', [[oldJob.num, fresh.num]])).rows;
    for (const j of ids) {
      await query(`INSERT INTO messages (job_id, freelancer_id, author_id, author_role, text) VALUES ($1, $2, $2, 'freelancer', 'Буду в 9')`, [j.id, fl.id]);
    }
    await query(`UPDATE jobs SET date = current_date - interval '3 years 1 day', status = 'accepted' WHERE num = $1`, [oldJob.num]);
    await cron.runDueTasks();
    const left = (await query<{ num: string }>('SELECT j.num FROM messages m JOIN jobs j ON j.id = m.job_id')).rows.map(r => Number(r.num));
    expect(left).toEqual([fresh.num]);
  });

  it('файлы идут через подключаемое хранилище (S3 в продакшене)', async () => {
    const { setStorage } = await import('@/server/storage');
    const mem = new Map<string, Uint8Array>();
    setStorage({
      async put(id, data) { mem.set(id, data); }, async get(id) { return mem.get(id) ?? null; },
      async remove(id) { mem.delete(id); }, async listOld() { return []; }
    });
    try {
      const a = await files.setAvatar(fl, new Blob([PNG]));
      const id = a.avatarUrl.split('/').pop()!;
      expect(mem.has(id)).toBe(true);
      expect((await files.readFile(id, null)).mime).toBe('image/png');
      await files.clearAvatar({ ...fl, avatar_url: a.avatarUrl });
      expect(mem.size).toBe(0);
    } finally { setStorage(null); }
  });

  it('брошенные файлы удаляются через сутки', async () => {
    const a = await files.setAvatar(fl, new Blob([PNG]));
    const id = a.avatarUrl.split('/').pop()!;
    await query(`UPDATE users SET avatar_url = NULL WHERE id = $1`, [fl.id]);
    await query(`UPDATE files SET created_at = now() - interval '2 days'`);
    const stray = path.join(process.env.UPLOAD_DIR!, crypto.randomUUID());
    await fs.writeFile(stray, JPEG);
    const old = new Date(Date.now() - 2 * 86400_000);
    await fs.utimes(stray, old, old);
    await cron.runDueTasks();
    await expect(fs.stat(path.join(process.env.UPLOAD_DIR!, id))).rejects.toThrow();
    await expect(fs.stat(stray)).rejects.toThrow();
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM files'))!.n).toBe(0);
  });
});

describe('телефон и пароль', () => {
  it('смена телефона: нужен пароль, код на новый номер', async () => {
    await expectErr(auth.startPhoneChange(fl.id, { phone: '+7 916 555 44 33', password: 'wrong' }, {}), /пароль/i, 'password');
    await expectErr(auth.startPhoneChange(fl.id, { phone: '+7 916 111 11 11', password: 'secret1!' }, {}), /занят|зарегистр/i, 'phone');
    const s = await auth.startPhoneChange(fl.id, { phone: '+7 916 555 44 33', password: 'secret1!' }, {});
    await expectErr(auth.verifyPhoneChange(emp.id, s.challengeId, '1234'), /другому аккаунту/);
    await auth.verifyPhoneChange(fl.id, s.challengeId, '1234');
    const u = await one<{ phone_key: string }>('SELECT phone_key FROM users WHERE id = $1', [fl.id]);
    expect(u!.phone_key).toBe('9165554433');
  });

  it('смена пароля завершает другие входы, текущий остаётся', async () => {
    const other = await createSession(fl.id, {});
    await expectErr(auth.changePassword(fl.id, { current: 'nope', password: 'newpass1', password2: 'newpass1' }, fl.session_id), /Текущий/, 'current');
    await auth.changePassword(fl.id, { current: 'secret1!', password: 'newpass1', password2: 'newpass1' }, fl.session_id);
    expect(await sessionUser(other.token)).toBeNull();
    const left = await query('SELECT id FROM sessions WHERE user_id = $1', [fl.id]);
    expect(left.rows.map(r => r.id)).toEqual([fl.session_id]);
  });
});
