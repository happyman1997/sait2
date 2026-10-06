// Интеграционные тесты авторизации на настоящем Postgres (TEST_DATABASE_URL, по умолчанию arena_test).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';
process.env.SMS_DEV_FIXED_CODE = '';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const { setCodeSender } = await import('@/server/sms');
const auth = await import('@/server/auth');
const { sessionUser } = await import('@/server/session');
const { AppError } = await import('@/server/errors');

const sent: { phone: string; code: string; channel: string }[] = [];
let nextCode = '4821';
setCodeSender({
  async send(phone, channel) {
    sent.push({ phone, code: nextCode, channel });
    return { code: nextCode };
  },
  async sendText() {}
});

const ctx = { ip: '10.0.0.1', userAgent: 'vitest' };

const freelancer = (over: Record<string, unknown> = {}) => ({
  role: 'freelancer', name: 'Данияр Сапаров', phone: '+7 916 000 00 00', login: 'daniyar_s', password: 'secret1!',
  email: 'd@mail.ru', city: 'Москва',
  freelancer: { skills: ['snow', 'bogus'], customSkills: ['вывоз снега'], gear: ['Триммер'], customGear: [], ownCar: true, workCities: ['Москва', 'Химки'] },
  ...over
});

const employer = (over: Record<string, unknown> = {}) => ({
  role: 'employer', name: 'Айгуль Тлеубаева', phone: '8 (916) 111-11-11', login: 'aigul_t', password: 'secret2!',
  email: 'a@mail.ru', city: 'Москва',
  employer: { orgType: 'УК / ТСЖ', orgName: 'УК «Тверская»', access: ['домофон'], tools: 'нужен свой инвентарь' },
  ...over
});

async function expectErr(p: Promise<unknown>, field: string | undefined, text?: RegExp) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as InstanceType<typeof AppError>).field).toBe(field);
    if (text) expect((e as Error).message).toMatch(text);
    return e as InstanceType<typeof AppError>;
  }
  throw new Error('ожидалась ошибка');
}

async function register(input: Record<string, unknown>) {
  const s = await auth.startSignup(input, ctx);
  return auth.verifySignup(s.challengeId, nextCode, { offer: true, pd: true }, ctx);
}

beforeAll(async () => {
  await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool(), undefined, () => {});
});

beforeEach(async () => {
  await query('TRUNCATE users, auth_challenges, rate_limits, daily_stats CASCADE');
  sent.length = 0;
  nextCode = '4821';
});

afterAll(async () => {
  await pool().end();
});

