// Авторизация: регистрация (4 шага, код в письме), вход по почте или логину, восстановление пароля и смена почты —
// кодом из письма. Вход через Яндекс ID / VK ID — server/oauth.ts. Телефон не собирается, звонков и SMS нет.
// Все правила из README проверяются здесь — клиентские проверки только для удобства.
import crypto from 'node:crypto';
import { findBadField } from '@/lib/moderation';
import { cityPoint } from '@/lib/city-point';
import {
  EMAIL_RE, parseIdentifier, sanitizeSignup, signupTextFields, takenMessage, unreachableEmail, UNREACHABLE_EMAIL_MSG,
  validateContacts, validateProfile, type Role, type SignupInput
} from '@/lib/validation';
import { config } from './config';
import { one, pool, query, tx, type Db } from './db';
import { AppError, ModerationError } from './errors';
import { geoSearch, placeLabel } from './geo';
import { passwordProblem } from '@/lib/password-policy';
import { dummyHash, hashPassword, verifyPassword } from './password';
import { hit, limitOrThrow, refund, used } from './rate-limit';
import { createSession, deleteUserSessions, type Ctx } from './session';
import { CODE_LEN, codeMatches, hashCode, randomCode, sendCodeEmail, type CodePurpose } from './codes';
import { consumeTicket, loadTicket, type Ticket } from './oauth';

export const CODE_TTL_MIN = 10;
// Новое письмо с кодом на один адрес — не чаще раза в минуту, по всем сценариям сразу:
// новая регистрация, восстановление или «Прислать ещё раз» паузу не обходят.
export const RESEND_SEC = 60;
export const MAX_ATTEMPTS = 3;
export const MAX_SENDS = 5;
export const RECOVER_WINDOW_MIN = 15;
// Подбор кода по адресу ограничен суточно, по всем запросам кода сразу:
// иначе новые коды каждые несколько минут дают десятки попыток в час и захват аккаунта через восстановление.
export const CODE_FAILS_PER_DAY = 10;
// Писем с кодом на один адрес в сутки — защита от рассылки на чужую почту.
export const EMAILS_PER_DAY = 10;
const DAY = 86400;
const TOO_MANY_FAILS = 'Слишком много неверных кодов для этого адреса — попробуйте завтра или напишите в поддержку.';
const EMAIL_SQL = "lower(email) = lower($1) AND email <> ''";

/** Ключ адреса для пауз и лимитов. */
const emailKey = (email: string) => 'e:' + email.trim().toLowerCase();

const waitLabel = (sec: number) => {
  const m = Math.floor(sec / 60), r = sec % 60;
  return [m ? m + ' мин' : '', r ? r + ' с' : ''].filter(Boolean).join(' ') || '1 с';
};

/**
 * Пауза между письмами с кодом на один адрес. Счётчик — через пул, не в транзакции запроса:
 * откат не должен снимать паузу после уже отправленного письма.
 */
async function codeGap(key: string) {
  const r = await hit('code:gap:' + key, 1, RESEND_SEC, pool());
  if (!r.ok) throw new AppError(429, 'Письмо с кодом уже отправлено — новое можно запросить через ' + waitLabel(r.retryAfter) + '.', undefined, { retryAfter: r.retryAfter });
}

/** Письмо с кодом: пауза минута и суточный лимит на адрес (по всем сценариям). */
async function sendCode(email: string, purpose: CodePurpose, db?: Db): Promise<string> {
  const key = emailKey(email);
  await codeGap(key);
  await limitOrThrow('code:day:' + key, EMAILS_PER_DAY, DAY, 'На этот адрес сегодня уже отправлено много писем с кодом — попробуйте завтра.', db);
  const code = randomCode();
  try {
    await sendCodeEmail(email, purpose, code, CODE_TTL_MIN);
  } catch (e) {
    // Письмо не ушло — пауза не нужна, можно сразу попробовать ещё раз.
    await refund('code:gap:' + key, pool());
    throw e;
  }
  return code;
}

type ChallengeRow = {
  id: string;
  purpose: CodePurpose;
  email: string | null;          // куда ушёл код; null — «пустое» восстановление несуществующего аккаунта
  target_key: string;
  user_id: string | null;
  payload: StoredSignup | null;
  code_hash: string | null;
  attempts: number;
  sent_count: number;
  last_sent_at: Date;
  expires_at: Date;
  verified_at: Date | null;
  consumed_at: Date | null;
};

