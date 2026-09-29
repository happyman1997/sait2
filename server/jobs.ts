// Заказы: публикация, правка, отмена, поиск по карте, отклик. Правила из README проверяются здесь.
import crypto from 'node:crypto';
import { CREW_ANY, MONTHS_GEN } from '@/lib/catalog';
import {
  autoTitle, daysAhead, emptyJobForm, isKnownPayType, isKnownRepeat, isKnownTools, isKnownUnit, jobAllErrors, JOB_FIELD_STEP,
  jobNum, payNumber, AUTO_ACCEPT_DAYS, type AppStatus, type Applicant, type JobDetail, type JobForm, type JobStatus, type JobSummary, type ShiftInfo
} from '@/lib/jobs';
import { badWordIn, findBadField } from '@/lib/moderation';
import { one, pool, query, tx, type Db } from './db';
import { AppError, ModerationError } from './errors';
import { addEvents } from './events';
import { jobPhotos } from './files';
import { publish } from './live';
import { limitOrThrow } from './rate-limit';
import type { SessionUser } from './session';

export const DEFAULT_BASE = { lat: 55.7558, lng: 37.6173, label: 'Москва' };
export const CANCEL_REASONS_EMPLOYER = ['объект отменил работы', 'погода изменилась', 'нашли своих людей', 'ошибка в заказе', 'другая причина'];
const NOTICES = ['больше суток', 'меньше суток'];
const LATE_MARK_DAYS = 90;

type Viewer = (Pick<SessionUser, 'id' | 'role' | 'city' | 'base_lat' | 'base_lng'> & { base_label?: string | null }) | null;

// ───────────────────────── Даты ─────────────────────────

/** «Сегодня» клиента (его часовой пояс), но не дальше суток от серверной даты — чтобы нельзя было подделать. */
export function clientToday(raw: unknown): string {
  const server = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const diff = Math.abs(Date.parse(raw + 'T12:00:00Z') - Date.parse(iso(server) + 'T12:00:00Z')) / 86400000;
    if (diff <= 1) return raw;
  }
  return iso(server);
}

// ───────────────────────── Поиск ─────────────────────────

export type ListParams = {
  types?: string[];
  minPay?: number;
  km?: number;          // 0 / undefined — любое расстояние
  when?: 'any' | 'soon';
  q?: string;
  today: string;
  lat?: number;
  lng?: number;
};

export function baseOf(viewer: Viewer, lat?: number, lng?: number) {
  if (viewer?.base_lat != null && viewer.base_lng != null) return { lat: viewer.base_lat, lng: viewer.base_lng, label: viewer.base_label || viewer.city };
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat!) <= 90 && Math.abs(lng!) <= 180) return { lat: lat!, lng: lng!, label: 'выбранная точка' };
  return DEFAULT_BASE;
}

const SUMMARY_COLS = `
  j.id, j.num, j.title, j.type_id, t.label AS type_label, j.address, j.district, j.lat, j.lng, j.pay, j.unit, j.pay_type,
  to_char(j.date, 'YYYY-MM-DD') AS date, j.volume, j.crew, j.urgent, j.repeat, j.status, j.created_at, j.employer_id,
  (SELECT count(*) FROM hires h WHERE h.job_id = j.id)::int AS hired,
  (SELECT count(*) FROM applications a WHERE a.job_id = j.id AND a.status IN ('sent', 'hired'))::int AS applicants,
  (SELECT a.status FROM applications a WHERE a.job_id = j.id AND a.freelancer_id = $1) AS my_status,
  earth_distance(ll_to_earth($2, $3), ll_to_earth(j.lat, j.lng)) / 1000 AS distance_km`;

type SummaryRow = {
  id: string; num: string; title: string; type_id: string; type_label: string; address: string; district: string | null;
  lat: number; lng: number; pay: number; unit: string; pay_type: string | null; date: string; volume: string | null;
  crew: number; urgent: boolean; repeat: string | null; status: JobStatus; created_at: Date; employer_id: string;
  hired: number; applicants: number; my_status: AppStatus | null; distance_km: number | null;
};

function toSummary(r: SummaryRow, viewer: Viewer): JobSummary {
  return {
    num: Number(r.num), title: r.title, typeId: r.type_id, typeLabel: r.type_label, address: r.address, district: r.district,
    lat: r.lat, lng: r.lng, pay: r.pay, unit: r.unit, payType: r.pay_type, date: r.date, volume: r.volume, crew: r.crew,
    urgent: r.urgent, repeat: r.repeat, status: r.status, hired: r.hired, applicants: r.applicants,
    mine: !!viewer && viewer.id === r.employer_id,
    myStatus: viewer?.role === 'freelancer' ? r.my_status : null,
    distanceKm: r.distance_km == null ? null : Math.round(r.distance_km * 10) / 10,
    createdAt: r.created_at.toISOString()
  };
}

