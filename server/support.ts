// Кабинет поддержки: очередь жалоб, поиск пользователей, блокировка, журнал действий сотрудников.
// Доступ — только у сотрудников (users.is_staff; выдаётся командой `npm run staff -- add <логин>`).
import { jobNum } from '@/lib/jobs';
import { config } from './config';
import { one, query, tx, type Db } from './db';
import { AppError } from './errors';
import { addEvents } from './events';
import { invalidateSearch } from './jobs';
import { publish } from './live';
import type { SessionUser } from './session';

type U = Pick<SessionUser, 'id'> | null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARK_DAYS = 90;

export async function isStaff(u: U): Promise<boolean> {
  if (!u) return false;
  return !!(await one<{ ok: boolean }>('SELECT is_staff AS ok FROM users WHERE id = $1 AND status = $2', [u.id, 'active']))?.ok;
}

async function needStaff(u: U): Promise<string> {
  if (!u) throw new AppError(401, 'Нужно войти в аккаунт.');
  // Для посторонних раздела нет — 404, а не 403.
  if (!(await isStaff(u))) throw new AppError(404, 'Страница не найдена.');
  return u.id;
}

async function audit(staffId: string, action: string, userId: string | null, complaintId: string | null, note: string, db: Db) {
  await query('INSERT INTO staff_actions (staff_id, action, user_id, complaint_id, note) VALUES ($1, $2, $3, $4, $5)', [staffId, action, userId, complaintId, note], db);
}

// ───────────────────────── Жалобы ─────────────────────────

export type ComplaintRow = {
  id: string; status: 'open' | 'confirmed' | 'rejected'; reason: string; text: string; at: string;
  num: number; title: string; jobStatus: string;
  author: { id: string; name: string; login: string; role: string };
  target: { id: string; name: string; login: string; role: string; marks: number; complaints: number } | null;
  resolution: string | null; resolvedAt: string | null;
  assignee: { id: string; name: string } | null; deadline: string; overdue: boolean;
};

// ───────────────────────── SLA ─────────────────────────

/** Обещанный ответ — «в течение 3 рабочих дней»: срок считается по будням в часовом поясе площадки. */
export const SLA_BUSINESS_DAYS = 3;
export function slaDeadline(created: Date, days = SLA_BUSINESS_DAYS, tz = config.timeZone()): Date {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const d = new Date(created);
  let left = days;
  while (left > 0) {
    d.setTime(d.getTime() + 86400_000);
    const w = weekday.format(d);
    if (w !== 'Sat' && w !== 'Sun') left--;
  }
  return d;
}

/** Жалоба исполнителя без адресата — на работодателя заказа. */
const TARGET = 'coalesce(c.target_id, CASE WHEN a.role = \'freelancer\' THEN j.employer_id END)';

export async function listComplaints(viewer: U, status: unknown, mine?: boolean): Promise<ComplaintRow[]> {
  const staffId = await needStaff(viewer);
  const st = status === 'confirmed' || status === 'rejected' || status === 'all' ? status : 'open';
  const r = await query<{
    id: string; status: ComplaintRow['status']; reason: string; text: string; created_at: Date; num: string; title: string; job_status: string;
    a_id: string; a_name: string; a_login: string; a_role: string; t_id: string | null; t_name: string | null; t_login: string | null; t_role: string | null;
    t_marks: number; t_complaints: number; resolution: string | null; resolved_at: Date | null; assigned_to: string | null; assignee: string | null;
  }>(
    `SELECT c.id, c.status, c.reason, c.text, c.created_at, j.num, j.title, j.status AS job_status,
            a.id AS a_id, a.name AS a_name, a.login AS a_login, a.role AS a_role,
            t.id AS t_id, t.name AS t_name, t.login AS t_login, t.role AS t_role,
            (SELECT count(*) FROM user_marks m WHERE m.user_id = t.id AND coalesce(m.until, m.created_at + interval '90 days') > now())::int AS t_marks,
            (SELECT count(*) FROM complaints c2 WHERE coalesce(c2.target_id, (SELECT employer_id FROM jobs WHERE id = c2.job_id)) = t.id)::int AS t_complaints,
            c.resolution, c.resolved_at, c.assigned_to, s.name AS assignee
       FROM complaints c JOIN jobs j ON j.id = c.job_id JOIN users a ON a.id = c.author_id
       LEFT JOIN users t ON t.id = ${TARGET}
       LEFT JOIN users s ON s.id = c.assigned_to
      WHERE ($1 = 'all' OR c.status = $1) AND (NOT $2 OR c.assigned_to = $3)
      ORDER BY CASE WHEN c.status = 'open' THEN c.created_at END, c.resolved_at DESC NULLS LAST
      LIMIT 100`, [st, mine === true, staffId]);
  return r.rows.map(c => ({
    id: c.id, status: c.status, reason: c.reason, text: c.text, at: c.created_at.toISOString(),
    num: Number(c.num), title: c.title, jobStatus: c.job_status,
    author: { id: c.a_id, name: c.a_name, login: c.a_login, role: c.a_role },
    target: c.t_id ? { id: c.t_id, name: c.t_name!, login: c.t_login!, role: c.t_role!, marks: c.t_marks, complaints: c.t_complaints } : null,
    resolution: c.resolution, resolvedAt: c.resolved_at ? c.resolved_at.toISOString() : null,
    assignee: c.assigned_to ? { id: c.assigned_to, name: c.assignee! } : null,
    deadline: slaDeadline(c.created_at).toISOString(),
    overdue: c.status === 'open' && slaDeadline(c.created_at) < new Date()
  }));
}

