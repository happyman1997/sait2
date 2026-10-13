// Вход через Яндекс ID и VK ID: сервисы подменены (setOAuthFetch), база — настоящий Postgres.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';
process.env.SMS_DEV_FIXED_CODE = '';
process.env.PUBLIC_URL = 'https://arenarabot.ru';
process.env.YANDEX_CLIENT_ID = 'ya-client';
process.env.YANDEX_CLIENT_SECRET = 'ya-secret';
process.env.VK_CLIENT_ID = '51000000';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const { setCodeSender } = await import('@/server/sms');
const auth = await import('@/server/auth');
const oauth = await import('@/server/oauth');
const { AppError } = await import('@/server/errors');

const nextCode = '4821';
setCodeSender({ async send() { return { code: nextCode }; }, async sendText() {} });
const ctx = { ip: '10.0.0.2', userAgent: 'vitest' };

// Ответы «сервисов»: что вернут на обмен кода и на запрос профиля.
let yandexUser: Record<string, unknown> = {};
let vkUser: Record<string, unknown> = {};
const calls: { url: string; body: string }[] = [];
oauth.setOAuthFetch(async (url, init) => {
  calls.push({ url, body: String(init?.body ?? '') });
  const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://oauth.yandex.ru/token')) return ok({ access_token: 'ya-token' });
  if (url.startsWith('https://login.yandex.ru/info')) return ok(yandexUser);
  if (url.startsWith('https://id.vk.com/oauth2/auth')) return ok({ access_token: 'vk-token', user_id: vkUser.user_id });
  if (url.startsWith('https://id.vk.com/oauth2/user_info')) return ok({ user: vkUser });
  return new Response('nope', { status: 404 });
});

/** Нажал «Войти через…» и вернулся от сервиса в том же браузере. */
async function roundTrip(p: 'yandex' | 'vk', opts: { intent?: 'login' | 'link'; userId?: string | null; viewerId?: string | null; nonce?: string } = {}) {
  const s = await oauth.startOAuth(p, opts.intent ?? 'login', opts.userId ?? null, null, ctx);
  const state = new URL(s.url).searchParams.get('state')!;
  const params = new URLSearchParams({ code: 'auth-code', state, ...(p === 'vk' ? { device_id: 'dev-1' } : {}) });
  const r = await oauth.finishOAuth(p, params, opts.nonce ?? s.nonce, opts.viewerId ?? null);
  return { r, nonce: s.nonce, url: s.url };
}

const profileFields = (over: Record<string, unknown> = {}) => ({
  role: 'freelancer', name: 'Ольга Кузнецова', login: 'olga_k', email: 'olga@yandex.ru', city: 'Москва',
  freelancer: { skills: ['snow'], customSkills: [], gear: [], customGear: [], ownCar: false, workCities: ['Москва'] },
  ...over
});

async function expectErr(p: Promise<unknown>, text: RegExp, status?: number) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as Error).message).toMatch(text);
    if (status) expect((e as InstanceType<typeof AppError>).status).toBe(status);
    return;
  }
  throw new Error('ожидалась ошибка');
}

beforeAll(async () => {
  await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool(), undefined, () => {});
});

beforeEach(async () => {
  await query('TRUNCATE users, auth_challenges, rate_limits, oauth_flows, notification_outbox CASCADE');
  calls.length = 0;
  yandexUser = { id: 'ya-1001', first_name: 'Ольга', last_name: 'Кузнецова', default_email: 'olga@yandex.ru', default_phone: { id: 1, number: '+79163333333' } };
  vkUser = { user_id: '777', first_name: 'Иван', last_name: 'Петров', phone: '79164444444', email: 'ivan@vk.com' };
});

afterAll(async () => {
  oauth.setOAuthFetch(null);
  await pool().end();
});