export async function listJobs(p: ListParams, viewer: Viewer, db: Db = pool()) {
  const base = baseOf(viewer, p.lat, p.lng);
  const q = (p.q || '').trim().slice(0, 100);
  if (q) {
    const cat = badWordIn(q);
    if (cat) throw new ModerationError('q', 'Поиск', cat);
  }
  const types = (p.types || []).filter(t => /^[a-z0-9_]{1,40}$/.test(t)).slice(0, 50);
  const km = p.km && p.km > 0 ? Math.min(p.km, 20000) : null;
  const like = q ? '%' + q.toLowerCase().replace(/[\\%_]/g, m => '\\' + m) + '%' : null;
  const params: unknown[] = [viewer?.id ?? null, base.lat, base.lng, p.today, types.length ? types : null, Math.max(0, p.minPay || 0), km, p.when === 'soon', like];
  // Внутри — 500 ближайших к базе подходящих заказов (KNN по GiST-индексу jobs_geo_idx),
  // снаружи — счётчики откликов/найма только для них и порядок списка: срочные, затем по дате.
  const r = await query<SummaryRow>(
    `WITH near AS (
       SELECT j.id
         FROM jobs j
        WHERE j.status IN ('open', 'staffed')
          AND (j.date >= $4::date OR j.repeat IS NOT NULL)
          AND ($5::text[] IS NULL OR j.type_id = ANY($5))
          AND j.pay >= $6
          AND ($7::float8 IS NULL OR (earth_box(ll_to_earth($2, $3), $7 * 1000) @> ll_to_earth(j.lat, j.lng)
                                      AND earth_distance(ll_to_earth($2, $3), ll_to_earth(j.lat, j.lng)) <= $7 * 1000))
          AND (NOT $8 OR j.date BETWEEN $4::date AND $4::date + 1)
          AND ($9::text IS NULL OR j.search LIKE $9 OR j.type_id IN (SELECT id FROM job_types WHERE lower(label) LIKE $9))
        ORDER BY ll_to_earth(j.lat, j.lng) <-> ll_to_earth($2, $3)
        LIMIT 500
     )
     SELECT ${SUMMARY_COLS}
       FROM near JOIN jobs j ON j.id = near.id JOIN job_types t ON t.id = j.type_id
      ORDER BY j.urgent DESC, j.date, j.created_at DESC`,
    params,
    db
  );
  return { jobs: r.rows.map(x => toSummary(x, viewer)), base };
}

/** Типы работ для фильтра: справочник + пользовательские, с числом открытых заказов. */
export async function jobTypes(today: string, db: Db = pool()) {
  const r = await query<{ id: string; label: string; is_custom: boolean; count: number }>(
    `SELECT t.id, t.label, t.is_custom,
            (SELECT count(*) FROM jobs j WHERE j.type_id = t.id AND j.status IN ('open', 'staffed') AND (j.date >= $1::date OR j.repeat IS NOT NULL))::int AS count
       FROM job_types t
      ORDER BY t.is_custom, t.created_at, t.label`,
    [today],
    db
  );
  // Пользовательский тип появляется в списке после публикации заказа — без заказов его не показываем.
  return r.rows.filter(t => !t.is_custom || t.count > 0).map(t => ({ id: t.id, label: t.label, custom: t.is_custom, count: t.count }));
}

// ───────────────────────── Карточка ─────────────────────────