describe('регистрация', () => {
  it('полный цикл исполнителя: код → аккаунт, профиль, сессия', async () => {
    const s = await auth.startSignup(freelancer(), ctx);
    expect(s.sentTo).toBe('+7 916 000-00-00');
    expect(sent).toHaveLength(1);
    expect(await one('SELECT 1 FROM users')).toBeNull(); // до кода аккаунта нет

    const { user, session } = await auth.verifySignup(s.challengeId, '4821', { offer: true, pd: true }, ctx);
    expect(user).toMatchObject({ role: 'freelancer', login: 'daniyar_s', phone: '+79160000000', city: 'Москва' });
    expect(user.baseLat).toBeCloseTo(55.75, 1);

    const me = await sessionUser(session.token);
    expect(me?.id).toBe(user.id);

    const profile = await auth.loadProfile(user.id, 'freelancer');
    expect(profile).toMatchObject({ skills: ['snow'], customSkills: ['вывоз снега'], ownCar: true, workCities: ['Москва', 'Химки'] });
  });

  it('работодатель: телефон с 8 нормализуется, профиль сохраняется', async () => {
    const { user } = await register(employer());
    expect(user.phone).toBe('+79161111111');
    expect(await auth.loadProfile(user.id, 'employer')).toMatchObject({ orgType: 'УК / ТСЖ', access: ['домофон'], tools: 'нужен свой инвентарь' });
  });

  it('обязательные поля — ошибка у первого поля с текстом прототипа', async () => {
    await expectErr(auth.checkContacts(freelancer({ name: 'Д' })), 'name', /имя и фамилию/);
    await expectErr(auth.checkContacts(freelancer({ phone: '12345' })), 'phone', /минимум 10 цифр/);
    await expectErr(auth.checkContacts(freelancer({ login: 'да' })), 'login', /3–20 символов/);
    await expectErr(auth.checkContacts(freelancer({ password: '123' })), 'password', /не короче 8/);
    await expectErr(auth.checkContacts(freelancer({ password: '12345678' })), 'password', /самых частых/);
    await expectErr(auth.checkContacts(freelancer({ password: 'QWERTYUI' })), 'password', /самых частых/);
    await expectErr(auth.checkContacts(freelancer({ login: 'daniyar_s', password: 'Daniyar_S' })), 'password', /Логин или номер/);
    await expectErr(auth.checkContacts(freelancer({ email: 'a@b' })), 'email', /опечатка/);
    await expectErr(auth.checkContacts(freelancer({ city: ' ' })), 'city', /город/);
  });

  it('профиль: исполнителю нужен навык и город, работодателю — доступ и инвентарь', async () => {
    await expectErr(auth.startSignup(freelancer({ freelancer: { skills: [], customSkills: [], workCities: ['Москва'] } }), ctx), 'skills');
    await expectErr(auth.startSignup(freelancer({ freelancer: { skills: ['snow'], workCities: [] } }), ctx), 'cities');
    await expectErr(auth.startSignup(employer({ employer: { access: [], tools: 'нужен свой инвентарь' } }), ctx), 'access');
    await expectErr(auth.startSignup(employer({ employer: { access: ['домофон'] } }), ctx), 'tools');
  });

  it('один аккаунт — одна роль: занятый телефон или логин в любой роли', async () => {
    await register(freelancer());
    const e1 = await expectErr(auth.checkContacts(employer({ phone: '8 916 000-00-00' })), 'phone');
    expect(e1.message).toBe('Этот номер уже зарегистрирован — как исполнитель. Один аккаунт — одна роль: войдите или укажите другой номер.');
    await expectErr(auth.checkContacts(employer({ login: 'DANIYAR_S' })), 'login', /Этот логин уже зарегистрирован — как исполнитель/);
  });

  it('гонка: два незавершённых кода на один номер — второй аккаунт не создаётся', async () => {
    const a = await auth.startSignup(freelancer(), ctx);
    const b = await auth.startSignup(employer({ phone: '+7 916 000 00 00' }), ctx);
    await auth.verifySignup(a.challengeId, '4821', { offer: true, pd: true }, ctx);
    await expectErr(auth.verifySignup(b.challengeId, '4821', { offer: true, pd: true }, ctx), 'phone', /как исполнитель/);
  });

  it('модерация на сервере: ник, имя, свои навыки', async () => {
    const e = await expectErr(auth.checkContacts(freelancer({ login: 'Snow_huy' })), 'login');
    expect(e.extra).toMatchObject({ moderation: { label: 'Логин', category: 'нецензурная лексика' } });
    await expectErr(auth.startSignup(freelancer({ freelancer: { skills: ['snow'], customSkills: ['оплата вперёд'], workCities: ['Москва'] } }), ctx), 'skills');
    await expectErr(auth.checkContacts(freelancer({ name: 'Mr.Suka' })), 'name');
  });

  it('код: 3 попытки, затем только новый код; оферта и согласие на ПДн — обе галочки обязательны', async () => {
    const s = await auth.startSignup(freelancer(), ctx);
    await expectErr(auth.verifySignup(s.challengeId, '4821', { offer: false, pd: true }, ctx), 'offer', /оферты/);
    await expectErr(auth.verifySignup(s.challengeId, '4821', { offer: true }, ctx), 'pdConsent', /персональных данных/);
    await expectErr(auth.verifySignup(s.challengeId, '12', { offer: true, pd: true }, ctx), 'code', /четыре цифры/);
    await expectErr(auth.verifySignup(s.challengeId, '0000', { offer: true, pd: true }, ctx), 'code', /осталось попыток: 2/);
    await expectErr(auth.verifySignup(s.challengeId, '0000', { offer: true, pd: true }, ctx), 'code', /осталось попыток: 1/);
    await expectErr(auth.verifySignup(s.challengeId, '0000', { offer: true, pd: true }, ctx), 'code', /Попытки исчерпаны/);
    await expectErr(auth.verifySignup(s.challengeId, '4821', { offer: true, pd: true }, ctx), 'code', /Попытки исчерпаны/);

    // после исчерпания попыток повторная отправка доступна сразу
    nextCode = '7777';
    const r = await auth.resendCode(s.challengeId, 'call', 'signup', ctx);
    expect(r.channel).toBe('call');
    expect(sent.at(-1)).toMatchObject({ channel: 'call' });
    const { user } = await auth.verifySignup(s.challengeId, '7777', { offer: true, pd: true }, ctx);
    expect(user.login).toBe('daniyar_s');
    // использованный код второй раз не срабатывает
    await expectErr(auth.verifySignup(s.challengeId, '7777', { offer: true, pd: true }, ctx), undefined, /устарела/);
  });

  it('параллельные попытки не обходят лимит в 3 кода', async () => {
    const s = await auth.startSignup(freelancer(), ctx);
    const wrong = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010'];
    const res = await Promise.allSettled(wrong.map(c => auth.verifySignup(s.challengeId, c, { offer: true, pd: true }, ctx)));
    expect(res.every(r => r.status === 'rejected')).toBe(true);
    const row = await one<{ attempts: number }>('SELECT attempts FROM auth_challenges WHERE id = $1', [s.challengeId]);
    expect(row!.attempts).toBe(3);
    await expectErr(auth.verifySignup(s.challengeId, '4821', { offer: true, pd: true }, ctx), 'code', /Попытки исчерпаны/);
  });

  it('мусорный id подтверждения — 400, а не ошибка базы', async () => {
    await expectErr(auth.verifySignup('-'.repeat(36), '4821', { offer: true, pd: true }, ctx), undefined, /не найдена/);
  });

  it('повторная отправка не раньше чем через 60 секунд', async () => {
    const s = await auth.startSignup(freelancer(), ctx);
    await expectErr(auth.resendCode(s.challengeId, 'sms', 'signup', ctx), 'code', /через \d+ с/);
    await query(`UPDATE auth_challenges SET last_sent_at = now() - interval '61 seconds'`);
    await auth.resendCode(s.challengeId, 'sms', 'signup', ctx);
    expect(sent).toHaveLength(2);
  });

  it('подбор кода: не больше 10 неверных кодов на номер в сутки — по всем запросам кода сразу', async () => {
    const s = await auth.startSignup(freelancer(), ctx);
    let fails = 0;
    for (let send = 0; send < 4 && fails < 10; send++) {
      if (send) await auth.resendCode(s.challengeId, 'sms', 'signup', ctx);
      for (let k = 0; k < 3 && fails < 10; k++, fails++) await expectErr(auth.verifySignup(s.challengeId, '0000', { offer: true, pd: true }, ctx), 'code', /не совпал|исчерпаны/);
    }
    // Даже верный код больше не принимается: номер закрыт до завтра.
    await query(`UPDATE auth_challenges SET last_sent_at = now() - interval '2 minutes'`);
    await auth.resendCode(s.challengeId, 'sms', 'signup', ctx);
    await expectErr(auth.verifySignup(s.challengeId, '4821', { offer: true, pd: true }, ctx), 'code', /попробуйте завтра/);
  });

  it('SMS на один номер — не больше 10 в сутки', async () => {
    await query(`INSERT INTO rate_limits (key, window_start, count) VALUES ('sms:day:79160000000', now(), 10)`);
    await expectErr(auth.startSignup(freelancer(), ctx), undefined, /уже отправлено много кодов/);
  });

  it('просроченный код не принимается', async () => {
    const s = await auth.startSignup(freelancer(), ctx);
    await query(`UPDATE auth_challenges SET expires_at = now() - interval '1 second'`);
    await expectErr(auth.verifySignup(s.challengeId, '4821', { offer: true, pd: true }, ctx), 'code', /устарел/);
  });
});

