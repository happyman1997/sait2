// Авторизация: регистрация (4 шага, код по SMS/звонку), вход по логину или телефону, восстановление пароля.
// Все правила из README проверяются здесь — клиентские проверки только для удобства.
import { findBadField } from '@/lib/moderation';
import { cityPoint } from '@/lib/catalog';
import {
  formatPhone, normalizePhone, parseIdentifier, phoneKey, sanitizeSignup, signupTextFields, takenMessage,
  validateContacts, validateProfile, type Role, type SignupInput
} from '@/lib/validation';
import { config } from './config';
import { one, pool, query, tx, type Db } from './db';
import { AppError, ModerationError } from './errors';
import { dummyHash, hashPassword, verifyPassword } from './password';
import { hit, limitOrThrow, refund } from './rate-limit';
import { createSession, deleteUserSessions, type Ctx } from './session';
import { codeMatches, codeSender, hashCode, type Channel } from './sms';

export const CODE_TTL_MIN = 5;
export const RESEND_SEC = 60;
export const MAX_ATTEMPTS = 3;
export const MAX_SENDS = 5;
export const RECOVER_WINDOW_MIN = 15;

type ChallengeRow = {
  id: string;
  purpose: 'signup' | 'recover' | 'phone';
  phone: string;
  phone_key: string;
  user_id: string | null;
  payload: StoredSignup | null;
  channel: Channel;
  code_hash: string | null;
  attempts: number;
  sent_count: number;
  last_sent_at: Date;
  expires_at: Date;
  verified_at: Date | null;
  consumed_at: Date | null;
};

type StoredSignup = Omit<SignupInput, 'password'> & { passwordHash: string };

export type CodeSent = {
  challengeId: string;
  channel: Channel;
  sentTo: string;
  resendIn: number;
  expiresInSec: number;
  devCode?: string;
};

const devCode = (code: string) => (!config.isProd && config.smsProvider() === 'console' ? { devCode: code } : {});

function moderate(fields: { field: string; label: string; value: unknown }[]) {
  const hit = findBadField(fields);
  if (hit) throw new ModerationError(hit.field, hit.label, hit.category);
}

async function roleTaken(pk: string | null, login: string, db: Db): Promise<{ by: 'phone' | 'login'; role: Role } | null> {
  const byPhone = pk ? await one<{ role: Role }>('SELECT role FROM users WHERE phone_key = $1', [pk], db) : null;
  if (byPhone) return { by: 'phone', role: byPhone.role };
  const byLogin = await one<{ role: Role }>('SELECT role FROM users WHERE lower(login) = lower($1)', [login], db);
  if (byLogin) return { by: 'login', role: byLogin.role };
  return null;
}

async function assertUnique(pk: string | null, login: string, db: Db) {
  const t = await roleTaken(pk, login, db);
  if (t) throw new AppError(409, takenMessage(t.by, t.role), t.by);
}

// ───────────────────────── Регистрация ─────────────────────────

/** Шаг 2 «Контакты»: обязательные поля, модерация и уникальность телефона/логина в любой роли. */
export async function checkContacts(raw: unknown, db: Db = pool()) {
  const s = sanitizeSignup(raw);
  const err = validateContacts(s);
  if (err) throw new AppError(422, err.message, err.field);
  moderate(signupTextFields({ ...s, freelancer: undefined, employer: undefined }));
  await assertUnique(phoneKey(s.phone), s.login, db);
  return { ok: true };
}