export function initialsOf(name: string) {
  return String(name || '').replace(/[^А-Яа-яЁёA-Za-z ]/g, '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
}

export function shortName(name: string) {
  const [a, b] = String(name || '').trim().split(/\s+/);
  return b ? a + ' ' + b[0] + '.' : a || '';
}

async function loadJobRow(num: number, viewer: Viewer, db: Db) {
  const base = baseOf(viewer);
  return one<SummaryRow & {
    description: string; requirement: string | null; repeat_note: string | null; access: string[]; tools: string | null;
    meet_name: string | null; meet_phone: string | null; pay_when: string | null;
  }>(
    `SELECT ${SUMMARY_COLS}, j.description, j.requirement, j.repeat_note, j.access, j.tools, j.meet_name, j.meet_phone, j.pay_when
       FROM jobs j JOIN job_types t ON t.id = j.type_id
      WHERE j.num = $4`,
    [viewer?.id ?? null, base.lat, base.lng, num],
    db
  );
}

export async function getJob(num: number, viewer: Viewer, db: Db = pool()): Promise<JobDetail> {
  if (!Number.isSafeInteger(num) || num <= 0) throw new AppError(404, 'Заказ не найден.');
  const r = await loadJobRow(num, viewer, db);
  if (!r) throw new AppError(404, 'Заказ не найден — возможно, его удалили.');
  const owner = !!viewer && viewer.id === r.employer_id;

  const [emp, cancel, hiredRows] = await Promise.all([
    one<{ name: string; org_type: string | null; org_name: string | null; created_at: Date; rating: number | null; reviews: number; jobs: number }>(
      `SELECT u.name, p.org_type, p.org_name, u.created_at,
              (SELECT avg(rating)::float8 FROM reviews WHERE target_id = u.id) AS rating,
              (SELECT count(*) FROM reviews WHERE target_id = u.id)::int AS reviews,
              (SELECT count(*) FROM jobs WHERE employer_id = u.id)::int AS jobs
         FROM users u LEFT JOIN employer_profiles p ON p.user_id = u.id WHERE u.id = $1`,
      [r.employer_id], db),
    r.status === 'cancelled'
      ? one<{ reason: string; notice: string; late: boolean; at: Date }>('SELECT reason, notice, late, at FROM cancellations WHERE job_id = $1', [r.id], db)
      : Promise.resolve(null),
    query<{ freelancer_id: string; is_lead: boolean; name: string; app_id: string | null }>(
      `SELECT h.freelancer_id, h.is_lead, u.name, a.id AS app_id
         FROM hires h JOIN users u ON u.id = h.freelancer_id
         LEFT JOIN applications a ON a.job_id = h.job_id AND a.freelancer_id = h.freelancer_id
        WHERE h.job_id = $1 ORDER BY h.hired_at`,
      [r.id], db)
  ]);
  const empName = emp && emp.org_type && emp.org_type !== 'частное лицо' && emp.org_name ? emp.org_name : shortName(emp?.name || '');
  const hired = hiredRows.rows;
  const meHired = viewer?.role === 'freelancer' ? hired.find(h => h.freelancer_id === viewer.id) : undefined;
  // Телефон встречающего: владельцу и нанятому; в бригаде из нескольких человек — только старшему.
  const phoneForMe = owner || (!!meHired && (hired.length <= 1 || meHired.is_lead));

  let applicantList: Applicant[] | null = null;
  if (owner) {
    const apps = await query<{ id: string; freelancer_id: string; name: string; status: AppStatus; created_at: Date; no_show_count: number; gear: string[] | null; rating: number | null; done: number; is_lead: boolean | null; npd: boolean | null }>(
      `SELECT a.id, a.freelancer_id, u.name, a.status, a.created_at, u.no_show_count, fp.gear, (fp.npd_status = 'ok' AND fp.npd_checked_at > now() - interval '3 days') AS npd,
              (SELECT avg(rating)::float8 FROM reviews WHERE target_id = u.id) AS rating,
              (SELECT count(*) FROM hires h JOIN acceptances ac ON ac.job_id = h.job_id WHERE h.freelancer_id = u.id)::int AS done,
              (SELECT is_lead FROM hires h WHERE h.job_id = a.job_id AND h.freelancer_id = u.id) AS is_lead
         FROM applications a JOIN users u ON u.id = a.freelancer_id LEFT JOIN freelancer_profiles fp ON fp.user_id = u.id
        WHERE a.job_id = $1 AND a.status IN ('sent', 'hired')
        ORDER BY a.status = 'hired' DESC, a.created_at`,
      [r.id],
      db
    );
    applicantList = apps.rows.map(a => ({
      id: a.id, thread: a.freelancer_id, name: shortName(a.name), initials: initialsOf(a.name), rating: a.rating == null ? null : Math.round(a.rating * 10) / 10, done: a.done,
      noShows: a.no_show_count, gear: (a.gear || []).filter(g => g !== 'Ничего нет').slice(0, 2).join(', ') || 'свой инвентарь не указан',
      status: a.status, isLead: !!a.is_lead, appliedAt: a.created_at.toISOString(), npd: !!a.npd
    }));
  }

  const shift = viewer && (owner || meHired || r.my_status)
    ? await loadShift(r.id, r.employer_id, empName, hired, viewer, owner, db)
    : null;

  return {
    ...toSummary(r, viewer),
    description: r.description,
    requirement: r.requirement,
    repeatNote: r.repeat_note,
    access: r.access,
    tools: r.tools,
    meetName: r.meet_name,
    meetPhone: phoneForMe ? r.meet_phone : null,
    payWhen: r.pay_when,
    employer: {
      name: empName, initials: initialsOf(empName), orgType: emp?.org_type || 'частное лицо',
      rating: emp?.rating == null ? null : Math.round(emp.rating * 10) / 10, reviews: emp?.reviews ?? 0, jobs: emp?.jobs ?? 0,
      since: emp ? 'на площадке с ' + MONTHS_GEN[emp.created_at.getMonth()] + ' ' + emp.created_at.getFullYear() + ' года' : ''
    },
    cancellation: cancel && { reason: cancel.reason, notice: cancel.notice, late: cancel.late, at: cancel.at.toISOString() },
    applicantList,
    shift
  };
}

type HiredRow = { freelancer_id: string; is_lead: boolean; name: string; app_id: string | null };

async function loadShift(jobId: string, employerId: string, empName: string, hired: HiredRow[], viewer: NonNullable<Viewer>, owner: boolean, db: Db): Promise<ShiftInfo> {
  const [rep, acc, settle, reviews, complaint, withdrawal, noShow, msgs, photos, safety] = await Promise.all([
    one<{ reported_at: Date }>('SELECT reported_at FROM reports WHERE job_id = $1', [jobId], db),
    one<{ accepted_at: Date; auto: boolean }>('SELECT accepted_at, auto FROM acceptances WHERE job_id = $1', [jobId], db),
    one<{ employer_marked: boolean; freelancer_marked: boolean }>('SELECT employer_marked, freelancer_marked FROM settlements WHERE job_id = $1', [jobId], db),
    query<{ target_id: string; rating: number; text: string; editable_until: Date }>(
      'SELECT target_id, rating, text, editable_until FROM reviews WHERE job_id = $1 AND author_id = $2', [jobId, viewer.id], db),
    one<{ reason: string; created_at: Date }>('SELECT reason, created_at FROM complaints WHERE job_id = $1 AND author_id = $2 ORDER BY created_at DESC LIMIT 1', [jobId, viewer.id], db),
    owner ? Promise.resolve(null) : one<{ reason: string; notice: string; late: boolean; at: Date }>(
      'SELECT reason, notice, late, at FROM withdrawals WHERE job_id = $1 AND freelancer_id = $2 ORDER BY at DESC LIMIT 1', [jobId, viewer.id], db),
    owner ? Promise.resolve(null) : one<{ at: Date }>('SELECT at FROM no_shows WHERE job_id = $1 AND freelancer_id = $2', [jobId, viewer.id], db),
    owner ? Promise.resolve(null) : one<{ n: number }>('SELECT count(*)::int AS n FROM messages WHERE job_id = $1 AND freelancer_id = $2', [jobId, viewer.id], db),
    owner || hired.some(h => h.freelancer_id === viewer.id) ? jobPhotos(jobId, viewer.id, db) : Promise.resolve([]),
    query<{ freelancer_id: string; items: string[] }>(
      'SELECT freelancer_id, items FROM safety_checks WHERE job_id = $1 AND ($2 OR freelancer_id = $3)', [jobId, owner, viewer.id], db)
  ]);
  const lead = hired.find(h => h.is_lead);
  const meHired = hired.find(h => h.freelancer_id === viewer.id);
  const nameOf = (id: string) => (id === employerId ? empName : shortName(hired.find(h => h.freelancer_id === id)?.name || ''));
  const targetKey = (id: string) => (id === employerId ? 'employer' : hired.find(h => h.freelancer_id === id)?.app_id || id);
  const now = Date.now();
  return {
    hired: hired.map(h => ({ appId: owner ? h.app_id : null, thread: owner ? h.freelancer_id : null, name: shortName(h.name), isLead: h.is_lead, me: h.freelancer_id === viewer.id })),
    leadName: lead ? shortName(lead.name) : null,
    iAmLead: !!meHired?.is_lead,
    reportedAt: rep ? rep.reported_at.toISOString() : null,
    autoAcceptAt: rep && !acc ? new Date(rep.reported_at.getTime() + AUTO_ACCEPT_DAYS * 86400_000).toISOString() : null,
    acceptedAt: acc ? acc.accepted_at.toISOString() : null,
    autoAccepted: !!acc?.auto,
    settle: settle ? { employer: settle.employer_marked, freelancer: settle.freelancer_marked } : null,
    myReviews: reviews.rows.map(v => ({ target: targetKey(v.target_id), targetName: nameOf(v.target_id), rating: v.rating, text: v.text, editable: v.editable_until.getTime() > now })),
    reviewTargets: acc
      ? (owner ? hired.filter(h => h.app_id).map(h => ({ target: h.app_id!, name: shortName(h.name) })) : meHired ? [{ target: 'employer', name: empName }] : [])
      : [],
    myComplaint: complaint ? { reason: complaint.reason, at: complaint.created_at.toISOString() } : null,
    canChat: owner ? hired.length > 0 : !!meHired || !!(msgs && msgs.n > 0),
    myThread: owner ? null : viewer.id,
    withdrawal: withdrawal ? { reason: withdrawal.reason, notice: withdrawal.notice, late: withdrawal.late, at: withdrawal.at.toISOString() } : null,
    noShow: !!noShow,
    photos,
    safety: hired.filter(h => owner || h.freelancer_id === viewer.id).map(h => ({
      name: shortName(h.name), me: h.freelancer_id === viewer.id,
      items: safety.rows.find(r => r.freelancer_id === h.freelancer_id)?.items ?? []
    }))
  };
}

// ───────────────────────── Публикация и правка ─────────────────────────

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const sMulti = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function sanitizeJobForm(raw: unknown): JobForm {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const f = emptyJobForm();
  f.lat = num(r.lat);
  f.lng = num(r.lng);
  f.address = s(r.address, 200);
  f.district = s(r.district, 120);
  f.type = typeof r.type === 'string' && /^[a-z0-9_]{1,40}$/.test(r.type) ? r.type : '';
  f.typeOther = s(r.typeOther, 60);
  f.desc = sMulti(r.desc, 2000);
  f.volume = s(r.volume, 120);
  f.crew = String(r.crew ?? '1').replace(/\D/g, '').slice(0, 3) || '1';
  f.req = s(r.req, 300);
  f.pay = String(r.pay ?? '').replace(/\D/g, '').slice(0, 9);
  f.unit = s(r.unit, 30) || 'за заказ';
  f.payType = s(r.payType, 60);
  f.dateISO = typeof r.dateISO === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dateISO) ? r.dateISO : '';
  f.urgent = r.urgent === true;
  f.regular = r.regular === true;
  f.repeat = f.regular ? s(r.repeat, 60) : '';
  f.repeatNote = f.regular ? s(r.repeatNote, 200) : '';
  f.access = Array.isArray(r.access)
    ? [...new Set(r.access.filter((x): x is string => typeof x === 'string').map(x => s(x, 120)).filter(Boolean))].slice(0, 10)
    : [];
  f.tools = s(r.tools, 60);
  f.meetName = s(r.meetName, 80);
  f.meetPhone = s(r.meetPhone, 32);
  f.objectId = typeof r.objectId === 'string' && /^[0-9a-f-]{36}$/i.test(r.objectId) ? r.objectId : '';
  return f;
}

