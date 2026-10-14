// Интеграционные тесты авторизации на настоящем Postgres (TEST_DATABASE_URL, по умолчанию arena_test).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';
process.env.DEV_FIXED_CODE = '';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const { setMailer } = await import('@/server/mail');
const auth = await import('@/server/auth');
const { sessionUser } = await import('@/server/session');
const { AppError } = await import('@/server/errors');

// Письма с кодом: код — последние 6 цифр темы.
const mails: { to: string; subject: string; text: string; code: string }[] = [];
let mailDown = false;
setMailer({
  async send(to, subject, text) {
    if (mailDown) throw new Error('smtp down');
    mails.push({ to, subject, text, code: subject.match(/(\d{6})$/)?.[1] ?? '' });
  }
});
const lastCode = () => mails.at(-1)!.code;
/** Заведомо неверный код. */
const wrong = (code = lastCode()) => (code === '000000' ? '111111' : '000000');

const ctx = { ip: '10.0.0.1', userAgent: 'vitest' };

// «Прошла минута»: пауза между письмами снята и у подтверждения, и у адреса.
const afterPause = async () => {
  await query(`UPDATE auth_challenges SET last_sent_at = now() - interval '2 minutes'`);
  await query(`UPDATE rate_limits SET window_start = now() - interval '2 minutes' WHERE key LIKE 'code:gap:%'`);
};

const freelancer = (over: Record<string, unknown> = {}) => ({
  role: 'freelancer', name: 'Данияр Сапаров', login: 'daniyar_s', password: 'secret1!',
  email: 'd@mail.ru', city: 'Москва',
  freelancer: { skills: ['snow', 'bogus'], customSkills: ['вывоз снега'], gear: ['Триммер'], customGear: [], ownCar: true, workCities: ['Москва', 'Химки'] },
  ...over
});

const employer = (over: Record<string, unknown> = {}) => ({
  role: 'employer', name: 'Айгуль Тлеубаева', login: 'aigul_t', password: 'secret2!',
  email: 'A@Mail.ru', city: 'Москва',
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
  return auth.verifySignup(s.challengeId, lastCode(), { offer: true, pd: true }, ctx);
}

beforeAll(async () => {
  await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool(), undefined, () => {});
});

beforeEach(async () => {
  await query('TRUNCATE users, auth_challenges, rate_limits, daily_stats, notification_outbox CASCADE');
  mails.length = 0;
  mailDown = false;
});

afterAll(async () => {
  await pool().end();
});