type StoredSignup = Omit<SignupInput, 'password'> & { passwordHash: string; oauthFlow?: string };

export type CodeSent = {
  challengeId: string;
  sentTo: string;
  resendIn: number;
  expiresInSec: number;
  devCode?: string;
};

const devCode = (code: string) => (!config.isProd && config.emailProvider() === 'console' ? { devCode: code } : {});

function moderate(fields: { field: string; label: string; value: unknown }[]) {
  const hit = findBadField(fields);
  if (hit) throw new ModerationError(hit.field, hit.label, hit.category);
}

async function roleTaken(email: string, login: string, db: Db): Promise<{ by: 'email' | 'login'; role: Role } | null> {
  const byEmail = email ? await one<{ role: Role }>('SELECT role FROM users WHERE ' + EMAIL_SQL, [email], db) : null;
  if (byEmail) return { by: 'email', role: byEmail.role };
  const byLogin = await one<{ role: Role }>('SELECT role FROM users WHERE lower(login) = lower($1)', [login], db);
  if (byLogin) return { by: 'login', role: byLogin.role };
  return null;
}

async function assertUnique(email: string, login: string, db: Db) {
  const t = await roleTaken(email, login, db);
  if (t) throw new AppError(409, takenMessage(t.by, t.role), t.by);
}

// ───────────────────────── Регистрация ─────────────────────────

/** Шаг 2 «Контакты»: обязательные поля, модерация и уникальность почты/логина в любой роли. */
export async function checkContacts(raw: unknown, db: Db = pool()) {
  const s = sanitizeSignup(withOAuthPassword(raw));
  const err = validateContacts(s);
  if (err) throw new AppError(422, err.message, err.field);
  moderate(signupTextFields({ ...s, freelancer: undefined, employer: undefined }));
  await assertUnique(s.email, s.login, db);
  return { ok: true };
}