function validateJobForm(f: JobForm, today: string) {
  const errs = jobAllErrors(f);
  if (f.lat != null && f.lng != null && (Math.abs(f.lat) > 90 || Math.abs(f.lng) > 180)) errs.address = 'Метка вне карты — поставьте её заново.';
  if (!isKnownUnit(f.unit)) errs.unit = 'Выберите, за что платите.';
  if (f.payType && !isKnownPayType(f.payType)) errs.payType = 'Выберите способ оплаты из списка.';
  if (f.regular && f.repeat && !isKnownRepeat(f.repeat)) errs.repeat = 'Выберите график из списка.';
  if (f.tools && !isKnownTools(f.tools)) errs.tools = 'Отметьте, чей инвентарь на смене.';
  if (f.dateISO) {
    const ahead = daysAhead(f.dateISO, today);
    if (ahead == null || ahead < 0) errs.date = 'Дата выхода уже прошла — выберите сегодня или позже.';
    else if (ahead > 366) errs.date = 'Дата выхода — не дальше чем через год.';
  }
  if (f.meetPhone && f.meetPhone.replace(/\D/g, '').length < 10) errs.meetPhone = 'Проверьте телефон встречающего — нужно минимум 10 цифр.';
  const keys = Object.keys(errs);
  if (keys.length) {
    const first = keys.sort((a, b) => (JOB_FIELD_STEP[a] || 4) - (JOB_FIELD_STEP[b] || 4))[0];
    throw new AppError(422, errs[first], first, { fields: errs, step: JOB_FIELD_STEP[first] || 4 });
  }
  const hit = findBadField([
    { field: 'address', label: 'Адрес объекта', value: f.address },
    { field: 'type', label: 'Свой тип работы', value: f.typeOther },
    { field: 'desc', label: 'Что нужно сделать', value: f.desc },
    { field: 'volume', label: 'Объём работ', value: f.volume },
    { field: 'req', label: 'Своё условие для отклика', value: f.req },
    { field: 'repeat', label: 'График', value: f.repeatNote },
    { field: 'access', label: 'Доступ на объект', value: f.access },
    { field: 'meetName', label: 'Кто встречает на объекте', value: f.meetName }
  ]);
  if (hit) throw new ModerationError(hit.field, hit.label, hit.category);
}