/** Шаги 2–3 целиком → отправка кода (шаг 4). Пользователь создаётся только после кода. */
export async function startSignup(raw: unknown, ctx: Ctx, db: Db = pool()): Promise<CodeSent> {
  const s = sanitizeSignup(raw);
  const err = validateContacts(s) || validateProfile(s.role, s);
  if (err) throw new AppError(422, err.message, err.field);
  moderate(signupTextFields(s));
  const pk = phoneKey(s.phone)!;
  const phone = normalizePhone(s.phone)!;
  await assertUnique(pk, s.login, db);

  await limitOrThrow(`code:phone:${pk}`, 5, 3600, 'Слишком много запросов кода на этот номер — попробуйте через час.', db);
  if (ctx.ip) await limitOrThrow(`code:ip:${ctx.ip}`, 30, 3600, 'Слишком много запросов кода — попробуйте позже.', db);

  const { password, ...rest } = s;
  const payload: StoredSignup = { ...rest, phone, passwordHash: await hashPassword(password) };
  const row = await one<{ id: string }>(
    `INSERT INTO auth_challenges (purpose, phone, phone_key, payload, channel, expires_at, ip)
     VALUES ('signup', $1, $2, $3, 'sms', now() + make_interval(mins => $4), $5) RETURNING id`,
    [phone, pk, JSON.stringify(payload), CODE_TTL_MIN, ctx.ip ?? null],
    db
  );
  const { code } = await codeSender().send(phone, 'sms', 'signup', ctx.ip ?? undefined);
  await query('UPDATE auth_challenges SET code_hash = $2 WHERE id = $1', [row!.id, hashCode(row!.id, code)], db);
  return { challengeId: row!.id, channel: 'sms', sentTo: formatPhone(phone), resendIn: RESEND_SEC, expiresInSec: CODE_TTL_MIN * 60, ...devCode(code) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadChallenge(id: unknown, purpose: 'signup' | 'recover' | 'phone', db: Db, lock = false): Promise<ChallengeRow> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new AppError(400, 'Сессия подтверждения не найдена — начните заново.');
  const row = await one<ChallengeRow>(`SELECT * FROM auth_challenges WHERE id = $1 AND purpose = $2${lock ? ' FOR UPDATE' : ''}`, [id, purpose], db);
  if (!row || row.consumed_at) throw new AppError(410, 'Сессия подтверждения устарела — начните заново.');
  return row;
}

/** «Отправить код снова» / «Позвонить вместо SMS». */
export async function resendCode(challengeId: unknown, channelRaw: unknown, purpose: 'signup' | 'recover' | 'phone', ctx: Ctx, db: Db = pool()): Promise<CodeSent> {
  const channel: Channel = channelRaw === 'call' ? 'call' : 'sms';
  const ch = await loadChallenge(challengeId, purpose, db);
  const wait = RESEND_SEC - Math.floor((Date.now() - ch.last_sent_at.getTime()) / 1000);
  if (wait > 0 && ch.attempts < MAX_ATTEMPTS && channel === ch.channel) {
    throw new AppError(429, `Новый код можно запросить через ${wait} с.`, 'code', { retryAfter: wait });
  }
  if (ch.sent_count >= MAX_SENDS) throw new AppError(429, 'Слишком много попыток — начните регистрацию заново через час.', 'code');
  await limitOrThrow(`code:phone:${ch.phone_key}`, 8, 3600, 'Слишком много запросов кода на этот номер — попробуйте через час.', db);

  let code = '';
  if (ch.code_hash !== null || purpose === 'signup') {
    code = (await codeSender().send(ch.phone, channel, purpose, ctx.ip ?? undefined)).code;
  }
  await query(
    `UPDATE auth_challenges SET code_hash = $2, channel = $3, attempts = 0, sent_count = sent_count + 1,
            last_sent_at = now(), expires_at = now() + make_interval(mins => $4) WHERE id = $1`,
    [ch.id, code ? hashCode(ch.id, code) : null, channel, CODE_TTL_MIN],
    db
  );
  return {
    challengeId: ch.id, channel, sentTo: purpose === 'recover' ? '' : formatPhone(ch.phone),
    resendIn: RESEND_SEC, expiresInSec: CODE_TTL_MIN * 60, ...(code ? devCode(code) : {})
  };
}

/**
 * Проверка кода: 3 попытки на код, срок 5 минут.
 * Попытка списывается атомарно (UPDATE … WHERE attempts < 3) до сравнения — параллельными запросами лимит не обойти.
 */
async function checkCode(ch: ChallengeRow, code: unknown, db: Db) {
  const c = typeof code === 'string' ? code.replace(/\D/g, '') : '';
  if (ch.attempts >= MAX_ATTEMPTS) throw new AppError(422, 'Попытки исчерпаны — запросите новый код', 'code', { attemptsLeft: 0 });
  if (c.length < 4) throw new AppError(422, 'Введите все четыре цифры', 'code');
  if (ch.expires_at.getTime() < Date.now()) throw new AppError(422, 'Код устарел — запросите новый', 'code');
  const used = await one<{ attempts: number }>(
    `UPDATE auth_challenges SET attempts = attempts + 1
      WHERE id = $1 AND attempts < $2 AND consumed_at IS NULL AND code_hash IS NOT DISTINCT FROM $3
      RETURNING attempts`,
    [ch.id, MAX_ATTEMPTS, ch.code_hash],
    db
  );
  // Нет строки: попытки кончились параллельно или код успели перевыпустить — сравнивать не с чем.
  if (!used) throw new AppError(422, 'Попытки исчерпаны — запросите новый код', 'code', { attemptsLeft: 0 });
  if (!codeMatches(ch.id, c, ch.code_hash)) {
    const left = MAX_ATTEMPTS - used.attempts;
    throw new AppError(422, left > 0 ? 'Код не совпал — осталось попыток: ' + left : 'Попытки исчерпаны — запросите новый код', 'code', { attemptsLeft: left });
  }
}

export type PublicUser = {
  id: string; role: Role; login: string; phone: string; email: string; name: string; city: string;
  baseLat: number | null; baseLng: number | null; avatarUrl: string | null; createdAt: string;
};

export function publicUser(u: {
  id: string; role: Role; login: string; phone: string; email: string; name: string; city: string;
  base_lat: number | null; base_lng: number | null; avatar_url: string | null; created_at: Date;
}): PublicUser {
  return {
    id: u.id, role: u.role, login: u.login, phone: u.phone, email: u.email, name: u.name, city: u.city,
    baseLat: u.base_lat, baseLng: u.base_lng, avatarUrl: u.avatar_url, createdAt: u.created_at.toISOString()
  };
}

/** Шаг 4: код + оферта → аккаунт и сессия. */
export async function verifySignup(challengeId: unknown, code: unknown, offerAccepted: unknown, ctx: Ctx) {
  if (offerAccepted !== true) {
    throw new AppError(422, 'Без оферты и согласия на обработку данных аккаунт создать нельзя — отметьте галочку выше.', 'offer');
  }
  const pre = await loadChallenge(challengeId, 'signup', pool());
  await checkCode(pre, code, pool());

  return tx(async (db) => {
    const ch = await loadChallenge(challengeId, 'signup', db, true);
    const p = ch.payload!;
    await assertUnique(ch.phone_key, p.login, db);
    const pt = cityPoint(p.city);
    let user;
    try {
      user = await one<Parameters<typeof publicUser>[0]>(
        `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
         RETURNING id, role, login, phone, email, name, city, base_lat, base_lng, avatar_url, created_at`,
        [p.role, p.login, ch.phone, ch.phone_key, p.email, p.passwordHash, p.name, p.city, pt?.[0] ?? null, pt?.[1] ?? null, config.offerVersion],
        db
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        const by = String((e as { constraint?: string }).constraint).includes('phone') ? 'phone' : 'login';
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
    await query('UPDATE auth_challenges SET consumed_at = now(), verified_at = now(), payload = NULL WHERE id = $1', [ch.id], db);
    const session = await createSession(uid, ctx, db);
    return { user: publicUser(user!), session };
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
  const idKey = 'login:id:' + (id.kind === 'phone' ? 'p:' + id.key : 'l:' + id.login.toLowerCase());
  const TOO_MANY = 'Слишком много попыток входа — подождите 15 минут или восстановите пароль.';
  if (ctx.ip) await limitOrThrow(`login:ip:${ctx.ip}`, 60, 900, 'Слишком много попыток входа — подождите 15 минут.');
  const gate = await hit(idKey, 10, 900);
  if (!gate.ok) throw new AppError(429, TOO_MANY, undefined, { retryAfter: gate.retryAfter });

  const user = await one<Parameters<typeof publicUser>[0] & { password_hash: string; status: string }>(
    `SELECT id, role, login, phone, email, name, city, base_lat, base_lng, avatar_url, created_at, password_hash, status
       FROM users WHERE ${id.kind === 'phone' ? 'phone_key = $1' : 'lower(login) = lower($1)'}`,
    [id.kind === 'phone' ? id.key : id.login]
  );
  if (!user) {
    await verifyPassword(pass, await dummyHash());
    throw new AppError(404, 'Аккаунт с таким ' + (id.kind === 'phone' ? 'номером' : 'логином') + ' не найден. Проверьте написание или зарегистрируйтесь.', 'identifier');
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

/** Код на привязанный номер. Не раскрываем, существует ли аккаунт: для чужого логина — «пустой» вызов. */
export async function startRecover(identifier: unknown, ctx: Ctx): Promise<CodeSent> {
  const raw = typeof identifier === 'string' ? identifier.trim() : '';
  if (!raw) throw new AppError(422, 'Укажите логин или телефон аккаунта — код придёт по SMS на привязанный номер.', 'identifier');
  const id = parseIdentifier(raw);
  if (id.kind === 'invalid') throw new AppError(422, id.message, 'identifier');
  if (ctx.ip) await limitOrThrow(`recover:ip:${ctx.ip}`, 20, 3600, 'Слишком много запросов — попробуйте позже.');

  const user = await one<{ id: string; phone: string; phone_key: string }>(
    `SELECT id, phone, phone_key FROM users WHERE ${id.kind === 'phone' ? 'phone_key = $1' : 'lower(login) = lower($1)'}`,
    [id.kind === 'phone' ? id.key : id.login]
  );
  const pk = user?.phone_key ?? (id.kind === 'phone' ? id.key : 'l:' + id.login.toLowerCase());
  await limitOrThrow(`recover:${pk}`, 5, 3600, 'Слишком много запросов кода — попробуйте через час.');

  const row = await one<{ id: string }>(
    `INSERT INTO auth_challenges (purpose, phone, phone_key, user_id, channel, expires_at, ip)
     VALUES ('recover', $1, $2, $3, 'sms', now() + make_interval(mins => $4), $5) RETURNING id`,
    [user?.phone ?? '', pk, user?.id ?? null, CODE_TTL_MIN, ctx.ip ?? null]
  );
  let extra = {};
  if (user) {
    const { code } = await codeSender().send(user.phone, 'sms', 'recover', ctx.ip ?? undefined);
    await query('UPDATE auth_challenges SET code_hash = $2 WHERE id = $1', [row!.id, hashCode(row!.id, code)]);
    extra = devCode(code);
  }
  return { challengeId: row!.id, channel: 'sms', sentTo: raw, resendIn: RESEND_SEC, expiresInSec: CODE_TTL_MIN * 60, ...extra };
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
  if (p1.length < 6) throw new AppError(422, 'Пароль короче шести символов — так аккаунт уводят за вечер.', 'password');
  if (p1 !== p2) throw new AppError(422, 'Пароли не совпали — проверьте второе поле.', 'password2');
  const hash = await hashPassword(p1);
  return tx(async (db) => {
    const ch = await loadChallenge(challengeId, 'recover', db, true);
    if (!ch.verified_at || !ch.user_id || Date.now() - ch.verified_at.getTime() > RECOVER_WINDOW_MIN * 60_000) {
      throw new AppError(410, 'Подтверждение устарело — запросите код заново.');
    }
    const user = await one<Parameters<typeof publicUser>[0] & { status: string }>(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1
       RETURNING id, role, login, phone, email, name, city, base_lat, base_lng, avatar_url, created_at, status`,
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

// ───────────────────────── Смена телефона и пароля ─────────────────────────

/** Новый номер подтверждается кодом на него же; нужен текущий пароль. */
export async function startPhoneChange(userId: string, raw: unknown, ctx: Ctx): Promise<CodeSent> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pk = phoneKey(typeof r.phone === 'string' ? r.phone : '');
  if (!pk) throw new AppError(422, 'Телефон — минимум 10 цифр.', 'phone');
  const phone = normalizePhone(pk)!;
  const me = await one<{ password_hash: string; phone_key: string }>('SELECT password_hash, phone_key FROM users WHERE id = $1', [userId]);
  if (!me) throw new AppError(401, 'Нужно войти в аккаунт.');
  if (me.phone_key === pk) throw new AppError(422, 'Это ваш текущий номер.', 'phone');
  if (!(await verifyPassword(typeof r.password === 'string' ? r.password : '', me.password_hash))) throw new AppError(401, 'Неверный пароль.', 'password');
  const taken = await one<{ role: Role }>('SELECT role FROM users WHERE phone_key = $1', [pk]);
  if (taken) throw new AppError(409, takenMessage('phone', taken.role), 'phone');
  await limitOrThrow(`code:phone:${pk}`, 5, 3600, 'Слишком много запросов кода на этот номер — попробуйте через час.');
  const row = await one<{ id: string }>(
    `INSERT INTO auth_challenges (purpose, phone, phone_key, user_id, channel, expires_at, ip)
     VALUES ('phone', $1, $2, $3, 'sms', now() + make_interval(mins => $4), $5) RETURNING id`,
    [phone, pk, userId, CODE_TTL_MIN, ctx.ip ?? null]);
  const { code } = await codeSender().send(phone, 'sms', 'phone', ctx.ip ?? undefined);
  await query('UPDATE auth_challenges SET code_hash = $2 WHERE id = $1', [row!.id, hashCode(row!.id, code)]);
  return { challengeId: row!.id, channel: 'sms', sentTo: formatPhone(phone), resendIn: RESEND_SEC, expiresInSec: CODE_TTL_MIN * 60, ...devCode(code) };
}

export async function verifyPhoneChange(userId: string, challengeId: unknown, code: unknown) {
  const pre = await loadChallenge(challengeId, 'phone', pool());
  if (pre.user_id !== userId) throw new AppError(403, 'Подтверждение относится к другому аккаунту.');
  await checkCode(pre, code, pool());
  return tx(async (db) => {
    const ch = await loadChallenge(challengeId, 'phone', db, true);
    const taken = await one<{ id: string; role: Role }>('SELECT id, role FROM users WHERE phone_key = $1', [ch.phone_key], db);
    if (taken && taken.id !== userId) throw new AppError(409, takenMessage('phone', taken.role), 'phone');
    await query('UPDATE users SET phone = $2, phone_key = $3, updated_at = now() WHERE id = $1', [userId, ch.phone, ch.phone_key], db);
    await query('UPDATE auth_challenges SET consumed_at = now(), verified_at = now() WHERE id = $1', [ch.id], db);
    await query(`INSERT INTO events (user_id, kind, text) VALUES ($1, 'account', $2)`, [userId, 'Телефон изменён на ' + formatPhone(ch.phone)], db);
    return { phone: ch.phone };
  });
}

/** Смена пароля: нужен текущий; остальные входы (другие устройства) завершаются. */
export async function changePassword(userId: string, raw: unknown, keepSessionId: string | null) {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const next = typeof r.password === 'string' ? r.password : '';
  if (next.length < 6) throw new AppError(422, 'Пароль короче шести символов — так аккаунт уводят за вечер.', 'password');
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