/** Шаги 2–3 целиком → письмо с кодом (шаг 4). Пользователь создаётся только после кода. */
export async function startSignup(raw: unknown, ctx: Ctx, db: Db = pool(), nonce?: string): Promise<CodeSent> {
  // После «Войти через…», когда сервис не дал почту или человек вписал другую: адрес подтверждается кодом, как обычно.
  const ticketRaw = (raw as Record<string, unknown> | null)?.oauthTicket;
  const ticket = typeof ticketRaw === 'string' && ticketRaw ? await loadTicket(ticketRaw, nonce, db) : null;
  const s = sanitizeSignup(withOAuthPassword(raw));
  const err = validateContacts(s) || validateProfile(s.role, s);
  if (err) throw new AppError(422, err.message, err.field);
  moderate(signupTextFields(s));
  await assertUnique(s.email, s.login, db);

  const key = emailKey(s.email);
  await limitOrThrow(`code:signup:${key}`, 5, 3600, 'Слишком много запросов кода на этот адрес — попробуйте через час.', db);
  if (ctx.ip) await limitOrThrow(`code:ip:${ctx.ip}`, 30, 3600, 'Слишком много запросов кода — попробуйте позже.', db);

  const { password, ...rest } = s;
  const payload: StoredSignup = { ...rest, passwordHash: await hashPassword(password), ...(ticket ? { oauthFlow: ticket.id } : {}) };
  const row = await one<{ id: string }>(
    `INSERT INTO auth_challenges (purpose, email, target_key, payload, expires_at, ip)
     VALUES ('signup', $1, $2, $3, now() + make_interval(mins => $4), $5) RETURNING id`,
    [s.email, key, JSON.stringify(payload), CODE_TTL_MIN, ctx.ip ?? null],
    db
  );
  const code = await sendCode(s.email, 'signup', db);
  await query('UPDATE auth_challenges SET code_hash = $2 WHERE id = $1', [row!.id, hashCode(row!.id, code)], db);
  return { challengeId: row!.id, sentTo: s.email, resendIn: RESEND_SEC, expiresInSec: CODE_TTL_MIN * 60, ...devCode(code) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadChallenge(id: unknown, purpose: CodePurpose, db: Db, lock = false): Promise<ChallengeRow> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new AppError(400, 'Сессия подтверждения не найдена — начните заново.');
  const row = await one<ChallengeRow>(`SELECT * FROM auth_challenges WHERE id = $1 AND purpose = $2${lock ? ' FOR UPDATE' : ''}`, [id, purpose], db);
  if (!row || row.consumed_at) throw new AppError(410, 'Сессия подтверждения устарела — начните заново.');
  return row;
}

/** «Прислать код ещё раз». */
export async function resendCode(challengeId: unknown, purpose: CodePurpose, ctx: Ctx, db: Db = pool()): Promise<CodeSent> {
  const ch = await loadChallenge(challengeId, purpose, db);
  // Пауза одинакова для всех: и после неверных кодов, и для «пустого» восстановления —
  // иначе по ответу можно было бы понять, есть ли аккаунт.
  const wait = RESEND_SEC - Math.floor((Date.now() - ch.last_sent_at.getTime()) / 1000);
  if (wait > 0) throw new AppError(429, 'Письмо с кодом уже отправлено — новое можно запросить через ' + waitLabel(wait) + '.', 'code', { retryAfter: wait });
  if (ch.sent_count >= MAX_SENDS) throw new AppError(429, 'Слишком много попыток — начните заново через час.', 'code');
  await limitOrThrow(`code:resend:${ch.target_key}`, 8, 3600, 'Слишком много запросов кода на этот адрес — попробуйте через час.', db);

  const code = ch.email ? await sendCode(ch.email, purpose, db) : '';
  await query(
    `UPDATE auth_challenges SET code_hash = $2, attempts = 0, sent_count = sent_count + 1,
            last_sent_at = now(), expires_at = now() + make_interval(mins => $3) WHERE id = $1`,
    [ch.id, code ? hashCode(ch.id, code) : null, CODE_TTL_MIN],
    db
  );
  return {
    challengeId: ch.id, sentTo: purpose === 'recover' ? '' : ch.email ?? '',
    resendIn: RESEND_SEC, expiresInSec: CODE_TTL_MIN * 60, ...(code ? devCode(code) : {})
  };
}

/**
 * Проверка кода: 3 попытки на код, срок 10 минут.
 * Попытка списывается атомарно (UPDATE … WHERE attempts < 3) до сравнения — параллельными запросами лимит не обойти.
 */
async function checkCode(ch: ChallengeRow, code: unknown, db: Db) {
  const c = typeof code === 'string' ? code.replace(/\D/g, '') : '';
  if (ch.attempts >= MAX_ATTEMPTS) throw new AppError(422, 'Попытки исчерпаны — запросите новый код', 'code', { attemptsLeft: 0 });
  if (c.length < CODE_LEN) throw new AppError(422, 'Введите все шесть цифр из письма', 'code');
  if (ch.expires_at.getTime() < Date.now()) throw new AppError(422, 'Код устарел — запросите новый', 'code');
  const failKey = 'codefail:' + ch.target_key;
  if ((await used(failKey, DAY, db)) >= CODE_FAILS_PER_DAY) throw new AppError(429, TOO_MANY_FAILS, 'code', { attemptsLeft: 0 });
  const spent = await one<{ attempts: number }>(
    `UPDATE auth_challenges SET attempts = attempts + 1
      WHERE id = $1 AND attempts < $2 AND consumed_at IS NULL AND code_hash IS NOT DISTINCT FROM $3
      RETURNING attempts`,
    [ch.id, MAX_ATTEMPTS, ch.code_hash],
    db
  );
  // Нет строки: попытки кончились параллельно или код успели перевыпустить — сравнивать не с чем.
  if (!spent) throw new AppError(422, 'Попытки исчерпаны — запросите новый код', 'code', { attemptsLeft: 0 });
  if (!codeMatches(ch.id, c, ch.code_hash)) {
    const day = await hit(failKey, CODE_FAILS_PER_DAY, DAY, db);
    if (!day.ok) throw new AppError(429, TOO_MANY_FAILS, 'code', { attemptsLeft: 0 });
    const left = MAX_ATTEMPTS - spent.attempts;
    throw new AppError(422, left > 0 ? 'Код не совпал — осталось попыток: ' + left : 'Попытки исчерпаны — запросите новый код', 'code', { attemptsLeft: left });
  }
}

export type PublicUser = {
  id: string; role: Role; login: string; email: string; name: string; city: string;
  baseLat: number | null; baseLng: number | null; avatarUrl: string | null; createdAt: string;
};

export function publicUser(u: {
  id: string; role: Role; login: string; email: string; name: string; city: string;
  base_lat: number | null; base_lng: number | null; avatar_url: string | null; created_at: Date;
}): PublicUser {
  return {
    id: u.id, role: u.role, login: u.login, email: u.email, name: u.name, city: u.city,
    baseLat: u.base_lat, baseLng: u.base_lng, avatarUrl: u.avatar_url, createdAt: u.created_at.toISOString()
  };
}

const USER_COLS = 'id, role, login, email, name, city, base_lat, base_lng, avatar_url, created_at';

function assertAccepted(accepted: { offer?: unknown; pd?: unknown }) {
  if (accepted.offer !== true) throw new AppError(422, 'Без принятия оферты аккаунт создать нельзя — отметьте галочку.', 'offer');
  if (accepted.pd !== true) throw new AppError(422, 'Без согласия на обработку персональных данных аккаунт создать нельзя — отметьте галочку.', 'pdConsent');
}

type Base = { lat: number; lng: number; label: string | null };

/**
 * База нового пользователя — от неё расстояния на карте и оповещения «рядом». Город из списка — его центр;
 * посёлка в списке нет — ищем геокодером (подпись с регионом: видно, та ли Ивановка). Не нашли или геокодер
 * недоступен — без базы: в профиле попросим указать её самим. Вызывается до транзакции — запрос до 5 секунд.
 */
async function signupBase(city: string): Promise<Base | null> {
  const pt = cityPoint(city);
  if (pt) return { lat: pt[0], lng: pt[1], label: null };
  try {
    const hit = (await geoSearch(city, 1))[0];
    return hit ? { lat: hit.lat, lng: hit.lng, label: placeLabel(hit) } : null;
  } catch { return null; }
}

/** Аккаунт, профиль, настройки уведомлений — в транзакции регистрации. Почта уже подтверждена: кодом или сервисом входа. */
async function createAccount(p: StoredSignup, base: Base | null, db: Db) {
  await assertUnique(p.email, p.login, db);
  let user;
  try {
    user = await one<Parameters<typeof publicUser>[0]>(
      `INSERT INTO users (role, login, email, email_verified_at, password_hash, name, city, base_lat, base_lng, base_label, offer_accepted_at, offer_version, pd_consent_at, pd_consent_version)
       VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8, $9, now(), $10, now(), $11)
       RETURNING ${USER_COLS}`,
      [p.role, p.login, p.email, p.passwordHash, p.name, p.city, base?.lat ?? null, base?.lng ?? null, base?.label ?? null, config.offerVersion, config.pdConsentVersion],
      db
    );
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      const by = String((e as { constraint?: string }).constraint).includes('email') ? 'email' : 'login';
      throw new AppError(409, takenMessage(by, p.role), by);
    }
    throw e;
  }
  const uid = user!.id;
  if (p.role === 'freelancer') {
    const f = p.freelancer!;
    await query(
      `INSERT INTO freelancer_profiles (user_id, skills, custom_skills, gear, custom_gear, own_car, work_cities)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uid, f.skills, f.customSkills, f.gear, f.customGear, f.ownCar, f.workCities],
      db
    );
  } else {
    const e = p.employer!;
    await query(
      `INSERT INTO employer_profiles (user_id, org_type, org_name, object_kind, object_other, access, tools, meet_name, meet_phone, pass_mode, pass_whom, safety_req)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [uid, e.orgType, e.orgName || null, e.objectKind, e.objectOther || null, e.access, e.tools, e.meetName || null, e.meetPhone || null, e.passMode || null, e.passWhom || null, e.safetyReq],
      db
    );
  }
  await query('INSERT INTO notification_settings (user_id) VALUES ($1)', [uid], db);
  await query(`INSERT INTO events (user_id, kind, text) VALUES ($1, 'account', 'Аккаунт создан')`, [uid], db);
  return user!;
}