describe('вход', () => {
  beforeEach(async () => {
    await register(freelancer());
    await register(employer());
  });

  it('по логину (регистр не важен) и по телефону (последние 10 цифр); роль — из аккаунта', async () => {
    expect((await auth.login('Daniyar_S', 'secret1!', ctx)).user.role).toBe('freelancer');
    expect((await auth.login('8 916 111 11 11', 'secret2!', ctx)).user.role).toBe('employer');
    expect((await auth.login('+7 (916) 000-00-00', 'secret1!', ctx)).user.login).toBe('daniyar_s');
  });

  it('ошибки входа', async () => {
    await expectErr(auth.login('', 'secret1!', ctx), 'identifier', /Введите логин/);
    await expectErr(auth.login('+7 916', 'secret1!', ctx), 'identifier', /минимум 10/);
    await expectErr(auth.login('д@', 'secret1!', ctx), 'identifier', /Логин — 3–20/);
    await expectErr(auth.login('daniyar_s', '123', ctx), 'password', /не короче 6/);
    await expectErr(auth.login('nobody_here', 'secret1!', ctx), 'identifier', /с таким логином не найден/);
    await expectErr(auth.login('+7 999 000 00 00', 'secret1!', ctx), 'identifier', /с таким номером не найден/);
    await expectErr(auth.login('daniyar_s', 'wrong-pass', ctx), 'password', /Неверный пароль/);
  });

  it('ограничение частоты попыток входа', async () => {
    for (let i = 0; i < 10; i++) await expectErr(auth.login('daniyar_s', 'wrong-pass', ctx), 'password');
    const e = await expectErr(auth.login('daniyar_s', 'secret1!', ctx), undefined, /Слишком много попыток/);
    expect(e.status).toBe(429);
  });

  it('параллельная пачка неверных паролей не обходит лимит', async () => {
    const res = await Promise.allSettled(Array.from({ length: 30 }, () => auth.login('daniyar_s', 'wrong-pass', ctx)));
    const statuses = res.map(r => (r.status === 'rejected' ? (r.reason as { status: number }).status : 200));
    expect(statuses.filter(x => x === 401)).toHaveLength(10);
    expect(statuses.filter(x => x === 429)).toHaveLength(20);
  });

  it('успешные входы не тратят лимит попыток', async () => {
    for (let i = 0; i < 12; i++) await auth.login('daniyar_s', 'secret1!', ctx);
    for (let i = 0; i < 9; i++) await expectErr(auth.login('daniyar_s', 'wrong-pass', ctx), 'password');
    expect((await auth.login('daniyar_s', 'secret1!', ctx)).user.login).toBe('daniyar_s');
  });

  it('заблокированный аккаунт не входит', async () => {
    await query(`UPDATE users SET status = 'blocked' WHERE login = 'daniyar_s'`);
    const e = await expectErr(auth.login('daniyar_s', 'secret1!', ctx), undefined, /заблокирован/);
    expect(e.status).toBe(403);
  });

  it('сессия: не дольше 90 дней с входа; у поддержки — 12 часов без действий', async () => {
    const { session } = await auth.login('daniyar_s', 'secret1!', ctx);
    expect(await sessionUser(session.token)).not.toBeNull();
    await query(`UPDATE sessions SET created_at = now() - interval '91 days'`);
    expect(await sessionUser(session.token)).toBeNull();

    const staff = await auth.login('daniyar_s', 'secret1!', ctx);
    await query(`UPDATE users SET is_staff = true WHERE login = 'daniyar_s'`);
    expect(await sessionUser(staff.session.token)).not.toBeNull();
    await query(`UPDATE sessions SET last_seen_at = now() - interval '13 hours'`);
    expect(await sessionUser(staff.session.token)).toBeNull();
  });
});