/** Тип работы: из справочника или свой (заводится в справочнике и появляется в фильтре). */
async function resolveType(f: JobForm, userId: string, db: Db): Promise<{ id: string; label: string }> {
  if (f.type) {
    const t = await one<{ id: string; label: string }>('SELECT id, label FROM job_types WHERE id = $1', [f.type], db);
    if (t) return t;
  }
  const label = f.typeOther.trim();
  if (!label) throw new AppError(422, 'Впишите тип работы или выберите готовый из списка.', 'type', { step: 2 });
  const existing = await one<{ id: string; label: string }>('SELECT id, label FROM job_types WHERE lower(label) = lower($1)', [label], db);
  if (existing) return existing;
  const id = 'u_' + crypto.randomBytes(5).toString('hex');
  const t = await one<{ id: string; label: string }>(
    `INSERT INTO job_types (id, label, is_custom, created_by) VALUES ($1, $2, true, $3)
     ON CONFLICT (lower(label)) DO UPDATE SET label = job_types.label RETURNING id, label`,
    [id, label.charAt(0).toUpperCase() + label.slice(1), userId],
    db
  );
  return t!;
}

function assertEmployer(viewer: Viewer): asserts viewer is NonNullable<Viewer> {
  if (!viewer) throw new AppError(401, 'Нужно войти в аккаунт работодателя.');
  if (viewer.role !== 'employer') throw new AppError(403, 'Заказы размещает только работодатель — для этого нужен отдельный аккаунт.');
}

