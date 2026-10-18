// Вход через Яндекс ID и VK ID (OAuth 2.0 с PKCE). Оба — российские сервисы, сами проверяющие человека по номеру
// телефона; сам номер площадке не нужен и не запрашивается — только имя и почта.
//
// Путь: /api/auth/oauth/<provider>/start → провайдер → /api/auth/oauth/<provider>/callback. Дальше одно из трёх:
//  - аккаунт уже привязан — вход;
//  - intent = link (из профиля) — привязка к текущему аккаунту;
//  - новый человек — одноразовый билет: /auth?oauth=<билет>, анкета с уже заполненными именем и почтой.
// Аккаунт с той же почтой сам не привязывается (почта у сервиса могла быть не подтверждена): человек входит
// по почте и паролю и привязывает сервис в профиле.
// state, верификатор PKCE и билет хранятся в БД только хэшами и привязаны к браузеру, начавшему вход (cookie с nonce).
import crypto from 'node:crypto';
import { EMAIL_RE } from '@/lib/validation';
import { config } from './config';
import { one, pool, query, type Db } from './db';
import { AppError } from './errors';
import { limitOrThrow } from './rate-limit';
import type { Ctx } from './session';

export type Provider = 'yandex' | 'vk';
export const PROVIDERS: Provider[] = ['yandex', 'vk'];
export const PROVIDER_NAME: Record<Provider, string> = { yandex: 'Яндекс ID', vk: 'VK ID' };

/** Профиль от провайдера: id аккаунта у него, имя, почта (пустая, если сервис её не дал). */
export type OAuthProfile = { provider: Provider; subject: string; name: string; email: string };

const FLOW_MIN = 10;          // от «Войти через…» до возврата
const TICKET_MIN = 30;        // на заполнение анкеты после возврата
export const NONCE_COOKIE = 'arena_oauth';

const sha = (s: string) => crypto.createHash('sha256').update(s).digest();
const rnd = () => crypto.randomBytes(32).toString('base64url');

export function enabledProviders(): Provider[] {
  return PROVIDERS.filter(p => (p === 'yandex' ? !!config.yandexClientId() && !!config.yandexClientSecret() : !!config.vkClientId()));
}

export const isProvider = (p: unknown): p is Provider => p === 'yandex' || p === 'vk';

const redirectUri = (p: Provider) => config.publicUrl().replace(/\/$/, '') + '/api/auth/oauth/' + p + '/callback';

// HTTP к провайдерам — подменяется в тестах.
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
export function setOAuthFetch(f: Fetch | null) {
  fetcher = f ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }));
}

async function json(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try { res = await fetcher(url, init); } catch { throw new AppError(502, 'Сервис входа не ответил — попробуйте ещё раз или войдите по почте.'); }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) throw new AppError(502, 'Сервис входа отказал — попробуйте ещё раз или войдите по почте.');
  return body;
}

const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });

const emailOf = (raw: unknown) => (typeof raw === 'string' && raw.length <= 200 && EMAIL_RE.test(raw.trim()) ? raw.trim() : '');

const fullName = (...parts: unknown[]) => parts.filter(x => typeof x === 'string' && x.trim()).join(' ').trim().slice(0, 80);

// ───────────────────────── Провайдеры ─────────────────────────

function authorizeUrl(p: Provider, state: string, verifier: string): string {
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  if (p === 'yandex') {
    const u = new URL('https://oauth.yandex.ru/authorize');
    u.search = new URLSearchParams({
      response_type: 'code', client_id: config.yandexClientId(), redirect_uri: redirectUri(p), state,
      code_challenge: challenge, code_challenge_method: 'S256', force_confirm: 'no'
    }).toString();
    return u.toString();
  }
  const u = new URL('https://id.vk.com/authorize');
  u.search = new URLSearchParams({
    response_type: 'code', client_id: config.vkClientId(), redirect_uri: redirectUri(p), state,
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'email'
  }).toString();
  return u.toString();
}