/** Решение по жалобе: подтверждённая — пометка на 90 дней тому, на кого жаловались. Обе стороны узнают итог. */
export async function resolveComplaint(viewer: U, id: string, raw: unknown) {
  const staff = await needStaff(viewer);
  if (!UUID_RE.test(id)) throw new AppError(404, 'Жалоба не найдена.');
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const decision = r.decision === 'confirmed' || r.decision === 'rejected' ? r.decision : null;
  const note = typeof r.note === 'string' ? r.note.trim().slice(0, 1000) : '';
  if (!decision) throw new AppError(422, 'Выберите решение: подтвердить или отклонить.', 'decision');
  if (note.length < 5) throw new AppError(422, 'Напишите пару слов о решении — их увидит автор жалобы.', 'note');
  await tx(async (db) => {
    const c = await one<{ id: string; status: string; reason: string; author_id: string; target: string | null; job_id: string; num: string; title: string }>(
      `SELECT c.id, c.status, c.reason, c.author_id, ${TARGET} AS target, c.job_id, j.num, j.title
         FROM complaints c JOIN jobs j ON j.id = c.job_id JOIN users a ON a.id = c.author_id
        WHERE c.id = $1 FOR UPDATE OF c`, [id], db);
    if (!c) throw new AppError(404, 'Жалоба не найдена.');
    if (c.status !== 'open') throw new AppError(409, 'По этой жалобе уже есть решение.');
    await query(`UPDATE complaints SET status = $2, resolution = $3, resolved_by = $4, resolved_at = now() WHERE id = $1`, [id, decision, note, staff], db);
    const label = 'заказ № ' + jobNum(Number(c.num)) + ' «' + c.title + '»';
    const rows: Parameters<typeof addEvents>[0] = [{
      userId: c.author_id, kind: 'complaint', jobId: c.job_id, num: Number(c.num), deliver: true,
      text: 'Жалоба «' + c.reason + '» по ' + label + (decision === 'confirmed' ? ' подтверждена: ' : ' отклонена: ') + note
    }];
    if (decision === 'confirmed' && c.target) {
      await query(`INSERT INTO user_marks (user_id, kind, reason, job_id, until) VALUES ($1, 'complaint', $2, $3, now() + make_interval(days => $4))`,
        [c.target, c.reason, c.job_id, MARK_DAYS], db);
      rows.push({ userId: c.target, kind: 'complaint', jobId: c.job_id, num: Number(c.num), deliver: true,
        text: 'Площадка подтвердила жалобу «' + c.reason + '» по ' + label + '. Пометка видна в профиле ' + MARK_DAYS + ' дней: ' + note });
    }
    await addEvents(rows, db);
    await audit(staff, 'complaint_' + decision, c.target, id, note, db);
  });
  return { ok: true };
}

// ───────────────────────── Пользователи ─────────────────────────

export type UserRow = {
  id: string; login: string; name: string; phone: string; email: string; role: string; status: string; isStaff: boolean; createdAt: string;
  jobs: number; done: number; noShows: number; complaints: number; marks: number;
  actions: { action: string; note: string; at: string }[];
};