/** Шаг 4: код из письма + две отдельные галочки (оферта; согласие на обработку ПДн) → аккаунт и сессия. */
export async function verifySignup(challengeId: unknown, code: unknown, accepted: { offer?: unknown; pd?: unknown }, ctx: Ctx) {
  assertAccepted(accepted);
  const pre = await loadChallenge(challengeId, 'signup', pool());
  await checkCode(pre, code, pool());
  const base = await signupBase(pre.payload!.city);

  return tx(async (db) => {
    const ch = await loadChallenge(challengeId, 'signup', db, true);
    const p = ch.payload!;
    // Регистрация после «Войти через…» с другой почтой: билет проверен при отправке кода, здесь — ещё жив?
    const ticket = p.oauthFlow ? await ticketById(p.oauthFlow, db) : null;
    const user = await createAccount(p, base, db);
    if (ticket) await consumeTicket(ticket, user.id, db);
    await query('UPDATE auth_challenges SET consumed_at = now(), verified_at = now(), payload = NULL WHERE id = $1', [ch.id], db);
    const session = await createSession(user.id, ctx, db);
    return { user: publicUser(user), session };
  });
}

/** Билет «Войти через…» по id записи (сохранён в анкете при отправке кода): не использован и не истёк. */
async function ticketById(id: string, db: Db): Promise<Ticket> {
  const t = await one<Ticket>(
    'SELECT id, profile FROM oauth_flows WHERE id = $1 AND used_at IS NULL AND expires_at > now() AND profile IS NOT NULL FOR UPDATE', [id], db);
  if (!t) throw new AppError(410, 'Вход через сервис устарел — нажмите кнопку входа ещё раз.');
  return t;
}