describe('вход через Яндекс ID и VK ID', () => {
  it('кнопки — только у настроенных сервисов; адрес сервиса с PKCE и state', async () => {
    expect(oauth.enabledProviders()).toEqual(['yandex', 'vk']);
    const { url } = await oauth.startOAuth('yandex', 'login', null, null, ctx);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://oauth.yandex.ru/authorize');
    expect(u.searchParams.get('redirect_uri')).toBe('https://arenarabot.ru/api/auth/oauth/yandex/callback');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    // В базе — только хэш state, не он сам.
    expect(await one('SELECT 1 FROM oauth_flows WHERE state_hash::text LIKE $1', ['%' + u.searchParams.get('state') + '%'])).toBeNull();
    await expectErr(oauth.startOAuth('yandex', 'link', null, null, ctx), /войти/i, 401);
  });

  it('новый человек: анкета с данными сервиса, без кода; почта подтверждена, повторно билет не работает', async () => {
    const { r, nonce } = await roundTrip('yandex');
    expect(r.kind).toBe('signup');
    const ticket = (r as { ticket: string }).ticket;
    expect(await oauth.ticketInfo(ticket, nonce)).toMatchObject({ provider: 'yandex', name: 'Ольга Кузнецова', email: 'olga@yandex.ru', phone: '+7 916 333-33-33', phoneVerified: true });
    // В другом браузере билет не открывается.
    await expectErr(oauth.ticketInfo(ticket, 'чужой-браузер'), /устарел/, 410);
    await expectErr(auth.oauthSignup({ ...profileFields(), oauthTicket: ticket }, { offer: true }, nonce, ctx), /согласия/);

    // Телефон из формы игнорируется — берётся подтверждённый сервисом; пароль необязателен.
    const { user } = await auth.oauthSignup({ ...profileFields(), phone: '+7 900 000 00 00', oauthTicket: ticket }, { offer: true, pd: true }, nonce, ctx);
    expect(user).toMatchObject({ login: 'olga_k', phone: '+79163333333' });
    expect(await one('SELECT 1 FROM user_identities WHERE provider = $1 AND subject = $2 AND user_id = $3', ['yandex', 'ya-1001', user.id])).not.toBeNull();
    expect(await one('SELECT 1 FROM users WHERE id = $1 AND email_verified_at IS NOT NULL', [user.id])).not.toBeNull();
    expect(await one(`SELECT 1 FROM notification_outbox WHERE user_id = $1`, [user.id])).toBeNull(); // письмо «подтвердите» не нужно
    await expectErr(auth.oauthSignup({ ...profileFields({ login: 'olga_2' }), oauthTicket: ticket }, { offer: true, pd: true }, nonce, ctx), /устарел/, 410);

    // Следующий вход через Яндекс — сразу в аккаунт.
    const again = await roundTrip('yandex');
    expect(again.r).toEqual({ kind: 'login', userId: user.id, applyNum: null });
  });

  it('другая почта в анкете — письмо для подтверждения; оферта и согласие обязательны', async () => {
    const { r, nonce } = await roundTrip('vk');
    const ticket = (r as { ticket: string }).ticket;
    const { user } = await auth.oauthSignup({ ...profileFields({ login: 'ivan_p', name: 'Иван Петров', email: 'other@mail.ru' }), oauthTicket: ticket }, { offer: true, pd: true }, nonce, ctx);
    expect(user.phone).toBe('+79164444444');
    expect(await one('SELECT 1 FROM users WHERE id = $1 AND email_verified_at IS NULL', [user.id])).not.toBeNull();
    expect((await one<{ subject: string }>(`SELECT subject FROM notification_outbox WHERE user_id = $1`, [user.id]))!.subject).toMatch(/подтвердите e-mail/);
    // VK: обмен кода — с PKCE и device_id.
    expect(calls.find(c => c.url.startsWith('https://id.vk.com/oauth2/auth'))!.body).toMatch(/code_verifier=.+device_id=dev-1/);
  });

  it('телефон от сервиса уже зарегистрирован — тот же человек: привязка и вход', async () => {
    const s = await auth.startSignup({ ...profileFields({ login: 'ivan_old', name: 'Иван Петров', email: 'i@mail.ru' }), phone: '+7 916 444 44 44', password: 'Kosmos-2026!' }, ctx);
    const { user } = await auth.verifySignup(s.challengeId, '4821', { offer: true, pd: true }, ctx);
    const { r } = await roundTrip('vk');
    expect(r).toEqual({ kind: 'login', userId: user.id, applyNum: null });
    expect(await one('SELECT 1 FROM user_identities WHERE provider = $1 AND user_id = $2', ['vk', user.id])).not.toBeNull();
    // Заблокированного не пускает.
    await query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [user.id]);
    await expectErr(roundTrip('vk'), /заблокирован/, 403);
  });

  it('state одноразовый и только в своём браузере; отмена у сервиса — понятная ошибка', async () => {
    const s = await oauth.startOAuth('yandex', 'login', null, null, ctx);
    const state = new URL(s.url).searchParams.get('state')!;
    await expectErr(oauth.finishOAuth('yandex', new URLSearchParams({ code: 'c', state }), 'чужой', null), /устарела/);
    await oauth.finishOAuth('yandex', new URLSearchParams({ code: 'c', state }), s.nonce, null);
    await expectErr(oauth.finishOAuth('yandex', new URLSearchParams({ code: 'c', state }), s.nonce, null), /устарела/);
    await expectErr(oauth.finishOAuth('yandex', new URLSearchParams({ error: 'access_denied', state }), s.nonce, null), /отменён/);
  });

  it('сервис без телефона: номер подтверждается кодом, затем привязка', async () => {
    yandexUser = { id: 'ya-2002', first_name: 'Пётр', last_name: 'Сидоров', default_email: 'petr@yandex.ru' };
    const { r, nonce } = await roundTrip('yandex');
    const ticket = (r as { ticket: string }).ticket;
    expect(await oauth.ticketInfo(ticket, nonce)).toMatchObject({ phone: '', phoneVerified: false });
    await expectErr(auth.oauthSignup({ ...profileFields({ login: 'petr_s' }), oauthTicket: ticket }, { offer: true, pd: true }, nonce, ctx), /подтвердите номер/);
    // Обычная анкета с кодом; пароль не нужен — есть билет.
    const fields = { ...profileFields({ login: 'petr_s', name: 'Пётр Сидоров', email: 'petr@yandex.ru' }), phone: '+7 916 555 55 55', oauthTicket: ticket };
    await auth.checkContacts(fields);
    await expectErr(auth.startSignup(fields, ctx, pool(), 'чужой'), /устарел/, 410);
    const s = await auth.startSignup(fields, ctx, pool(), nonce);
    const { user } = await auth.verifySignup(s.challengeId, '4821', { offer: true, pd: true }, ctx);
    expect(await one('SELECT 1 FROM user_identities WHERE provider = $1 AND subject = $2 AND user_id = $3', ['yandex', 'ya-2002', user.id])).not.toBeNull();
    expect(await one('SELECT 1 FROM users WHERE id = $1 AND email_verified_at IS NOT NULL', [user.id])).not.toBeNull();
  });

  it('привязка из профиля и отвязка; чужой аккаунт сервиса не привязать', async () => {
    const mk = async (login: string, phone: string) => {
      const s = await auth.startSignup({ ...profileFields({ login, email: login + '@mail.ru' }), phone, password: 'Kosmos-2026!' }, ctx);
      return (await auth.verifySignup(s.challengeId, '4821', { offer: true, pd: true }, ctx)).user;
    };
    vkUser = { user_id: '888', first_name: 'Анна', last_name: 'Л', phone: '' };
    const a = await mk('anna_l', '+7 916 666 66 66');
    const b = await mk('boris_k', '+7 916 777 77 77');
    const linked = await roundTrip('vk', { intent: 'link', userId: a.id, viewerId: a.id });
    expect(linked.r).toEqual({ kind: 'linked', provider: 'vk' });
    expect(await oauth.identitiesOf(a.id)).toEqual(['vk']);
    await expectErr(roundTrip('vk', { intent: 'link', userId: b.id, viewerId: b.id }), /другому аккаунту/, 409);
    // Вход другим пользователем браузера, начавшего привязку, не срабатывает.
    await expectErr(roundTrip('vk', { intent: 'link', userId: a.id, viewerId: b.id }), /Войдите/, 401);
    expect(await oauth.unlinkIdentity(a.id, 'vk')).toEqual({ identities: [] });
  });
});