export async function findUsers(viewer: U, q: unknown): Promise<UserRow[]> {
  await needStaff(viewer);
  const s = typeof q === 'string' ? q.trim().slice(0, 80) : '';
  if (s.length < 2) return [];
  const digits = s.replace(/\D/g, '');
  const like = '%' + s.toLowerCase().replace(/[\\%_]/g, m => '\\' + m) + '%';
  const r = await query<{
    id: string; login: string; name: string; phone: string; email: string; role: string; status: string; is_staff: boolean; created_at: Date;
    jobs: number; done: number; no_show_count: number; complaints: number; marks: number;
  }>(
    `SELECT u.id, u.login, u.name, u.phone, u.email, u.role, u.status, u.is_staff, u.created_at, u.no_show_count,
            CASE WHEN u.role = 'employer' THEN (SELECT count(*) FROM jobs WHERE employer_id = u.id)
                 ELSE (SELECT count(*) FROM applications WHERE freelancer_id = u.id) END::int AS jobs,
            CASE WHEN u.role = 'employer' THEN (SELECT count(*) FROM jobs WHERE employer_id = u.id AND status = 'accepted')
                 ELSE (SELECT count(*) FROM hires h JOIN acceptances ac ON ac.job_id = h.job_id WHERE h.freelancer_id = u.id) END::int AS done,
            (SELECT count(*) FROM complaints c WHERE coalesce(c.target_id, (SELECT employer_id FROM jobs WHERE id = c.job_id)) = u.id)::int AS complaints,
            (SELECT count(*) FROM user_marks m WHERE m.user_id = u.id AND coalesce(m.until, m.created_at + interval '90 days') > now())::int AS marks
       FROM users u
      WHERE lower(u.login) LIKE $1 OR lower(u.name) LIKE $1 OR lower(u.email) LIKE $1 OR ($2 <> '' AND length($2) >= 4 AND u.phone_key LIKE '%' || $2 || '%')
      ORDER BY u.created_at DESC LIMIT 20`, [like, digits.slice(-10)]);
  const acts = await query<{ user_id: string; action: string; note: string; created_at: Date }>(
    `SELECT user_id, action, note, created_at FROM staff_actions WHERE user_id = ANY($1::uuid[]) ORDER BY created_at DESC`, [r.rows.map(u => u.id)]);
  return r.rows.map(u => ({
    id: u.id, login: u.login, name: u.name, phone: u.phone, email: u.email, role: u.role, status: u.status, isStaff: u.is_staff,
    createdAt: u.created_at.toISOString(), jobs: u.jobs, done: u.done, noShows: u.no_show_count, complaints: u.complaints, marks: u.marks,
    actions: acts.rows.filter(a => a.user_id === u.id).slice(0, 5).map(a => ({ action: a.action, note: a.note, at: a.created_at.toISOString() }))
  }));
}

/**
 * Блокировка: вход закрыт (сессии удаляются), открытые заказы работодателя отменяются площадкой,
 * отклики исполнителя в ожидании снимаются. Разблокировка возвращает только вход.
 */
export async function setBlocked(viewer: U, userId: string, raw: unknown) {
  const staff = await needStaff(viewer);
  if (!UUID_RE.test(userId)) throw new AppError(404, 'Пользователь не найден.');
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const blocked = r.blocked === true;
  const note = typeof r.note === 'string' ? r.note.trim().slice(0, 1000) : '';
  if (note.length < 5) throw new AppError(422, 'Укажите причину — она попадёт в журнал действий.', 'note');
  if (userId === staff) throw new AppError(409, 'Себя заблокировать нельзя.');
  let cancelled = 0;
  await tx(async (t) => {
    const u = await one<{ role: string; status: string; is_staff: boolean }>('SELECT role, status, is_staff FROM users WHERE id = $1 FOR UPDATE', [userId], t);
    if (!u) throw new AppError(404, 'Пользователь не найден.');
    if (u.is_staff) throw new AppError(409, 'Сотрудника сначала нужно снять с роли поддержки.');
    if ((u.status === 'blocked') === blocked) throw new AppError(409, blocked ? 'Уже заблокирован.' : 'Уже активен.');
    await query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [userId, blocked ? 'blocked' : 'active'], t);
    if (blocked) {
      await query('DELETE FROM sessions WHERE user_id = $1', [userId], t);
      await query(`INSERT INTO user_marks (user_id, kind, reason) VALUES ($1, 'blocked', $2)`, [userId, note], t);
      if (u.role === 'employer') {
        const jobs = await query<{ id: string; num: string; title: string }>(
          `SELECT id, num, title FROM jobs WHERE employer_id = $1 AND status IN ('open', 'staffed') FOR UPDATE`, [userId], t);
        for (const j of jobs.rows) {
          await query(`INSERT INTO cancellations (job_id, by_role, reason, notice, late) VALUES ($1, 'platform', $2, 'меньше суток', false)`,
            [j.id, 'заказ снят площадкой'], t);
          await query(`UPDATE jobs SET status = 'cancelled', updated_at = now() WHERE id = $1`, [j.id], t);
          invalidateSearch();
          const people = await query<{ freelancer_id: string }>(`SELECT freelancer_id FROM applications WHERE job_id = $1 AND status IN ('sent', 'hired')`, [j.id], t);
          await query(`UPDATE applications SET status = 'rejected', updated_at = now() WHERE job_id = $1 AND status = 'sent'`, [j.id], t);
          await addEvents(people.rows.map(p => ({
            userId: p.freelancer_id, kind: 'cancel', jobId: j.id, num: Number(j.num), deliver: true, urgent: true,
            text: 'Заказ № ' + jobNum(Number(j.num)) + ' «' + j.title + '» снят площадкой — работодатель заблокирован. Не выходите на эту смену.'
          })), t);
          await publish(people.rows.map(p => p.freelancer_id), { t: 'job', num: Number(j.num) }, t);
          cancelled++;
        }
      } else {
        await query(`UPDATE applications SET status = 'withdrawn', withdrawn_at = now(), updated_at = now() WHERE freelancer_id = $1 AND status = 'sent'`, [userId], t);
      }
    }
    await audit(staff, blocked ? 'block' : 'unblock', userId, null, note, t);
  });
  return { ok: true, cancelled };
}


