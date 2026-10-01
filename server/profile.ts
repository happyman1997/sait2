// Профиль, база для поиска, настройки уведомлений, журнал событий.
import { ACCESS, GEAR, JOB_TYPE_IDS, OBJECT_KINDS, ORG_TYPES, TOOLS } from '@/lib/catalog';
import { findBadField } from '@/lib/moderation';
import { EMAIL_RE, LOGIN_RE, type Role } from '@/lib/validation';
import { loadProfile, publicUser } from './auth';
import { one, query, tx } from './db';
import { AppError, ModerationError } from './errors';
import { geoSearch } from './geo';
import { limitOrThrow } from './rate-limit';
import { sendEmailVerification } from './verify';
import { shortName } from './jobs';
import type { SessionUser } from './session';
import { doneSql } from './stats';

type U = SessionUser;

function need(u: U | null): U {
  if (!u) throw new AppError(401, 'Нужно войти в аккаунт.');
  return u;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : undefined);
const list = (v: unknown, maxItems: number, maxLen: number) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map(x => x.trim().slice(0, maxLen)).filter(Boolean))].slice(0, maxItems) : undefined;

// ───────────────────────── Профиль ─────────────────────────

export async function getProfile(viewer: U | null) {
  const v = need(viewer);
  // Свежая строка: профиль читают сразу после правки, а viewer — снимок на начало запроса.
  const u = (await one<U & { email_verified_at: Date | null }>(
    `SELECT id, role, login, phone, email, name, city, base_lat, base_lng, base_label, avatar_url, status, created_at, $2::uuid AS session_id,
            email_verified_at
       FROM users WHERE id = $1`, [v.id, v.session_id]))!;
  const emp = u.role === 'employer';
  const [profile, stats, history, marks, reviews, settings] = await Promise.all([
    loadProfile(u.id, u.role),
    one<{ done: number; rating: number | null; reviews: number; jobs: number; no_shows: number; inn: string | null }>(
      `SELECT ${emp ? "(SELECT count(*) FROM jobs j WHERE j.employer_id = u.id AND j.status = 'accepted')::int" : doneSql('u.id')} AS done,
              (SELECT avg(rating)::float8 FROM reviews WHERE target_id = u.id) AS rating,
              (SELECT count(*) FROM reviews WHERE target_id = u.id)::int AS reviews,
              (SELECT count(*) FROM ${emp ? 'jobs WHERE employer_id = u.id' : "applications WHERE freelancer_id = u.id"})::int AS jobs,
              u.no_show_count AS no_shows,
              (SELECT inn FROM employer_profiles WHERE user_id = u.id) AS inn
         FROM users u WHERE u.id = $1`, [u.id]),
    query<{ num: string; title: string; address: string; date: string; pay: number; unit: string; employer_marked: boolean | null; freelancer_marked: boolean | null; auto: boolean }>(
      `SELECT j.num, j.title, j.address, to_char(j.date, 'YYYY-MM-DD') AS date, j.pay, j.unit, s.employer_marked, s.freelancer_marked, ac.auto
         FROM jobs j JOIN acceptances ac ON ac.job_id = j.id LEFT JOIN settlements s ON s.job_id = j.id
        WHERE ${emp ? 'j.employer_id = $1' : 'EXISTS (SELECT 1 FROM hires h WHERE h.job_id = j.id AND h.freelancer_id = $1)'}
        ORDER BY ac.accepted_at DESC LIMIT 30`, [u.id]),
    // Поздние отказы и неявки видны 90 дней.
    query<{ kind: string; reason: string | null; created_at: Date; until: Date | null }>(
      `SELECT kind, reason, created_at, until FROM user_marks
        WHERE user_id = $1 AND coalesce(until, created_at + interval '90 days') > now()
        ORDER BY created_at DESC LIMIT 20`, [u.id]),
    query<{ rating: number; text: string; created_at: Date; author: string; title: string }>(
      `SELECT r.rating, r.text, r.created_at, a.name AS author, j.title
         FROM reviews r JOIN users a ON a.id = r.author_id JOIN jobs j ON j.id = r.job_id
        WHERE r.target_id = $1 ORDER BY r.created_at DESC LIMIT 10`, [u.id]),
    getSettings(u)
  ]);
  // Незакрытые споры по расчёту видны в профиле обеих сторон (как в прототипе).
  const disputes = await query<{ num: number; reason: string; job_num: string; created_at: Date }>(
    `SELECT d.num, d.reason, j.num AS job_num, d.created_at FROM disputes d JOIN jobs j ON j.id = d.job_id
      WHERE d.status IN ('open', 'review') AND (d.freelancer_id = $1 OR j.employer_id = $1) ORDER BY d.created_at DESC`, [u.id]);
  const MARK: Record<string, string> = {
    late_cancel: 'Поздняя отмена смены', late_withdrawal: 'Поздний отказ от смены', no_show: 'Неявка на смену',
    complaint: 'Жалоба подтверждена', demoted: 'Понижение в выдаче', blocked: 'Блокировка'
  };
  return {
    user: { ...publicUser(u), baseLabel: u.base_label || u.city, emailVerified: !!u.email_verified_at },
    profile,
    stats: { done: stats!.done, rating: stats!.rating == null ? null : Math.round(stats!.rating * 10) / 10, reviews: stats!.reviews, jobs: stats!.jobs, noShows: stats!.no_shows },
    inn: stats!.inn,
    history: history.rows.map(h => ({
      num: Number(h.num), title: h.title, address: h.address, date: h.date, pay: h.pay, unit: h.unit,
      settle: h.employer_marked && h.freelancer_marked ? 'расчёт подтверждён' : h.employer_marked || h.freelancer_marked ? 'расчёт отмечен одной стороной' : 'расчёт не отмечен',
      auto: h.auto
    })),
    marks: [...disputes.rows.map(d => ({
      label: 'Незакрытый спор по расчёту СП-' + d.num,
      value: d.reason + ' · заказ № ' + String(d.job_num).padStart(2, '0') + ' · с ' + d.created_at.toLocaleDateString('ru-RU')
    })), ...marks.rows.map(m => ({
      label: MARK[m.kind] || m.kind,
      value: (m.reason ? m.reason + ' · ' : '') + new Date(m.created_at).toLocaleDateString('ru-RU') + ' · видна до ' +
        new Date(m.until ?? m.created_at.getTime() + 90 * 86400000).toLocaleDateString('ru-RU')
    }))],
    reviews: reviews.rows.map(r => ({ rating: r.rating, text: r.text, at: r.created_at.toISOString(), author: shortName(r.author), title: r.title })),
    settings
  };
}