/** Пароль при регистрации через Яндекс ID / VK ID необязателен: входят через сервис, а пароль можно задать восстановлением. */
function withOAuthPassword(raw: unknown): unknown {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof r.oauthTicket !== 'string' || !r.oauthTicket || (typeof r.password === 'string' && r.password)) return raw;
  return { ...r, password: crypto.randomBytes(18).toString('base64url') + '-Aa1' };
}

/**
 * Регистрация после «Войти через…» с почтой от сервиса: без кода (адрес подтвердил сервис).
 * Другая почта — только через код (startSignup). Билет — одноразовый и только в браузере, начавшем вход.
 */
export async function oauthSignup(raw: unknown, accepted: { offer?: unknown; pd?: unknown }, nonce: string | undefined, ctx: Ctx) {
  assertAccepted(accepted);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pre = await loadTicket(r.oauthTicket, nonce);
  const s = sanitizeSignup(withOAuthPassword(r));
  const err = validateContacts(s) || validateProfile(s.role, s);
  if (err) throw new AppError(422, err.message, err.field);
  if (!pre.profile.email || pre.profile.email.trim().toLowerCase() !== s.email.toLowerCase()) {
    throw new AppError(409, 'Этот адрес не подтверждён в ' + (pre.profile.provider === 'vk' ? 'VK ID' : 'Яндекс ID') + ' — подтвердите его кодом из письма.', 'email');
  }
  moderate(signupTextFields(s));
  if (ctx.ip) await limitOrThrow(`oauthsignup:ip:${ctx.ip}`, 20, 3600, 'Слишком много регистраций — попробуйте позже.');
  const { password, ...rest } = s;
  const p: StoredSignup = { ...rest, passwordHash: await hashPassword(password) };
  const base = await signupBase(p.city);
  return tx(async (db) => {
    const ticket = await loadTicket(r.oauthTicket, nonce, db, true);
    const user = await createAccount(p, base, db);
    await consumeTicket(ticket, user.id, db);
    const session = await createSession(user.id, ctx, db);
    return { user: publicUser(user), session };
  });
}

// ───────────────────────── Вход ─────────────────────────

export async function login(identifier: unknown, password: unknown, ctx: Ctx) {
  const id = parseIdentifier(typeof identifier === 'string' ? identifier : '');
  if (id.kind === 'invalid') throw new AppError(422, id.message, 'identifier');
  const pass = typeof password === 'string' ? password : '';
  if (pass.length < 6) throw new AppError(422, 'Пароль — не короче 6 символов.', 'password');

  // Попытка на аккаунт списывается атомарно до проверки пароля — пачкой параллельных запросов лимит не обойти;
  // успешный вход владельца её возвращает, бюджет тратят только неудачные.
  const idKey = 'login:id:' + (id.kind === 'email' ? emailKey(id.email) : 'l:' + id.login.toLowerCase());
  const TOO_MANY = 'Слишком много попыток входа — подождите 15 минут или восстановите пароль.';
  if (ctx.ip) await limitOrThrow(`login:ip:${ctx.ip}`, 60, 900, 'Слишком много попыток входа — подождите 15 минут.');
  const gate = await hit(idKey, 10, 900);
  if (!gate.ok) throw new AppError(429, TOO_MANY, undefined, { retryAfter: gate.retryAfter });

  const user = await one<Parameters<typeof publicUser>[0] & { password_hash: string; status: string }>(
    `SELECT ${USER_COLS}, password_hash, status FROM users WHERE ${id.kind === 'email' ? EMAIL_SQL : 'lower(login) = lower($1)'}`,
    [id.kind === 'email' ? id.email : id.login]
  );
  if (!user) {
    await verifyPassword(pass, await dummyHash());
    throw new AppError(404, 'Аккаунт с ' + (id.kind === 'email' ? 'такой почтой' : 'таким логином') + ' не найден. Проверьте написание или зарегистрируйтесь.', 'identifier');
  }
  if (!(await verifyPassword(pass, user.password_hash))) {
    throw new AppError(401, 'Неверный пароль. Проверьте раскладку или восстановите доступ.', 'password');
  }
  await refund(idKey);
  if (user.status === 'blocked') throw new AppError(403, 'Аккаунт заблокирован за нарушение правил площадки. Напишите в поддержку.');
  const session = await createSession(user.id, ctx);
  return { user: publicUser(user), session };
}