describe('регистрация', () => {
  it('полный цикл исполнителя: код в письме → аккаунт с подтверждённой почтой, профиль, сессия', async () => {
    const s = await auth.startSignup(freelancer(), ctx);
    expect(s.sentTo).toBe('d@mail.ru');
    expect(mails).toEqual([expect.objectContaining({ to: 'd@mail.ru', subject: expect.stringMatching(/код подтверждения \d{6}$/) })]);
    expect(mails[0].text).toContain('Код: ' + lastCode());
    expect(await one('SELECT 1 FROM users')).toBeNull(); // до кода аккаунта нет

    const { user, session } = await auth.verifySignup(s.challengeId, lastCode(), { offer: true, pd: true }, ctx);
    expect(user).toMatchObject({ role: 'freelancer', login: 'daniyar_s', email: 'd@mail.ru', city: 'Москва' });
    expect(user).not.toHaveProperty('phone');
    expect(user.baseLat).toBeCloseTo(55.75, 1);
    const row = await one<{ phone: string | null; verified: boolean }>('SELECT phone, email_verified_at IS NOT NULL AS verified FROM users WHERE id = $1', [user.id]);
    expect(row).toEqual({ phone: null, verified: true });

    const me = await sessionUser(session.token);
    expect(me?.id).toBe(user.id);

    const profile = await auth.loadProfile(user.id, 'freelancer');
    expect(profile).toMatchObject({ skills: ['snow'], customSkills: ['вывоз снега'], ownCar: true, workCities: ['Москва', 'Химки'] });
    // Почта подтверждена кодом — отдельное письмо со ссылкой не нужно.
    expect(await one(`SELECT 1 FROM notification_outbox WHERE user_id = $1`, [user.id])).toBeNull();
    expect(await one(`SELECT 1 FROM notification_settings WHERE user_id = $1 AND email`, [user.id])).not.toBeNull();
  });

  it('работодатель: профиль сохраняется, почта — как ввели', async () => {
    const { user } = await register(employer());
    expect(user.email).toBe('A@Mail.ru');
    expect(await auth.loadProfile(user.id, 'employer')).toMatchObject({ orgType: 'УК / ТСЖ', access: ['домофон'], tools: 'нужен свой инвентарь' });
  });

  it('обязательные поля — ошибка у первого поля с текстом прототипа', async () => {
    await expectErr(auth.checkContacts(freelancer({ name: 'Д' })), 'name', /имя и фамилию/);
    await expectErr(auth.checkContacts(freelancer({ email: '' })), 'email', /Укажите e-mail/);
    await expectErr(auth.checkContacts(freelancer({ email: 'a@b' })), 'email', /опечатка/);
    await expectErr(auth.checkContacts(freelancer({ login: 'да' })), 'login', /3–20 символов/);
    await expectErr(auth.checkContacts(freelancer({ password: '123' })), 'password', /не короче 8/);
    await expectErr(auth.checkContacts(freelancer({ password: '12345678' })), 'password', /самых частых/);
    await expectErr(auth.checkContacts(freelancer({ password: 'QWERTYUI' })), 'password', /самых частых/);
    await expectErr(auth.checkContacts(freelancer({ login: 'daniyar_s', password: 'Daniyar_S' })), 'password', /Логин или почту/);
    await expectErr(auth.checkContacts(freelancer({ email: 'daniyar.sap@mail.ru', password: 'daniyar.sap' })), 'password', /Логин или почту/);
    await expectErr(auth.checkContacts(freelancer({ city: ' ' })), 'city', /город/);
  });

  it('профиль: исполнителю нужен навык и город, работодателю — доступ и инвентарь', async () => {
    await expectErr(auth.startSignup(freelancer({ freelancer: { skills: [], customSkills: [], workCities: ['Москва'] } }), ctx), 'skills');
    await expectErr(auth.startSignup(freelancer({ freelancer: { skills: ['snow'], workCities: [] } }), ctx), 'cities');
    await expectErr(auth.startSignup(employer({ employer: { access: [], tools: 'нужен свой инвентарь' } }), ctx), 'access');
    await expectErr(auth.startSignup(employer({ employer: { access: ['домофон'] } }), ctx), 'tools');
  });

  it('один аккаунт — одна роль: занятая почта (без учёта регистра) или логин в любой роли', async () => {
    await register(freelancer());
    const e1 = await expectErr(auth.checkContacts(employer({ email: 'D@MAIL.RU' })), 'email');
    expect(e1.message).toBe('Эта почта уже зарегистрирована — как исполнитель. Один аккаунт — одна роль: войдите или укажите другую почту.');
    await expectErr(auth.checkContacts(employer({ login: 'DANIYAR_S' })), 'login', /Этот логин уже зарегистрирован — как исполнитель/);
  });

  it('гонка: два незавершённых кода на одну почту — второй аккаунт не создаётся', async () => {
    const a = await auth.startSignup(freelancer(), ctx);
    const codeA = lastCode();
    await afterPause();
    const b = await auth.startSignup(employer({ email: 'd@mail.ru' }), ctx);
    const codeB = lastCode();
    await auth.verifySignup(a.challengeId, codeA, { offer: true, pd: true }, ctx);
    await expectErr(auth.verifySignup(b.challengeId, codeB, { offer: true, pd: true }, ctx), 'email', /как исполнитель/);
  });

  it('модерация на сервере: ник, имя, свои навыки', async () => {
    const e = await expectErr(auth.checkContacts(freelancer({ login: 'Snow_huy' })), 'login');
    expect(e.extra).toMatchObject({ moderation: { label: 'Логин', category: 'нецензурная лексика' } });
    await expectErr(auth.startSignup(freelancer({ freelancer: { skills: ['snow'], customSkills: ['оплата вперёд'], workCities: ['Москва'] } }), ctx), 'skills');
    await expectErr(auth.checkContacts(freelancer({ name: 'Mr.Suka' })), 'name');
  });

  it('код: 3 попытки, затем только новый код; оферта и согласие на ПДн — обе галочки обязательны', async () => {
    const s = await auth.startSignup(freelancer(), ctx);
    const code = lastCode();
    await expectErr(auth.verifySignup(s.challengeId, code, { offer: false, pd: true }, ctx), 'offer', /оферты/);
    await expectErr(auth.verifySignup(s.challengeId, code, { offer: true }, ctx), 'pdConsent', /персональных данных/);
    await expectErr(auth.verifySignup(s.challengeId, '12', { offer: true, pd: true }, ctx), 'code', /шесть цифр/);
    await expectErr(auth.verifySignup(s.challengeId, wrong(), { offer: true, pd: true }, ctx), 'code', /осталось попыток: 2/);
    await expectErr(auth.verifySignup(s.challengeId, wrong(), { offer: true, pd: true }, ctx), 'code', /осталось попыток: 1/);
    await expectErr(auth.verifySignup(s.challengeId, wrong(), { offer: true, pd: true }, ctx), 'code', /Попытки исчерпаны/);
    await expectErr(auth.verifySignup(s.challengeId, code, { offer: true, pd: true }, ctx), 'code', /Попытки исчерпаны/);

    // после исчерпания попыток — новый код, но не раньше паузы в минуту
    await expectErr(auth.resendCode(s.challengeId, 'signup', ctx), 'code', /через (1 мин|\d+ с)/);
    await afterPause();
    await auth.resendCode(s.challengeId, 'signup', ctx);
    expect(mails).toHaveLength(2);
    // Старый код после перевыпуска не подходит.
    if (lastCode() !== code) await expectErr(auth.verifySignup(s.challengeId, code, { offer: true, pd: true }, ctx), 'code', /не совпал/);
    const { user } = await auth.verifySignup(s.challengeId, lastCode(), { offer: true, pd: true }, ctx);
    expect(user.login).toBe('daniyar_s');
    // использованный код второй раз не срабатывает
    await expectErr(auth.verifySignup(s.challengeId, lastCode(), { offer: true, pd: true }, ctx), undefined, /устарела/);
  });

  it('параллельные попытки не обходят лимит в 3 кода', async () => {
    const s = await auth.startSignup(freelancer(), ctx);
    const real = lastCode();
    const tries = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(6, '0')).filter(c => c !== real);
    const res = await Promise.allSettled(tries.map(c => auth.verifySignup(s.challengeId, c, { offer: true, pd: true }, ctx)));
    expect(res.every(r => r.status === 'rejected')).toBe(true);
    const row = await one<{ attempts: number }>('SELECT attempts FROM auth_challenges WHERE id = $1', [s.challengeId]);
    expect(row!.attempts).toBe(3);
    await expectErr(auth.verifySignup(s.challengeId, real, { offer: true, pd: true }, ctx), 'code', /Попытки исчерпаны/);
  });

  it('мусорный id подтверждения — 400, а не ошибка базы', async () => {
    await expectErr(auth.verifySignup('-'.repeat(36), '482100', { offer: true, pd: true }, ctx), undefined, /не найдена/);
  });

  it('письмо с кодом на адрес — не чаще раза в минуту, и новая регистрация паузу не обходит', async () => {
    const s = await auth.startSignup(freelancer(), ctx);
    expect(s.resendIn).toBe(60);
    await expectErr(auth.resendCode(s.challengeId, 'signup', ctx), 'code', /через (1 мин|\d+ с)/);
    await expectErr(auth.startSignup(freelancer({ login: 'daniyar_2' }), ctx), undefined, /уже отправлено/);
    await afterPause();
    await auth.resendCode(s.challengeId, 'signup', ctx);
    expect(mails.map(m => m.to)).toEqual(['d@mail.ru', 'd@mail.ru']);
  });

  it('письмо не ушло — понятная ошибка, и сразу можно попробовать ещё раз', async () => {
    mailDown = true;
    const e = await expectErr(auth.startSignup(freelancer(), ctx), undefined, /Письмо не отправилось/);
    expect(e.status).toBe(502);
    mailDown = false;
    await auth.startSignup(freelancer(), ctx);
    expect(mails).toHaveLength(1);
  });

  it('подбор кода: не больше 10 неверных кодов на адрес в сутки — по всем запросам кода сразу', async () => {
    const s = await auth.startSignup(freelancer(), ctx);
    let fails = 0;
    for (let send = 0; send < 4 && fails < 10; send++) {
      if (send) { await afterPause(); await auth.resendCode(s.challengeId, 'signup', ctx); }
      for (let k = 0; k < 3 && fails < 10; k++, fails++) await expectErr(auth.verifySignup(s.challengeId, wrong(), { offer: true, pd: true }, ctx), 'code', /не совпал|исчерпаны/);
    }
    // Даже верный код больше не принимается: адрес закрыт до завтра.
    await afterPause();
    await auth.resendCode(s.challengeId, 'signup', ctx);
    await expectErr(auth.verifySignup(s.challengeId, lastCode(), { offer: true, pd: true }, ctx), 'code', /попробуйте завтра/);
  });

  it('писем с кодом на один адрес — не больше 10 в сутки', async () => {
    await query(`INSERT INTO rate_limits (key, window_start, count) VALUES ('code:day:e:d@mail.ru', now(), 10)`);
    await expectErr(auth.startSignup(freelancer({ email: 'D@mail.ru' }), ctx), undefined, /уже отправлено много писем/);
  });

  it('просроченный код не принимается', async () => {
    const s = await auth.startSignup(freelancer(), ctx);
    await query(`UPDATE auth_challenges SET expires_at = now() - interval '1 second'`);
    await expectErr(auth.verifySignup(s.challengeId, lastCode(), { offer: true, pd: true }, ctx), 'code', /устарел/);
  });
});