/** Правка профиля. Телефон меняется отдельно — через код на новый номер. */
export async function updateProfile(viewer: U | null, raw: unknown) {
  const u = need(viewer);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const first = str(r.firstName, 60), last = str(r.lastName, 60);
  const name = first !== undefined || last !== undefined ? [first ?? '', last ?? ''].join(' ').trim() : undefined;
  const login = str(r.login, 20);
  const email = str(r.email, 200);
  if (name !== undefined && name.length < 2) throw new AppError(422, 'Укажите имя и фамилию — их видит вторая сторона в чате.', 'name');
  if (login !== undefined && !LOGIN_RE.test(login)) throw new AppError(422, 'Логин: 3–20 символов — латиница, цифры, точка или подчёркивание.', 'login');
  if (email !== undefined && !EMAIL_RE.test(email)) throw new AppError(422, 'Проверьте e-mail — похоже, в адресе опечатка.', 'email');

  const f = (r.freelancer && typeof r.freelancer === 'object' ? r.freelancer : null) as Record<string, unknown> | null;
  const e = (r.employer && typeof r.employer === 'object' ? r.employer : null) as Record<string, unknown> | null;
  const customGear = f ? list(f.customGear, 8, 60) : undefined;
  const fp = f && u.role === 'freelancer' ? {
    skills: list(f.skills, 30, 40)?.filter(s => JOB_TYPE_IDS.includes(s)),
    customSkills: list(f.customSkills, 8, 60),
    customGear,
    gear: list(f.gear, 40, 60)?.filter(g => GEAR.includes(g) || (customGear ?? []).includes(g)),
    workCities: list(f.workCities, 20, 80),
    ownCar: typeof f.ownCar === 'boolean' ? f.ownCar : undefined
  } : null;
  const inn = e ? str(e.inn, 12) : undefined;
  if (inn && !/^(\d{10}|\d{12})$/.test(inn)) throw new AppError(422, 'ИНН — 10 или 12 цифр.', 'inn');
  const ep = e && u.role === 'employer' ? {
    orgType: typeof e.orgType === 'string' && ORG_TYPES.includes(e.orgType) ? e.orgType : undefined,
    orgName: str(e.orgName, 160),
    inn,
    objectKind: typeof e.objectKind === 'string' && OBJECT_KINDS.includes(e.objectKind) ? e.objectKind : undefined,
    access: list(e.access, 10, 60)?.filter(a => ACCESS.includes(a)),
    tools: typeof e.tools === 'string' && TOOLS.includes(e.tools) ? e.tools : undefined
  } : null;

  const hit = findBadField([
    { field: 'name', label: 'Имя', value: name },
    { field: 'login', label: 'Логин', value: login },
    { field: 'email', label: 'E-mail', value: email },
    { field: 'skills', label: 'Свой навык', value: fp?.customSkills },
    { field: 'gear', label: 'Свой инвентарь', value: fp?.customGear },
    { field: 'cities', label: 'Города, где вы работаете', value: fp?.workCities },
    { field: 'orgName', label: 'Название организации', value: ep?.orgName }
  ]);
  if (hit) throw new ModerationError(hit.field, hit.label, hit.category);
  if (fp?.workCities && !fp.workCities.length) throw new AppError(422, 'Добавьте хотя бы один город, где вы работаете.', 'cities');

  await tx(async (db) => {
    if (login !== undefined) {
      const taken = await one<{ id: string; role: Role }>('SELECT id, role FROM users WHERE lower(login) = lower($1)', [login], db);
      if (taken && taken.id !== u.id) throw new AppError(409, 'Этот логин уже занят — выберите другой.', 'login');
    }
    await query(
      `UPDATE users SET name = coalesce($2, name), login = coalesce($3, login), email = coalesce($4, email), updated_at = now(),
              email_verified_at = CASE WHEN $4::text IS NOT NULL AND lower($4) <> lower(email) THEN NULL ELSE email_verified_at END
        WHERE id = $1`,
      [u.id, name ?? null, login ?? null, email ?? null], db);
    if (fp) {
      await query(
        `UPDATE freelancer_profiles SET skills = coalesce($2, skills), custom_skills = coalesce($3, custom_skills), gear = coalesce($4, gear),
                custom_gear = coalesce($5, custom_gear), work_cities = coalesce($6, work_cities), own_car = coalesce($7, own_car)
          WHERE user_id = $1`,
        [u.id, fp.skills ?? null, fp.customSkills ?? null, fp.gear ?? null, fp.customGear ?? null, fp.workCities ?? null, fp.ownCar ?? null], db);
    }
    if (ep) {
      await query(
        `UPDATE employer_profiles SET org_type = coalesce($2, org_type), org_name = coalesce($3, org_name), inn = coalesce($4, inn),
                object_kind = coalesce($5, object_kind), access = coalesce($6, access), tools = coalesce($7, tools)
          WHERE user_id = $1`,
        [u.id, ep.orgType ?? null, ep.orgName ?? null, ep.inn ?? null, ep.objectKind ?? null, ep.access ?? null, ep.tools ?? null], db);
    }
  });
  // Новый адрес — сразу письмо со ссылкой (лимит писем не должен ломать сохранение профиля).
  if (email !== undefined && email.toLowerCase() !== u.email.toLowerCase()) await sendEmailVerification(u).catch(() => {});
  return { ok: true };
}