export async function createJob(raw: unknown, viewer: Viewer, todayRaw: unknown): Promise<JobDetail> {
  assertEmployer(viewer);
  const today = clientToday(todayRaw);
  const f = sanitizeJobForm(raw);
  validateJobForm(f, today);
  await limitOrThrow(`job:create:${viewer.id}`, 30, 86400, 'Сегодня опубликовано слишком много заказов — продолжите завтра или напишите в поддержку.');

  const num = await tx(async (db) => {
    const type = await resolveType(f, viewer.id, db);
    const ahead = daysAhead(f.dateISO, today) ?? 99;
    const crew = parseInt(f.crew, 10) === CREW_ANY ? CREW_ANY : Math.min(12, Math.max(1, parseInt(f.crew, 10) || 1));
    const row = await one<{ id: string; num: string }>(
      `INSERT INTO jobs (employer_id, type_id, title, description, address, lat, lng, district, pay, unit, pay_type, date, volume,
                         crew, urgent, repeat, repeat_note, requirement, access, tools, meet_name, meet_phone, object_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
               (SELECT id FROM objects WHERE id = $23::uuid AND employer_id = $1))
       RETURNING id, num`,
      [viewer.id, type.id, autoTitle(type.label, f.address), f.desc, f.address, f.lat, f.lng, f.district || null,
        payNumber(f.pay), f.unit, f.payType || null, f.dateISO, f.volume || null, crew, f.urgent || ahead <= 1,
        f.regular ? f.repeat : null, f.regular ? f.repeatNote || null : null, f.req || null, f.access, f.tools,
        f.meetName || null, f.meetPhone || null, f.objectId || null],
      db
    );
    await addEvents([{ userId: viewer.id, kind: 'job', text: 'Заказ опубликован — № ' + jobNum(Number(row!.num)), jobId: row!.id, num: Number(row!.num), silent: true }], db);
    return Number(row!.num);
  });
  // «Новая смена рядом» — вне транзакции публикации: сбой рассылки не должен отменять заказ.
  await notifyNearby(num).catch(e => console.error('[nearby]', (e as Error).message));
  return getJob(num, viewer);
}

async function ownJob(num: number, viewer: NonNullable<Viewer>, db: Db, lock = false) {
  const j = await one<{ id: string; employer_id: string; status: JobStatus; hired: number; date: string; title: string }>(
    `SELECT j.id, j.employer_id, j.status, to_char(j.date, 'YYYY-MM-DD') AS date, j.title,
            (SELECT count(*) FROM hires h WHERE h.job_id = j.id)::int AS hired
       FROM jobs j WHERE j.num = $1${lock ? ' FOR UPDATE OF j' : ''}`,
    [num],
    db
  );
  if (!j) throw new AppError(404, 'Заказ не найден.');
  if (j.employer_id !== viewer.id) throw new AppError(403, 'Это заказ другого работодателя.');
  return j;
}

/** Правка условий: только пока никого не наняли. Откликнувшимся уходит уведомление. */
export async function updateJob(num: number, raw: unknown, viewer: Viewer, todayRaw: unknown): Promise<JobDetail> {
  assertEmployer(viewer);
  const today = clientToday(todayRaw);
  const f = sanitizeJobForm(raw);
  validateJobForm(f, today);
  await tx(async (db) => {
    const j = await ownJob(num, viewer, db, true);
    if (j.status === 'cancelled') throw new AppError(409, 'Заказ отменён — его уже не изменить.');
    if (j.status !== 'open' || j.hired > 0) throw new AppError(409, 'Исполнитель уже нанят — условия меняются только по договорённости в чате. Дату можно перенести.');
    const type = await resolveType(f, viewer.id, db);
    const ahead = daysAhead(f.dateISO, today) ?? 99;
    const crew = parseInt(f.crew, 10) === CREW_ANY ? CREW_ANY : Math.min(12, Math.max(1, parseInt(f.crew, 10) || 1));
    await query(
      `UPDATE jobs SET type_id = $2, title = $3, description = $4, address = $5, lat = $6, lng = $7, district = $8, pay = $9, unit = $10,
              pay_type = $11, date = $12, volume = $13, crew = $14, urgent = $15, repeat = $16, repeat_note = $17, requirement = $18,
              access = $19, tools = $20, meet_name = $21, meet_phone = $22, updated_at = now()
        WHERE id = $1`,
      [j.id, type.id, autoTitle(type.label, f.address), f.desc, f.address, f.lat, f.lng, f.district || null, payNumber(f.pay), f.unit,
        f.payType || null, f.dateISO, f.volume || null, crew, f.urgent || ahead <= 1, f.regular ? f.repeat : null,
        f.regular ? f.repeatNote || null : null, f.req || null, f.access, f.tools, f.meetName || null, f.meetPhone || null],
      db
    );
    const sent = await query<{ freelancer_id: string }>(`SELECT freelancer_id FROM applications WHERE job_id = $1 AND status = 'sent'`, [j.id], db);
    await addEvents(sent.rows.map(a => ({ userId: a.freelancer_id, kind: 'job', text: 'Условия заказа № ' + jobNum(num) + ' изменились — проверьте карточку', jobId: j.id, num })), db);
    await publish(sent.rows.map(a => a.freelancer_id), { t: 'job', num }, db);
  });
  return getJob(num, viewer);
}