// ───────────────────────── Восстановление пароля ─────────────────────────

/** Код на почту аккаунта. Не раскрываем, существует ли аккаунт: для чужого адреса или логина — «пустой» вызов. */
export async function startRecover(identifier: unknown, ctx: Ctx): Promise<CodeSent> {
  const raw = typeof identifier === 'string' ? identifier.trim() : '';
  if (!raw) throw new AppError(422, 'Укажите почту или логин аккаунта — код придёт на почту аккаунта.', 'identifier');
  const id = parseIdentifier(raw);
  if (id.kind === 'invalid') throw new AppError(422, id.message, 'identifier');
  // Код на Proton не дойдёт (lib/validation.ts) — сразу говорим, куда писать. Существует ли аккаунт, этим не раскрываем.
  if (id.kind === 'email' && unreachableEmail(id.email)) {
    throw new AppError(422, 'На почту Proton письма с кодом не доходят. Напишите в поддержку на ' + config.supportEmail() + ' — укажите логин, поможем войти.', 'identifier');
  }
  if (ctx.ip) await limitOrThrow(`recover:ip:${ctx.ip}`, 20, 3600, 'Слишком много запросов — попробуйте позже.');

  const user = await one<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE ${id.kind === 'email' ? EMAIL_SQL : 'lower(login) = lower($1)'} AND status <> 'deleted'`,
    [id.kind === 'email' ? id.email : id.login]
  );
  const key = user ? emailKey(user.email) : id.kind === 'email' ? emailKey(id.email) : 'l:' + id.login.toLowerCase();
  await limitOrThrow(`recover:${key}`, 5, 3600, 'Слишком много запросов кода — попробуйте через час.');

  const row = await one<{ id: string }>(
    `INSERT INTO auth_challenges (purpose, email, target_key, user_id, expires_at, ip)
     VALUES ('recover', $1, $2, $3, now() + make_interval(mins => $4), $5) RETURNING id`,
    [user?.email ?? null, key, user?.id ?? null, CODE_TTL_MIN, ctx.ip ?? null]
  );
  let extra = {};
  // Для несуществующего аккаунта пауза та же, что для настоящего адреса, — ответы не различаются.
  if (!user) await codeGap(key);
  if (user) {
    const code = await sendCode(user.email, 'recover');
    await query('UPDATE auth_challenges SET code_hash = $2 WHERE id = $1', [row!.id, hashCode(row!.id, code)]);
    extra = devCode(code);
  }
  return { challengeId: row!.id, sentTo: raw, resendIn: RESEND_SEC, expiresInSec: CODE_TTL_MIN * 60, ...extra };
}

export async function verifyRecover(challengeId: unknown, code: unknown) {
  const ch = await loadChallenge(challengeId, 'recover', pool());
  await checkCode(ch, code, pool());
  await query('UPDATE auth_challenges SET verified_at = now() WHERE id = $1', [ch.id]);
  return { ok: true };
}

export async function completeRecover(challengeId: unknown, password: unknown, password2: unknown, ctx: Ctx) {
  const p1 = typeof password === 'string' ? password : '';
  const p2 = typeof password2 === 'string' ? password2 : '';
  const bad = passwordProblem(p1);
  if (bad) throw new AppError(422, bad, 'password');
  if (p1 !== p2) throw new AppError(422, 'Пароли не совпали — проверьте второе поле.', 'password2');
  const hash = await hashPassword(p1);
  return tx(async (db) => {
    const ch = await loadChallenge(challengeId, 'recover', db, true);
    if (!ch.verified_at || !ch.user_id || Date.now() - ch.verified_at.getTime() > RECOVER_WINDOW_MIN * 60_000) {
      throw new AppError(410, 'Подтверждение устарело — запросите код заново.');
    }
    const user = await one<Parameters<typeof publicUser>[0] & { status: string }>(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1
       RETURNING ${USER_COLS}, status`,
      [ch.user_id, hash],
      db
    );
    await query('UPDATE auth_challenges SET consumed_at = now() WHERE id = $1', [ch.id], db);
    await deleteUserSessions(ch.user_id, db);   // старый пароль и все старые входы перестают работать
    await query(`INSERT INTO events (user_id, kind, text) VALUES ($1, 'account', 'Пароль изменён через восстановление')`, [ch.user_id], db);
    if (user!.status === 'blocked') throw new AppError(403, 'Аккаунт заблокирован за нарушение правил площадки. Напишите в поддержку.');
    const session = await createSession(ch.user_id, ctx, db);
    return { user: publicUser(user!), session };
  });
}