/** База для поиска и оповещений «рядом»: точка на карте или адрес/населённый пункт через геокодер. */
export async function setBase(viewer: U | null, raw: unknown) {
  const u = need(viewer);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let lat = typeof r.lat === 'number' ? r.lat : NaN, lng = typeof r.lng === 'number' ? r.lng : NaN;
  let label = str(r.label, 120) || '';
  const q = str(r.query, 200);
  if (q) {
    await limitOrThrow(`base:${u.id}`, 20, 3600, 'Слишком часто меняете базу — попробуйте через час.');
    const hit = (await geoSearch(q, 1))[0];
    if (!hit) throw new AppError(404, 'Не нашли это место — уточните населённый пункт.', 'query');
    lat = hit.lat; lng = hit.lng; label = (hit.district || hit.label.split(',')[0]).trim();
  }
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new AppError(422, 'Укажите место на карте или адрес.', 'query');
  const hit = findBadField([{ field: 'label', label: 'База', value: label }]);
  if (hit) throw new ModerationError(hit.field, hit.label, hit.category);
  await query('UPDATE users SET base_lat = $2, base_lng = $3, base_label = $4, updated_at = now() WHERE id = $1', [u.id, lat, lng, label || null]);
  return { base: { lat, lng, label: label || u.city } };
}

// ───────────────────────── Настройки уведомлений ─────────────────────────

export type Settings = {
  enabled: boolean; push: boolean; sms: boolean; email: boolean; radiusKm: number;
  quietOn: boolean; quietFrom: number; quietTo: number; urgentBypass: boolean; dailyCap: number;
};