/** Отмена работодателем. Меньше суток до выхода при нанятых — пометка на 90 дней. */
export async function cancelJob(num: number, raw: unknown, viewer: Viewer): Promise<JobDetail> {
  assertEmployer(viewer);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const reason = s(r.reason, 200);
  const notice = typeof r.notice === 'string' && NOTICES.includes(r.notice) ? r.notice : '';
  if (!reason) throw new AppError(422, 'Укажите причину отмены — её увидят откликнувшиеся.', 'reason');
  if (!notice) throw new AppError(422, 'Отметьте, за сколько вы предупреждаете.', 'notice');
  const cat = badWordIn(reason);
  if (cat) throw new ModerationError('reason', 'Причина', cat);

  await tx(async (db) => {
    const j = await ownJob(num, viewer, db, true);
    if (j.status === 'accepted') throw new AppError(409, 'Принятую работу отменить нельзя — напишите в чат и оставьте отзыв.');
    if (j.status === 'cancelled') throw new AppError(409, 'Заказ уже отменён.');
    const late = notice === 'меньше суток' && j.hired > 0;
    await query('INSERT INTO cancellations (job_id, by_role, reason, notice, late) VALUES ($1, $2, $3, $4, $5)', [j.id, 'employer', reason, notice, late], db);
    await query(`UPDATE jobs SET status = 'cancelled', updated_at = now() WHERE id = $1`, [j.id], db);
    // Отклики закрываются; нанятые и откликнувшиеся узнают о причине.
    const people = await query<{ freelancer_id: string }>(`SELECT freelancer_id FROM applications WHERE job_id = $1 AND status IN ('sent', 'hired')`, [j.id], db);
    await addEvents(people.rows.map(a => ({ userId: a.freelancer_id, kind: 'cancel', text: 'Заказ № ' + jobNum(num) + ' «' + j.title + '» отменён: ' + reason, jobId: j.id, num, deliver: true, urgent: notice === 'меньше суток' })), db);
    await publish(people.rows.map(a => a.freelancer_id), { t: 'job', num }, db);
    await query(`UPDATE applications SET status = 'rejected', updated_at = now() WHERE job_id = $1 AND status = 'sent'`, [j.id], db);
    if (late) {
      await query(
        `INSERT INTO user_marks (user_id, kind, reason, job_id, until) VALUES ($1, 'late_cancel', $2, $3, now() + make_interval(days => $4))`,
        [viewer.id, 'Поздняя отмена смены: ' + reason, j.id, LATE_MARK_DAYS],
        db
      );
    }
  });
  return getJob(num, viewer);
}

// ───────────────────────── Отклик ─────────────────────────

export async function applyToJob(num: number, raw: unknown, viewer: Viewer, todayRaw: unknown): Promise<JobDetail> {
  if (!viewer) throw new AppError(401, 'Чтобы откликнуться, нужен профиль исполнителя.');
  if (viewer.role !== 'freelancer') throw new AppError(403, 'Откликаться может только исполнитель.');
  const today = clientToday(todayRaw);
  const reqConfirmed = !!(raw && typeof raw === 'object' && (raw as Record<string, unknown>).reqConfirmed === true);
  await limitOrThrow(`apply:${viewer.id}`, 60, 3600, 'Слишком много откликов за час — передохните и продолжите позже.');

  await tx(async (db) => {
    const j = await one<{ id: string; employer_id: string; status: JobStatus; crew: number; requirement: string | null; date: string; repeat: string | null; title: string; hired: number }>(
      `SELECT j.id, j.employer_id, j.status, j.crew, j.requirement, to_char(j.date, 'YYYY-MM-DD') AS date, j.repeat, j.title,
              (SELECT count(*) FROM hires h WHERE h.job_id = j.id)::int AS hired
         FROM jobs j WHERE j.num = $1 FOR UPDATE OF j`,
      [num],
      db
    );
    if (!j) throw new AppError(404, 'Заказ не найден.');
    if (j.status === 'cancelled' || j.status === 'accepted' || j.status === 'reported') throw new AppError(409, 'Заказ закрыт или отменён — отклик не принимается.');
    if (j.crew < CREW_ANY && j.hired >= j.crew) throw new AppError(409, 'Смена уже набрана — отклики закрыты.');
    if (!j.repeat && j.date < today) throw new AppError(409, 'Дата выхода уже прошла — отклик не принимается.');
    if (j.requirement && !reqConfirmed) throw new AppError(422, 'Подтвердите условие работодателя: ' + j.requirement, 'req');

    const prev = await one<{ status: AppStatus }>('SELECT status FROM applications WHERE job_id = $1 AND freelancer_id = $2', [j.id, viewer.id], db);
    if (prev?.status === 'sent') throw new AppError(409, 'Отклик уже отправлен.');
    if (prev?.status === 'hired') throw new AppError(409, 'Вы уже наняты на этот заказ.');
    if (prev?.status === 'rejected') throw new AppError(409, 'Работодатель уже ответил отказом на этот заказ.');
    if (prev) {
      await query(`UPDATE applications SET status = 'sent', req_confirmed = $3, updated_at = now() WHERE job_id = $1 AND freelancer_id = $2`,
        [j.id, viewer.id, !!j.requirement], db);
    } else {
      await query('INSERT INTO applications (job_id, freelancer_id, req_confirmed) VALUES ($1, $2, $3)', [j.id, viewer.id, !!j.requirement], db);
    }
    const me = await one<{ name: string }>('SELECT name FROM users WHERE id = $1', [viewer.id], db);
    await query(`INSERT INTO events (user_id, kind, text, job_id) VALUES ($1, 'application', $2, $3)`,
      [viewer.id, 'Отклик отправлен · заказ № ' + jobNum(num) + ' «' + j.title + '»', j.id], db);
    await addEvents([{ userId: j.employer_id, kind: 'application', text: 'Новый отклик · заказ № ' + jobNum(num) + ' «' + j.title + '» — ' + shortName(me?.name || 'исполнитель'), jobId: j.id, num, deliver: true }], db);
    await publish([j.employer_id], { t: 'job', num }, db);
  });
  return getJob(num, viewer);
}