describe('вход', () => {
  beforeEach(async () => {
    await register(freelancer());
    await register(employer());
  });

  it('по логину и по почте (регистр не важен); роль — из аккаунта', async () => {
    expect((await auth.login('Daniyar_S', 'secret1!', ctx)).user.role).toBe('freelancer');
    expect((await auth.login('a@mail.RU', 'secret2!', ctx)).user.role).toBe('employer');
    expect((await auth.login(' D@Mail.ru ', 'secret1!', ctx)).user.login).toBe('daniyar_s');
  });

  it('ошибки входа', async () => {
    await expectErr(auth.login('', 'secret1!', ctx), 'identifier', /Введите почту или логин/);
    await expectErr(auth.login('d@mail', 'secret1!', ctx), 'identifier', /опечатка/);
    await expectErr(auth.login('+7 916 000 00 00', 'secret1!', ctx), 'identifier', /Логин — 3–20/);
    await expectErr(auth.login('daniyar_s', '123', ctx), 'password', /не короче 6/);
    await expectErr(auth.login('nobody_here', 'secret1!', ctx), 'identifier', /с таким логином не найден/);
    await expectErr(auth.login('nobody@mail.ru', 'secret1!', ctx), 'identifier', /с такой почтой не найден/);
    await expectErr(auth.login('daniyar_s', 'wrong-pass', ctx), 'password', /Неверный пароль/);
  });

  it('ограничение частоты попыток входа — по логину и по почте', async () => {
    for (let i = 0; i < 10; i++) await expectErr(auth.login('daniyar_s', 'wrong-pass', ctx), 'password');
    const e = await expectErr(auth.login('daniyar_s', 'secret1!', ctx), undefined, /Слишком много попыток/);
    expect(e.status).toBe(429);
    for (let i = 0; i < 10; i++) await expectErr(auth.login('d@mail.ru', 'wrong-pass', ctx), 'password');
    await expectErr(auth.login('D@MAIL.RU', 'secret1!', ctx), undefined, /Слишком много попыток/);
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
  it('почта или логин → код в письме → новый пароль → вход; старые сессии и пароль больше не работают', async () => {
    const { session: old } = await register(freelancer());
    await afterPause();
    const s = await auth.startRecover('daniyar_s', ctx);
    expect(mails.at(-1)).toMatchObject({ to: 'd@mail.ru', subject: expect.stringMatching(/восстановления пароля \d{6}$/) });

    await expectErr(auth.completeRecover(s.challengeId, 'newpass1', 'newpass1', ctx), undefined, /устарело/); // без кода нельзя
    await expectErr(auth.verifyRecover(s.challengeId, wrong()), 'code', /не совпал/);
    await auth.verifyRecover(s.challengeId, lastCode());
    await expectErr(auth.completeRecover(s.challengeId, 'short', 'short', ctx), 'password', /не короче 8/);
    await expectErr(auth.completeRecover(s.challengeId, 'newpass1', 'newpass2', ctx), 'password2', /не совпали/);
    const { user } = await auth.completeRecover(s.challengeId, 'newpass1', 'newpass1', ctx);
    expect(user.login).toBe('daniyar_s');

    expect(await sessionUser(old.token)).toBeNull();
    await expectErr(auth.login('daniyar_s', 'secret1!', ctx), 'password');
    expect((await auth.login('d@mail.ru', 'newpass1', ctx)).user.login).toBe('daniyar_s');

    // По почте — так же.
    await afterPause();
    await auth.startRecover('D@mail.ru', ctx);
    expect(mails.at(-1)!.to).toBe('d@mail.ru');
  });

  it('не раскрывает, существует ли аккаунт', async () => {
    const s = await auth.startRecover('ghost_user', ctx);
    expect(s.challengeId).toMatch(/[0-9a-f-]{36}/);
    expect(mails).toHaveLength(0);
    await expectErr(auth.verifyRecover(s.challengeId, '482100'), 'code', /не совпал/);
    // Пауза одинакова для чужого логина или адреса и настоящего аккаунта — по ответу их не различить.
    await expectErr(auth.startRecover('ghost_user', ctx), undefined, /уже отправлено/);
    await auth.startRecover('ghost@mail.ru', ctx);
    await expectErr(auth.startRecover('ghost@mail.ru', ctx), undefined, /уже отправлено/);
    expect(mails).toHaveLength(0);
    await register(freelancer());
    await afterPause();
    await auth.startRecover('daniyar_s', ctx);
    await expectErr(auth.startRecover('daniyar_s', ctx), undefined, /уже отправлено/);
  });
});

describe('смена почты', () => {
  it('нужен пароль и код на новый адрес; прежний адрес получает предупреждение; вход — по новому', async () => {
    const { user } = await register(freelancer());
    await register(employer());
    await expectErr(auth.startEmailChange(user.id, { email: 'new@mail.ru', password: 'wrong-pass' }, ctx), 'password', /Неверный пароль/);
    await expectErr(auth.startEmailChange(user.id, { email: 'D@mail.ru', password: 'secret1!' }, ctx), 'email', /текущий адрес/);
    await expectErr(auth.startEmailChange(user.id, { email: 'a@mail.ru', password: 'secret1!' }, ctx), 'email', /уже зарегистрирована/);
    await expectErr(auth.startEmailChange(user.id, { email: 'nope', password: 'secret1!' }, ctx), 'email', /опечатка/);

    const s = await auth.startEmailChange(user.id, { email: 'new@mail.ru', password: 'secret1!' }, ctx);
    expect(mails.at(-1)).toMatchObject({ to: 'new@mail.ru', subject: expect.stringMatching(/смены почты \d{6}$/) });
    const other = await one<{ id: string }>(`SELECT id FROM users WHERE login = 'aigul_t'`);
    await expectErr(auth.verifyEmailChange(other!.id, s.challengeId, lastCode()), undefined, /другому аккаунту/);
    await expectErr(auth.verifyEmailChange(user.id, s.challengeId, wrong()), 'code', /не совпал/);
    expect(await auth.verifyEmailChange(user.id, s.challengeId, lastCode())).toEqual({ email: 'new@mail.ru' });

    const warn = await one<{ to_addr: string; body: string }>(`SELECT to_addr, body FROM notification_outbox WHERE user_id = $1 AND channel = 'email'`, [user.id]);
    expect(warn).toMatchObject({ to_addr: 'd@mail.ru', body: expect.stringContaining('new@mail.ru') });
    expect((await auth.login('new@mail.ru', 'secret1!', ctx)).user.id).toBe(user.id);
    await expectErr(auth.login('d@mail.ru', 'secret1!', ctx), 'identifier', /не найден/);
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