describe('восстановление пароля', () => {
  it('логин → код → новый пароль → вход; старые сессии и пароль больше не работают', async () => {
    const { session: old } = await register(freelancer());
    nextCode = '5150';
    const s = await auth.startRecover('daniyar_s', ctx);
    expect(sent.at(-1)).toMatchObject({ phone: '+79160000000', code: '5150' });

    await expectErr(auth.completeRecover(s.challengeId, 'newpass1', 'newpass1', ctx), undefined, /устарело/); // без кода нельзя
    await expectErr(auth.verifyRecover(s.challengeId, '0000'), 'code', /не совпал/);
    await auth.verifyRecover(s.challengeId, '5150');
    await expectErr(auth.completeRecover(s.challengeId, 'short', 'short', ctx), 'password', /не короче 8/);
    await expectErr(auth.completeRecover(s.challengeId, 'newpass1', 'newpass2', ctx), 'password2', /не совпали/);
    const { user } = await auth.completeRecover(s.challengeId, 'newpass1', 'newpass1', ctx);
    expect(user.login).toBe('daniyar_s');

    expect(await sessionUser(old.token)).toBeNull();
    await expectErr(auth.login('daniyar_s', 'secret1!', ctx), 'password');
    expect((await auth.login('daniyar_s', 'newpass1', ctx)).user.login).toBe('daniyar_s');
  });

  it('не раскрывает, существует ли аккаунт', async () => {
    const s = await auth.startRecover('ghost_user', ctx);
    expect(s.challengeId).toMatch(/[0-9a-f-]{36}/);
    expect(sent).toHaveLength(0);
    await expectErr(auth.verifyRecover(s.challengeId, '4821'), 'code', /не совпал/);
  });
});

describe('IP клиента за прокси', () => {
  it('берём адрес, добавленный нашим прокси, а не подставленный клиентом', async () => {
    const { clientIp } = await import('@/server/http');
    const h = new Headers({ 'x-forwarded-for': '6.6.6.6, 10.1.2.3' });
    expect(clientIp(h, 1)).toBe('10.1.2.3');
    expect(clientIp(h, 2)).toBe('6.6.6.6');
    expect(clientIp(h, 0)).toBeNull();
    expect(clientIp(new Headers({ 'x-real-ip': '10.0.0.9' }), 1)).toBe('10.0.0.9');
    expect(clientIp(new Headers({ 'x-forwarded-for': 'garbage;drop' }), 1)).toBeNull();
  });
});

describe('счётчики площадки', () => {
  it('снимок на день не меняется до следующих суток', async () => {
    await register(freelancer());
    const a = await auth.platformStats();
    expect(a).toMatchObject({ freelancers: 1, employers: 0 });
    await register(employer());
    expect(await auth.platformStats()).toMatchObject({ freelancers: 1, employers: 0 });
  });
});