/** Отзыв отклика до найма — без последствий. После найма — отказ от смены с причиной (жизненный цикл смены). */
export async function withdrawApplication(num: number, viewer: Viewer): Promise<JobDetail> {
  if (!viewer || viewer.role !== 'freelancer') throw new AppError(403, 'Отзывать отклик может только исполнитель.');
  await tx(async (db) => {
    const a = await one<{ job_id: string; status: AppStatus; employer_id: string; title: string }>(
      `SELECT a.job_id, a.status, j.employer_id, j.title FROM applications a JOIN jobs j ON j.id = a.job_id
        WHERE j.num = $1 AND a.freelancer_id = $2 FOR UPDATE OF a`,
      [num, viewer.id],
      db
    );
    if (!a || a.status === 'withdrawn') throw new AppError(409, 'Отклика на этот заказ нет.');
    if (a.status === 'hired') throw new AppError(409, 'Вы уже наняты — откажитесь от смены с причиной и сроком предупреждения.');
    if (a.status === 'rejected') throw new AppError(409, 'Работодатель уже ответил на отклик.');
    await query(`UPDATE applications SET status = 'withdrawn', withdrawn_at = now(), updated_at = now() WHERE job_id = $1 AND freelancer_id = $2`,
      [a.job_id, viewer.id], db);
    await addEvents([{ userId: a.employer_id, kind: 'application', text: 'Исполнитель отозвал отклик · заказ № ' + jobNum(num) + ' «' + a.title + '»', jobId: a.job_id, num }], db);
    await publish([a.employer_id], { t: 'job', num }, db);
  });
  return getJob(num, viewer);
}


/**
 * «Новая смена рядом»: исполнителям, у кого база в радиусе оповещений (настройка «Радиус от дома»).
 * Навыки не отсекают — только ставят выше. С выключенными оповещениями событие остаётся в журнале без доставки.
 */
export async function notifyNearby(num: number, db: Db = pool()) {
  const j = await one<{ id: string; title: string; lat: number; lng: number; pay: number; unit: string; urgent: boolean; type_id: string; date: string }>(
    `SELECT id, title, lat, lng, pay, unit, urgent, type_id, to_char(date, 'YYYY-MM-DD') AS date FROM jobs WHERE num = $1`, [num], db);
  if (!j) return 0;
  const people = await query<{ id: string; km: number }>(
    `SELECT u.id, earth_distance(ll_to_earth(u.base_lat, u.base_lng), ll_to_earth($1, $2)) / 1000 AS km
       FROM users u JOIN notification_settings ns ON ns.user_id = u.id
       LEFT JOIN freelancer_profiles fp ON fp.user_id = u.id
      WHERE u.role = 'freelancer' AND u.status = 'active' AND u.base_lat IS NOT NULL
        AND earth_box(ll_to_earth($1, $2), 300000) @> ll_to_earth(u.base_lat, u.base_lng)
        AND earth_distance(ll_to_earth(u.base_lat, u.base_lng), ll_to_earth($1, $2)) <= ns.radius_km * 1000
      ORDER BY ($3 = ANY(coalesce(fp.skills, '{}'))) DESC, km
      LIMIT 500`,
    [j.lat, j.lng, j.type_id], db);
  const price = j.pay.toLocaleString('ru-RU') + ' ₽' + (j.unit === 'за заказ' ? '' : ' ' + j.unit);
  await addEvents(people.rows.map(p => ({
    userId: p.id, kind: 'nearby', jobId: j.id, num, deliver: true, urgent: j.urgent,
    text: (j.urgent ? 'Срочная смена' : 'Новая смена') + ' в ' + (p.km < 10 ? p.km.toFixed(1) : Math.round(p.km)) + ' км: ' + j.title + ' · ' + price
  })), db);
  return people.rows.length;
}