async function fetchProfile(p: Provider, code: string, verifier: string, state: string, deviceId: string): Promise<OAuthProfile> {
  if (p === 'yandex') {
    const t = await json('https://oauth.yandex.ru/token', form({
      grant_type: 'authorization_code', code, client_id: config.yandexClientId(), client_secret: config.yandexClientSecret(), code_verifier: verifier
    }));
    if (typeof t.access_token !== 'string') throw new AppError(502, 'Яндекс не выдал доступ — попробуйте ещё раз.');
    const i = await json('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + t.access_token } });
    return {
      provider: p, subject: String(i.id ?? ''),
      name: fullName(i.first_name, i.last_name) || fullName(i.real_name) || fullName(i.display_name),
      email: emailOf(i.default_email)
    };
  }
  if (!deviceId) throw new AppError(400, 'VK ID не передал данные устройства — попробуйте войти ещё раз.');
  const t = await json('https://id.vk.com/oauth2/auth', form({
    grant_type: 'authorization_code', code, code_verifier: verifier, client_id: config.vkClientId(),
    device_id: deviceId, redirect_uri: redirectUri(p), state
  }));
  if (typeof t.access_token !== 'string') throw new AppError(502, 'VK ID не выдал доступ — попробуйте ещё раз.');
  const i = await json('https://id.vk.com/oauth2/user_info', form({ client_id: config.vkClientId(), access_token: t.access_token }));
  const u = (i.user ?? {}) as Record<string, unknown>;
  return {
    provider: p, subject: String(u.user_id ?? t.user_id ?? ''),
    name: fullName(u.first_name, u.last_name),
    email: emailOf(u.email)
  };
}

// ───────────────────────── Начало и возврат ─────────────────────────

/**
 * «Войти через…»: запись о входе и адрес провайдера. nonce — в cookie браузера (ставит маршрут);
 * для привязки (intent = link) нужен вошедший пользователь.
 */
export async function startOAuth(p: Provider, intent: 'login' | 'link', userId: string | null, applyNum: number | null, ctx: Ctx) {
  if (!enabledProviders().includes(p)) throw new AppError(404, 'Вход через ' + PROVIDER_NAME[p] + ' не подключён.');
  if (intent === 'link' && !userId) throw new AppError(401, 'Нужно войти в аккаунт.');
  if (ctx.ip) await limitOrThrow('oauth:ip:' + ctx.ip, 30, 3600, 'Слишком много попыток входа — попробуйте позже.');
  const state = rnd(), verifier = rnd(), nonce = rnd();
  await query(
    `INSERT INTO oauth_flows (provider, state_hash, browser_hash, verifier, intent, user_id, apply_num, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => $8))`,
    [p, sha(state), sha(nonce), verifier, intent, intent === 'link' ? userId : null, applyNum, FLOW_MIN]);
  return { url: authorizeUrl(p, state, verifier), nonce };
}

export type OAuthResult =
  | { kind: 'login'; userId: string; applyNum: number | null }
  | { kind: 'linked'; provider: Provider }
  | { kind: 'signup'; ticket: string; applyNum: number | null };

type Flow = { id: string; provider: Provider; verifier: string; intent: 'login' | 'link'; user_id: string | null; apply_num: string | null };

/** Возврат от провайдера: проверка state и браузера, обмен кода на профиль, вход / привязка / билет регистрации. */
export async function finishOAuth(p: Provider, params: URLSearchParams, nonce: string | undefined, viewerId: string | null): Promise<OAuthResult> {
  if (params.get('error')) throw new AppError(400, 'Вход отменён — можно попробовать ещё раз или войти по почте.');
  const state = params.get('state') || '', code = params.get('code') || '';
  if (!state || !code || !nonce) throw new AppError(400, 'Ссылка входа устарела — начните заново.');
  // Одноразово: state гасится сразу, повтор того же возврата не сработает.
  const flow = await one<Flow>(
    `UPDATE oauth_flows SET returned_at = now()
      WHERE state_hash = $1 AND browser_hash = $2 AND provider = $3 AND returned_at IS NULL AND expires_at > now()
      RETURNING id, provider, verifier, intent, user_id, apply_num`, [sha(state), sha(nonce), p]);
  if (!flow) throw new AppError(400, 'Ссылка входа устарела или открыта в другом браузере — начните заново.');
  const prof = await fetchProfile(p, code, flow.verifier, state, params.get('device_id') || '');
  if (!prof.subject) throw new AppError(502, PROVIDER_NAME[p] + ' не передал данные аккаунта — попробуйте ещё раз.');
  const applyNum = flow.apply_num == null ? null : Number(flow.apply_num);

  if (flow.intent === 'link') {
    if (!viewerId || viewerId !== flow.user_id) throw new AppError(401, 'Войдите в аккаунт, к которому привязываете ' + PROVIDER_NAME[p] + '.');
    const other = await one<{ user_id: string }>('SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2', [p, prof.subject]);
    if (other && other.user_id !== viewerId) throw new AppError(409, 'Этот ' + PROVIDER_NAME[p] + ' уже привязан к другому аккаунту.');
    await query('DELETE FROM user_identities WHERE user_id = $1 AND provider = $2', [viewerId, p]);
    await query('INSERT INTO user_identities (provider, subject, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [p, prof.subject, viewerId]);
    return { kind: 'linked', provider: p };
  }

  // Уже привязан — вход.
  const known = await one<{ id: string; status: string }>(
    `SELECT u.id, u.status FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = $1 AND i.subject = $2`, [p, prof.subject]);
  if (known) return loginResult(known, applyNum);
  // Почта от сервиса уже у аккаунта — подсказываем привязку (сами не привязываем: почта у сервиса могла быть не подтверждена).
  if (prof.email && await one("SELECT 1 FROM users WHERE lower(email) = lower($1) AND email <> ''", [prof.email])) {
    throw new AppError(409, 'Аккаунт с почтой ' + prof.email + ' уже есть. Войдите по почте и паролю, затем привяжите ' +
      PROVIDER_NAME[p] + ' в профиле — раздел «Вход через сервисы». Не помните пароль — «Забыли пароль?».');
  }
  // Новый человек — билет на регистрацию с заполненными данными.
  const ticket = rnd();
  await query(`UPDATE oauth_flows SET profile = $2, ticket_hash = $3, expires_at = now() + make_interval(mins => $4) WHERE id = $1`,
    [flow.id, JSON.stringify(prof), sha(ticket), TICKET_MIN]);
  return { kind: 'signup', ticket, applyNum };
}

function loginResult(u: { id: string; status: string }, applyNum: number | null): OAuthResult {
  if (u.status === 'blocked') throw new AppError(403, 'Аккаунт заблокирован за нарушение правил площадки. Напишите в поддержку.');
  if (u.status === 'deleted') throw new AppError(404, 'Аккаунт удалён.');
  return { kind: 'login', userId: u.id, applyNum };
}

// ───────────────────────── Регистрация по билету ─────────────────────────

export type Ticket = { id: string; profile: OAuthProfile };

/** Билет регистрации: этот браузер, не использован, не истёк. */
export async function loadTicket(ticket: unknown, nonce: string | undefined, db: Db = pool(), lock = false): Promise<Ticket> {
  if (typeof ticket !== 'string' || ticket.length < 20 || ticket.length > 100 || !nonce) throw new AppError(410, 'Вход через сервис устарел — нажмите кнопку входа ещё раз.');
  const r = await one<{ id: string; profile: OAuthProfile }>(
    `SELECT id, profile FROM oauth_flows
      WHERE ticket_hash = $1 AND browser_hash = $2 AND used_at IS NULL AND expires_at > now() AND profile IS NOT NULL${lock ? ' FOR UPDATE' : ''}`,
    [sha(ticket), sha(nonce)], db);
  if (!r) throw new AppError(410, 'Вход через сервис устарел — нажмите кнопку входа ещё раз.');
  return r;
}

/** Что показать в анкете: данные от провайдера. Почта от него — уже подтверждена, без кода. */
export async function ticketInfo(ticket: unknown, nonce: string | undefined) {
  const t = await loadTicket(ticket, nonce);
  const pr = t.profile;
  return { provider: pr.provider, providerName: PROVIDER_NAME[pr.provider], name: pr.name, email: pr.email };
}

/** После создания аккаунта: привязка сервиса, билет погашен. */
export async function consumeTicket(t: Ticket, userId: string, db: Db) {
  await query('UPDATE oauth_flows SET used_at = now() WHERE id = $1', [t.id], db);
  await query('INSERT INTO user_identities (provider, subject, user_id) VALUES ($1, $2, $3)', [t.profile.provider, t.profile.subject, userId], db);
}

// ───────────────────────── Профиль ─────────────────────────

export async function identitiesOf(userId: string): Promise<Provider[]> {
  return (await query<{ provider: Provider }>('SELECT provider FROM user_identities WHERE user_id = $1 ORDER BY provider', [userId])).rows.map(r => r.provider);
}

export async function unlinkIdentity(userId: string, p: unknown) {
  if (!isProvider(p)) throw new AppError(404, 'Неизвестный сервис входа.');
  await query('DELETE FROM user_identities WHERE user_id = $1 AND provider = $2', [userId, p]);
  return { identities: await identitiesOf(userId) };
}