// ───────────────────────── Назначение и шаблоны ─────────────────────────

/** «Взять себе» / «Снять с себя» / передать другому сотруднику. */
export async function assign(viewer: U, kind: unknown, id: string, raw: unknown) {
  const staff = await needStaff(viewer);
  if (kind !== 'complaint' && kind !== 'dispute') throw new AppError(404, 'Страница не найдена.');
  if (!UUID_RE.test(id)) throw new AppError(404, 'Обращение не найдено.');
  const to = (raw as Record<string, unknown> | null)?.to;
  const target = to === null ? null : typeof to === 'string' && UUID_RE.test(to) ? to : staff;
  if (target && !(await one('SELECT 1 FROM users WHERE id = $1 AND is_staff', [target]))) throw new AppError(422, 'Назначить можно только сотрудника поддержки.');
  const table = kind === 'complaint' ? 'complaints' : 'disputes';
  const open = kind === 'complaint' ? "status = 'open'" : "status IN ('open', 'review')";
  const r = await query(`UPDATE ${table} SET assigned_to = $2 WHERE id = $1 AND ${open}`, [id, target]);
  if (!r.rowCount) throw new AppError(409, 'Обращение уже закрыто.');
  await query('INSERT INTO staff_actions (staff_id, action, note) VALUES ($1, $2, $3)', [staff, 'assign_' + kind, id + ' → ' + (target ?? 'никому')]);
  return { ok: true };
}

export async function listStaff(viewer: U) {
  await needStaff(viewer);
  return (await query<{ id: string; name: string }>(`SELECT id, name FROM users WHERE is_staff AND status = 'active' ORDER BY name`)).rows;
}

export type Template = { id: string; kind: 'complaint' | 'dispute' | 'any'; title: string; body: string };

export async function listTemplates(viewer: U): Promise<Template[]> {
  await needStaff(viewer);
  return (await query<Template>('SELECT id, kind, title, body FROM support_templates ORDER BY kind, title')).rows;
}

export async function saveTemplate(viewer: U, raw: unknown, id?: string): Promise<Template> {
  const staff = await needStaff(viewer);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = r.kind === 'complaint' || r.kind === 'dispute' ? r.kind : 'any';
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, 80) : '';
  const body = typeof r.body === 'string' ? r.body.trim().slice(0, 1000) : '';
  if (!title) throw new AppError(422, 'Назовите шаблон.', 'title');
  if (body.length < 5) throw new AppError(422, 'Напишите текст шаблона.', 'body');
  if (id) {
    if (!UUID_RE.test(id)) throw new AppError(404, 'Шаблон не найден.');
    const u = await one<Template>('UPDATE support_templates SET kind = $2, title = $3, body = $4 WHERE id = $1 RETURNING id, kind, title, body', [id, kind, title, body]);
    if (!u) throw new AppError(404, 'Шаблон не найден.');
    return u;
  }
  return (await one<Template>('INSERT INTO support_templates (kind, title, body, created_by) VALUES ($1, $2, $3, $4) RETURNING id, kind, title, body', [kind, title, body, staff]))!;
}

export async function deleteTemplate(viewer: U, id: string) {
  await needStaff(viewer);
  if (!UUID_RE.test(id)) throw new AppError(404, 'Шаблон не найден.');
  await query('DELETE FROM support_templates WHERE id = $1', [id]);
  return { ok: true };
}