export async function getSettings(viewer: U | null): Promise<Settings> {
  const u = need(viewer);
  await query('INSERT INTO notification_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [u.id]);
  const s = await one<Record<string, unknown>>('SELECT * FROM notification_settings WHERE user_id = $1', [u.id]);
  return {
    enabled: !!s!.enabled, push: !!s!.push, sms: !!s!.sms, email: !!s!.email, radiusKm: s!.radius_km as number,
    quietOn: !!s!.quiet_on, quietFrom: s!.quiet_from as number, quietTo: s!.quiet_to as number, urgentBypass: !!s!.urgent_bypass, dailyCap: s!.daily_cap as number
  };
}

export const RADIUS_OPTIONS = [10, 30, 50, 100, 300];
export const CAP_OPTIONS = [3, 5, 10, 30];

export async function saveSettings(viewer: U | null, raw: unknown): Promise<Settings> {
  const u = need(viewer);
  const cur = await getSettings(u);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const b = (k: keyof Settings) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (cur[k] as boolean));
  const hour = (k: 'quietFrom' | 'quietTo') => (Number.isInteger(r[k]) && (r[k] as number) >= 0 && (r[k] as number) <= 23 ? (r[k] as number) : cur[k]);
  const next: Settings = {
    enabled: b('enabled'), push: b('push'), sms: b('sms'), email: b('email'),
    radiusKm: RADIUS_OPTIONS.includes(r.radiusKm as number) ? (r.radiusKm as number) : cur.radiusKm,
    quietOn: b('quietOn'), quietFrom: hour('quietFrom'), quietTo: hour('quietTo'), urgentBypass: b('urgentBypass'),
    dailyCap: CAP_OPTIONS.includes(r.dailyCap as number) ? (r.dailyCap as number) : cur.dailyCap
  };
  await query(
    `UPDATE notification_settings SET enabled = $2, push = $3, sms = $4, email = $5, radius_km = $6, quiet_on = $7, quiet_from = $8,
            quiet_to = $9, urgent_bypass = $10, daily_cap = $11 WHERE user_id = $1`,
    [u.id, next.enabled, next.push, next.sms, next.email, next.radiusKm, next.quietOn, next.quietFrom, next.quietTo, next.urgentBypass, next.dailyCap]);
  return next;
}

// ───────────────────────── Журнал ─────────────────────────

const KIND_LABEL: Record<string, string> = {
  account: 'Аккаунт', job: 'Заказ', application: 'Отклик', hire: 'Найм', cancel: 'Отмена', withdrawal: 'Отказ', no_show: 'Не вышел',
  report: 'Работа сдана', accept: 'Приёмка', move: 'Перенос', settle: 'Расчёт', review: 'Отзыв', complaint: 'Жалоба', nearby: 'Рядом', dispute: 'Спор',
  support: 'Поддержка'
};

export async function listEvents(viewer: U | null, limit = 30) {
  const u = need(viewer);
  const r = await query<{ id: string; kind: string; text: string; num: string | null; muted: boolean; read_at: Date | null; created_at: Date }>(
    `SELECT e.id, e.kind, e.text, j.num, e.muted, e.read_at, e.created_at
       FROM events e LEFT JOIN jobs j ON j.id = e.job_id
      WHERE e.user_id = $1 ORDER BY e.created_at DESC LIMIT $2`, [u.id, Math.min(100, limit)]);
  const head = (await one<{ n: number; toasts: boolean | null }>(
    `SELECT (SELECT count(*) FROM events WHERE user_id = $1 AND read_at IS NULL)::int AS n,
            (SELECT enabled AND push FROM notification_settings WHERE user_id = $1) AS toasts`, [u.id]))!;
  return {
    unread: head.n,
    /** Всплывающие уведомления в открытой вкладке (канал «пуш»). */
    toasts: head.toasts ?? true,
    events: r.rows.map(e => ({
      id: e.id, kind: KIND_LABEL[e.kind] || e.kind, text: e.text, num: e.num ? Number(e.num) : null, muted: e.muted,
      read: !!e.read_at, at: e.created_at.toISOString(),
      // Куда ведёт запись журнала: напоминания поддержке — в её кабинет, остальное — в карточку заказа.
      href: e.kind === 'support' ? '/support' : e.num ? '/?job=' + e.num : null
    }))
  };
}

export async function markEventsRead(viewer: U | null) {
  const u = need(viewer);
  await query('UPDATE events SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [u.id]);
  return { ok: true };
}

export async function clearEvents(viewer: U | null) {
  const u = need(viewer);
  await query('DELETE FROM events WHERE user_id = $1', [u.id]);
  return { ok: true };
}