// ───────────────────────── Смена почты и пароля ─────────────────────────

/** Новая почта подтверждается кодом на неё же; нужен текущий пароль. */
export async function startEmailChange(userId: string, raw: unknown, ctx: Ctx): Promise<CodeSent> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const email = typeof r.email === 'string' ? r.email.trim().slice(0, 200) : '';
  if (!EMAIL_RE.test(email)) throw new AppError(422, 'Проверьте e-mail — похоже, в адресе опечатка.', 'email');
  if (unreachableEmail(email)) throw new AppError(422, UNREACHABLE_EMAIL_MSG, 'email');
  const me = await one<{ password_hash: string; email: string }>('SELECT password_hash, email FROM users WHERE id = $1', [userId]);
  if (!me) throw new AppError(401, 'Нужно войти в аккаунт.');
  if (me.email.toLowerCase() === email.toLowerCase()) throw new AppError(422, 'Это ваш текущий адрес.', 'email');
  if (!(await verifyPassword(typeof r.password === 'string' ? r.password : '', me.password_hash))) throw new AppError(401, 'Неверный пароль.', 'password');
  moderate([{ field: 'email', label: 'E-mail', value: email }]);
  const taken = await one<{ role: Role }>('SELECT role FROM users WHERE ' + EMAIL_SQL, [email]);
  if (taken) throw new AppError(409, takenMessage('email', taken.role), 'email');
  const key = emailKey(email);
  await limitOrThrow(`code:email:${key}`, 5, 3600, 'Слишком много запросов кода на этот адрес — попробуйте через час.');
  const row = await one<{ id: string }>(
    `INSERT INTO auth_challenges (purpose, email, target_key, user_id, expires_at, ip)
     VALUES ('email', $1, $2, $3, now() + make_interval(mins => $4), $5) RETURNING id`,
    [email, key, userId, CODE_TTL_MIN, ctx.ip ?? null]);
  const code = await sendCode(email, 'email');
  await query('UPDATE auth_challenges SET code_hash = $2 WHERE id = $1', [row!.id, hashCode(row!.id, code)]);
  return { challengeId: row!.id, sentTo: email, resendIn: RESEND_SEC, expiresInSec: CODE_TTL_MIN * 60, ...devCode(code) };
}

/** Код верный — адрес меняется (и сразу подтверждён); на прежний уходит предупреждение. */
export async function verifyEmailChange(userId: string, challengeId: unknown, code: unknown) {
  const pre = await loadChallenge(challengeId, 'email', pool());
  if (pre.user_id !== userId) throw new AppError(403, 'Подтверждение относится к другому аккаунту.');
  await checkCode(pre, code, pool());
  return tx(async (db) => {
    const ch = await loadChallenge(challengeId, 'email', db, true);
    const next = ch.email!;
    const taken = await one<{ id: string; role: Role }>('SELECT id, role FROM users WHERE ' + EMAIL_SQL, [next], db);
    if (taken && taken.id !== userId) throw new AppError(409, takenMessage('email', taken.role), 'email');
    const old = await one<{ email: string }>('SELECT email FROM users WHERE id = $1 FOR UPDATE', [userId], db);
    await query('UPDATE users SET email = $2, email_verified_at = now(), updated_at = now() WHERE id = $1', [userId, next], db);
    await query('UPDATE auth_challenges SET consumed_at = now(), verified_at = now() WHERE id = $1', [ch.id], db);
    await query(`INSERT INTO events (user_id, kind, text, read_at) VALUES ($1, 'account', $2, now())`, [userId, 'Почта аккаунта изменена на ' + next], db);
    if (old?.email) {
      await query(`INSERT INTO notification_outbox (user_id, channel, to_addr, subject, body) VALUES ($1, 'email', $2, $3, $4)`, [
        userId, old.email, 'Арена Работ: почта аккаунта изменена',
        'Адрес почты в вашем аккаунте изменён на ' + next + '. Входить и восстанавливать пароль теперь нужно по новому адресу.\n\n' +
          'Если это сделали не вы — сразу напишите в поддержку: ' + config.supportEmail() + '.'
      ], db);
    }
    return { email: next };
  });
}

/** Смена пароля: нужен текущий; остальные входы (другие устройства) завершаются. */
export async function changePassword(userId: string, raw: unknown, keepSessionId: string | null) {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const next = typeof r.password === 'string' ? r.password : '';
  const bad = passwordProblem(next);
  if (bad) throw new AppError(422, bad, 'password');
  if (next !== r.password2) throw new AppError(422, 'Пароли не совпали — проверьте второе поле.', 'password2');
  const me = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!me || !(await verifyPassword(typeof r.current === 'string' ? r.current : '', me.password_hash))) throw new AppError(401, 'Текущий пароль неверный.', 'current');
  const hash = await hashPassword(next);
  await tx(async (db) => {
    await query('UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1', [userId, hash], db);
    await query('DELETE FROM sessions WHERE user_id = $1 AND id IS DISTINCT FROM $2', [userId, keepSessionId], db);
    await query(`INSERT INTO events (user_id, kind, text) VALUES ($1, 'account', 'Пароль изменён — другие входы завершены')`, [userId], db);
  });
  return { ok: true };
}

// ───────────────────────── Профиль текущего пользователя ─────────────────────────

export async function loadProfile(userId: string, role: Role) {
  if (role === 'freelancer') {
    const r = await one<{ skills: string[]; custom_skills: string[]; gear: string[]; custom_gear: string[]; own_car: boolean; work_cities: string[];
      inn: string | null; npd_status: 'ok' | 'not_found' | null; npd_checked_at: Date | null }>(
      'SELECT skills, custom_skills, gear, custom_gear, own_car, work_cities, inn, npd_status, npd_checked_at FROM freelancer_profiles WHERE user_id = $1', [userId]);
    return r && {
      skills: r.skills, customSkills: r.custom_skills, gear: r.gear, customGear: r.custom_gear, ownCar: r.own_car, workCities: r.work_cities,
      npd: { inn: r.inn, status: r.npd_status, checkedAt: r.npd_checked_at ? r.npd_checked_at.toISOString() : null }
    };
  }
  const r = await one<Record<string, unknown>>(
    `SELECT org_type, org_name, object_kind, object_other, access, tools, meet_name, meet_phone, pass_mode, pass_whom, safety_req
       FROM employer_profiles WHERE user_id = $1`, [userId]);
  return r && {
    orgType: r.org_type, orgName: r.org_name, objectKind: r.object_kind, objectOther: r.object_other, access: r.access, tools: r.tools,
    meetName: r.meet_name, meetPhone: r.meet_phone, passMode: r.pass_mode, passWhom: r.pass_whom, safetyReq: r.safety_req
  };
}

// ───────────────────────── Счётчики на экране входа ─────────────────────────

/** Снимок раз в сутки: внутри дня цифры не меняются. Пересчёт пользователей — один раз за день, дальше чтение по ключу. */
export async function platformStats(db: Db = pool()) {
  type Row = { day: Date; freelancers: number; employers: number };
  let row = await one<Row>('SELECT day, freelancers, employers FROM daily_stats WHERE day = current_date', [], db);
  if (!row) {
    row = await one<Row>(
      `INSERT INTO daily_stats (day, freelancers, employers)
       SELECT current_date, count(*) FILTER (WHERE role = 'freelancer'), count(*) FILTER (WHERE role = 'employer') FROM users WHERE status <> 'deleted'
       ON CONFLICT (day) DO NOTHING
       RETURNING day, freelancers, employers`,
      [],
      db
    ) ?? await one<Row>('SELECT day, freelancers, employers FROM daily_stats WHERE day = current_date', [], db);
  }
  const d = row?.day ?? new Date();
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { freelancers: row?.freelancers ?? 0, employers: row?.employers ?? 0, day: iso };
}
