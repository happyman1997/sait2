// Жизненный цикл смены: Отклик → Найм → Работа принята. Все правила README проверяются на сервере.
// Отметки выхода/геометки и споров нет (решение заказчика). Деньги идут напрямую между сторонами.
import { CREW_ANY } from '@/lib/catalog';
import {
  SAFETY_ITEMS, dateLabel, seriesDates, seriesDayLabel, SERIES_STEP,
  AUTO_ACCEPT_DAYS, COMPLAINT_KINDS, daysAhead, HIRE_GREETING, jobNum, LEAVE_REASONS, REPORT_MESSAGE, REVIEW_EDIT_MIN,
  type AppStatus, type ChatMessage, type ChatThread, type JobDetail, type JobStatus, type MyJob
} from '@/lib/jobs';
import { badWordIn, findBadField } from '@/lib/moderation';
import { one, pool, query, tx, type Db } from './db';
import { AppError, ModerationError } from './errors';
import { addEvents, localClock, mailSupport } from './events';
import { clientToday, getJob, initialsOf, invalidateSearch, shortName } from './jobs';
import { publish } from './live';
import { limitOrThrow } from './rate-limit';
import type { SessionUser } from './session';

type Viewer = Pick<SessionUser, 'id' | 'role' | 'city' | 'base_lat' | 'base_lng'> | null;
type U = NonNullable<Viewer>;

const LATE_MARK_DAYS = 90;
const NOTICES = ['больше суток', 'меньше суток'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JobRow = { id: string; num: number; employer_id: string; status: JobStatus; crew: number; title: string; date: string; repeat: string | null };

async function lockJob(num: number, db: Db): Promise<JobRow> {
  const j = await one<JobRow & { num: string }>(
    `SELECT id, num, employer_id, status, crew, title, to_char(date, 'YYYY-MM-DD') AS date, repeat FROM jobs WHERE num = $1 FOR UPDATE`,
    [num], db);
  if (!j) throw new AppError(404, 'Заказ не найден.');
  return { ...j, num: Number(j.num) };
}

function needUser(viewer: Viewer): U {
  if (!viewer) throw new AppError(401, 'Нужно войти в аккаунт.');
  return viewer;
}

function needOwner(j: JobRow, viewer: Viewer): U {
  const u = needUser(viewer);
  if (u.role !== 'employer' || u.id !== j.employer_id) throw new AppError(403, 'Это может сделать только работодатель этого заказа.');
  return u;
}

const hiredOf = (jobId: string, db: Db) =>
  query<{ freelancer_id: string; is_lead: boolean }>('SELECT freelancer_id, is_lead FROM hires WHERE job_id = $1 ORDER BY hired_at', [jobId], db).then(r => r.rows);

const openApplicants = (jobId: string, db: Db) =>
  query<{ freelancer_id: string }>(`SELECT freelancer_id FROM applications WHERE job_id = $1 AND status = 'sent'`, [jobId], db).then(r => r.rows.map(x => x.freelancer_id));

async function userName(id: string, db: Db) {
  return shortName((await one<{ name: string }>('SELECT name FROM users WHERE id = $1', [id], db))?.name || '');
}

async function systemMessage(db: Db, jobId: string, _num: number, freelancerId: string, authorId: string, role: 'employer' | 'freelancer', text: string) {
  await query('INSERT INTO messages (job_id, freelancer_id, author_id, author_role, text) VALUES ($1, $2, $3, $4, $5)', [jobId, freelancerId, authorId, role, text], db);
}

/** Статус заказа по числу нанятых (для открытого набора). */
async function refreshStaffing(j: JobRow, db: Db) {
  if (j.status !== 'open' && j.status !== 'staffed') return;
  const n = (await one<{ n: number }>('SELECT count(*)::int AS n FROM hires WHERE job_id = $1', [j.id], db))!.n;
  const next: JobStatus = j.crew < CREW_ANY && n >= j.crew ? 'staffed' : 'open';
  if (next !== j.status) await query('UPDATE jobs SET status = $2, updated_at = now() WHERE id = $1', [j.id, next], db);
  invalidateSearch();
}

// ───────────────────────── Работодатель: отклики ─────────────────────────

export type StaffAction = 'hire' | 'reject' | 'lead' | 'no-show';

export async function staffAction(num: number, appId: string, action: StaffAction, viewer: Viewer): Promise<JobDetail> {
  if (!UUID_RE.test(appId)) throw new AppError(404, 'Отклик не найден.');
  await tx(async (db) => {
    const j = await lockJob(num, db);
    const me = needOwner(j, viewer);
    const a = await one<{ freelancer_id: string; status: AppStatus }>(
      'SELECT freelancer_id, status FROM applications WHERE id = $1 AND job_id = $2 FOR UPDATE', [appId, j.id], db);
    if (!a) throw new AppError(404, 'Отклик не найден.');
    const name = await userName(a.freelancer_id, db);
    const hired = await hiredOf(j.id, db);
    const isHired = hired.some(h => h.freelancer_id === a.freelancer_id);
    const t = 'заказ № ' + jobNum(num) + ' «' + j.title + '»';

    if (action === 'hire') {
      if (j.status === 'cancelled' || j.status === 'accepted' || j.status === 'reported') throw new AppError(409, 'Заказ уже закрыт или отменён — нанять нельзя.');
      if (isHired || a.status === 'hired') throw new AppError(409, name + ' уже нанят.');
      if (a.status === 'rejected') throw new AppError(409, 'Этот отклик вы отклонили.');
      if (a.status === 'withdrawn') throw new AppError(409, 'Исполнитель отозвал отклик.');
      if (j.crew < CREW_ANY && hired.length >= j.crew) throw new AppError(409, 'Смена уже набрана — нужно ' + j.crew + ' чел.');
      await query('INSERT INTO hires (job_id, freelancer_id) VALUES ($1, $2)', [j.id, a.freelancer_id], db);
      await query(`UPDATE applications SET status = 'hired', decided_at = now(), updated_at = now() WHERE id = $1`, [appId], db);
      // При найме открывается чат — первое сообщение от работодателя.
      await systemMessage(db, j.id, num, a.freelancer_id, me.id, 'employer', HIRE_GREETING);
      await refreshStaffing(j, db);
      await addEvents([{ userId: a.freelancer_id, kind: 'hire', text: 'Вас наняли · ' + t + '. Открыт чат с работодателем.', jobId: j.id, num, deliver: true, urgent: true }], db);
      await publish([a.freelancer_id, me.id], { t: 'message', num, thread: a.freelancer_id }, db);
    } else if (action === 'reject') {
      if (isHired || a.status === 'hired') throw new AppError(409, name + ' уже нанят — если не вышел, отметьте «Не вышел».');
      if (a.status !== 'sent') throw new AppError(409, 'На этот отклик уже есть решение.');
      await query(`UPDATE applications SET status = 'rejected', decided_at = now(), updated_at = now() WHERE id = $1`, [appId], db);
      await addEvents([{ userId: a.freelancer_id, kind: 'application', text: 'Работодатель выбрал другого исполнителя · ' + t, jobId: j.id, num }], db);
    } else if (action === 'lead') {
      if (!(j.crew > 1)) throw new AppError(409, 'Старший назначается только в бригаде — когда людей в смене больше одного.');
      if (!isHired) throw new AppError(409, 'Старшим можно сделать только нанятого.');
      await query('UPDATE hires SET is_lead = false WHERE job_id = $1 AND is_lead', [j.id], db);
      await query('UPDATE hires SET is_lead = true WHERE job_id = $1 AND freelancer_id = $2', [j.id, a.freelancer_id], db);
      await addEvents([{ userId: a.freelancer_id, kind: 'hire', text: 'Вы старший смены · ' + t + '. У вас телефон встречающего, работу за бригаду сдаёте вы.', jobId: j.id, num, deliver: true }], db);
    } else if (action === 'no-show') {
      // «Не вышел» снимает со смены только этого исполнителя, остальные остаются.
      if (!isHired) throw new AppError(409, '«Не вышел» отмечается только для нанятого исполнителя.');
      if (j.status !== 'open' && j.status !== 'staffed') throw new AppError(409, 'Работа уже сдана или смена закрыта — «Не вышел» не отмечается.');
      await query('DELETE FROM hires WHERE job_id = $1 AND freelancer_id = $2', [j.id, a.freelancer_id], db);
      await query(`UPDATE applications SET status = 'rejected', decided_at = now(), updated_at = now() WHERE id = $1`, [appId], db);
      await query('INSERT INTO no_shows (job_id, freelancer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [j.id, a.freelancer_id], db);
      await query('UPDATE users SET no_show_count = no_show_count + 1 WHERE id = $1', [a.freelancer_id], db);
      await query(`INSERT INTO user_marks (user_id, kind, reason, job_id) VALUES ($1, 'no_show', $2, $3)`, [a.freelancer_id, 'Не вышел на смену · ' + t, j.id], db);
      await refreshStaffing(j, db);
      await addEvents([{ userId: a.freelancer_id, kind: 'no_show', text: 'Работодатель отметил «Не вышел» · ' + t + '. Отметка видна в профиле.', jobId: j.id, num, deliver: true }], db);
    }
    await publish([a.freelancer_id], { t: 'job', num }, db);
  });
  return getJob(num, viewer);
}

/** «Отказать остальным» — всем, кто ещё ждёт решения. */
export async function rejectRest(num: number, viewer: Viewer): Promise<{ rejected: number; job: JobDetail }> {
  const n = await tx(async (db) => {
    const j = await lockJob(num, db);
    needOwner(j, viewer);
    const rest = await openApplicants(j.id, db);
    await query(`UPDATE applications SET status = 'rejected', decided_at = now(), updated_at = now() WHERE job_id = $1 AND status = 'sent'`, [j.id], db);
    await addEvents(rest.map(id => ({ userId: id, kind: 'application', text: 'Работодатель выбрал другого исполнителя · заказ № ' + jobNum(num) + ' «' + j.title + '»', jobId: j.id, num })), db);
    await publish(rest, { t: 'job', num }, db);
    return rest.length;
  });
  return { rejected: n, job: await getJob(num, viewer) };
}

// ───────────────────────── Исполнитель: отказ, сдача ─────────────────────────

/** Отказ от смены после найма: причина и срок предупреждения; меньше суток — пометка на 90 дней. */
export async function leaveShift(num: number, raw: unknown, viewer: Viewer): Promise<JobDetail> {
  const u = needUser(viewer);
  if (u.role !== 'freelancer') throw new AppError(403, 'Отказаться от смены может только исполнитель.');
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const reason = typeof r.reason === 'string' ? r.reason.trim().slice(0, 200) : '';
  const notice = typeof r.notice === 'string' && NOTICES.includes(r.notice) ? r.notice : '';
  if (!reason) throw new AppError(422, 'Укажите причину — её увидит работодатель.', 'reason');
  if (!notice) throw new AppError(422, 'Отметьте, за сколько вы предупреждаете.', 'notice');
  const cat = badWordIn(reason);
  if (cat) throw new ModerationError('reason', 'Причина', cat);
  await tx(async (db) => {
    const j = await lockJob(num, db);
    const hired = await hiredOf(j.id, db);
    if (!hired.some(h => h.freelancer_id === u.id)) throw new AppError(409, 'Вы не наняты на эту смену.');
    if (j.status !== 'open' && j.status !== 'staffed') throw new AppError(409, 'Работа уже сдана или смена закрыта — отказаться нельзя.');
    const late = notice === 'меньше суток';
    await query('DELETE FROM hires WHERE job_id = $1 AND freelancer_id = $2', [j.id, u.id], db);
    await query(`UPDATE applications SET status = 'withdrawn', withdrawn_at = now(), updated_at = now() WHERE job_id = $1 AND freelancer_id = $2`, [j.id, u.id], db);
    await query('INSERT INTO withdrawals (job_id, freelancer_id, reason, notice, late) VALUES ($1, $2, $3, $4, $5)', [j.id, u.id, reason, notice, late], db);
    if (late) {
      await query(`INSERT INTO user_marks (user_id, kind, reason, job_id, until) VALUES ($1, 'late_withdrawal', $2, $3, now() + make_interval(days => $4))`,
        [u.id, 'Поздний отказ от смены: ' + reason, j.id, LATE_MARK_DAYS], db);
    }
    await refreshStaffing(j, db);
    const name = await userName(u.id, db);
    await addEvents([{ userId: j.employer_id, kind: 'withdrawal', text: name + ' отказался от смены · заказ № ' + jobNum(num) + ' — ' + reason + ', ' + notice + '. Набор открыт снова.', jobId: j.id, num, deliver: true, urgent: late }], db);
    await publish([j.employer_id], { t: 'job', num }, db);
  });
  return getJob(num, viewer);
}

/** «Сдать работу»: только нанятый; в бригаде — старший. С этого момента у работодателя 7 дней на приёмку. */
export async function reportDone(num: number, viewer: Viewer): Promise<JobDetail> {
  const u = needUser(viewer);
  await tx(async (db) => {
    const j = await lockJob(num, db);
    const hired = await hiredOf(j.id, db);
    const me = hired.find(h => h.freelancer_id === u.id);
    if (!me) throw new AppError(403, 'Сдать работу может только нанятый исполнитель.');
    if (j.status === 'cancelled') throw new AppError(409, 'Смена отменена — сдавать нечего.');
    if (j.status === 'reported') throw new AppError(409, 'Работа уже сдана — ждём приёмки.');
    if (j.status === 'accepted') throw new AppError(409, 'Работа уже принята.');
    // До дня выхода сдавать нечего: иначе 7-дневный срок автоприёмки начался бы до самой работы.
    if (!j.repeat && j.date > localClock().day) throw new AppError(409, 'Сдать работу можно в день выхода или позже — ' + dateLabel(j.date) + '.');
    if (hired.length > 1 && !me.is_lead) {
      const lead = hired.find(h => h.is_lead);
      throw new AppError(409, lead ? 'Работу за бригаду сдаёт старший.' : 'В бригаде работу сдаёт старший — попросите работодателя назначить старшего.');
    }
    await query('INSERT INTO reports (job_id, reported_by) VALUES ($1, $2)', [j.id, u.id], db);
    await query(`UPDATE jobs SET status = 'reported', updated_at = now() WHERE id = $1`, [j.id], db);
    invalidateSearch();
    await systemMessage(db, j.id, num, u.id, u.id, 'freelancer', REPORT_MESSAGE);
    await addEvents([{ userId: j.employer_id, kind: 'report', text: 'Работа сдана · заказ № ' + jobNum(num) + ' «' + j.title + '». Примите её в течение ' + AUTO_ACCEPT_DAYS + ' дней — иначе смена закроется автоматически.', jobId: j.id, num, deliver: true }], db);
    await publish([j.employer_id, ...hired.map(h => h.freelancer_id)], { t: 'job', num }, db);
    await publish([j.employer_id, u.id], { t: 'message', num, thread: u.id }, db);
  });
  return getJob(num, viewer);
}

// ───────────────────────── Работодатель: приёмка, перенос ─────────────────────────

async function acceptLocked(j: JobRow, auto: boolean, db: Db) {
  const hired = await hiredOf(j.id, db);
  if (j.status === 'cancelled') throw new AppError(409, 'Смена отменена — принимать нечего.');
  if (j.status === 'accepted') throw new AppError(409, 'Работа уже принята.');
  if (!hired.length) throw new AppError(409, 'На смену никто не нанят — принимать нечего.');
  await query('INSERT INTO acceptances (job_id, auto) VALUES ($1, $2)', [j.id, auto], db);
  await query(`UPDATE jobs SET status = 'accepted', updated_at = now() WHERE id = $1`, [j.id], db);
  invalidateSearch();
  await query('INSERT INTO settlements (job_id) VALUES ($1) ON CONFLICT DO NOTHING', [j.id], db);
  const rest = await openApplicants(j.id, db);
  await query(`UPDATE applications SET status = 'rejected', decided_at = now(), updated_at = now() WHERE job_id = $1 AND status = 'sent'`, [j.id], db);
  const t = 'заказ № ' + jobNum(j.num) + ' «' + j.title + '»';
  await addEvents([
    ...hired.map(h => ({
      userId: h.freelancer_id, kind: 'accept', jobId: j.id, num: j.num, deliver: true,
      text: auto ? 'Смена закрыта автоматически: работодатель не ответил ' + AUTO_ACCEPT_DAYS + ' дней — засчитана вам · ' + t : 'Работа принята · ' + t + '. Оцените работодателя.'
    })),
    ...(auto ? [{ userId: j.employer_id, kind: 'accept', jobId: j.id, num: j.num, deliver: true, text: 'Смена закрыта автоматически: работа сдана ' + AUTO_ACCEPT_DAYS + ' дней назад · ' + t }] : [])
  ], db);
  await publish([j.employer_id, ...hired.map(h => h.freelancer_id), ...rest], { t: 'job', num: j.num }, db);
}

/** «Принять работу»: только если кто-то нанят и смена не отменена. */
export async function acceptWork(num: number, viewer: Viewer): Promise<JobDetail> {
  await tx(async (db) => {
    const j = await lockJob(num, db);
    needOwner(j, viewer);
    await acceptLocked(j, false, db);
  });
  return getJob(num, viewer);
}

/** Автоприёмка: работа сдана 7+ дней назад и не принята — засчитывается исполнителю. */
export async function autoAcceptDue(db: Db = pool()): Promise<number[]> {
  const due = await query<{ num: string }>(
    `SELECT j.num FROM reports r JOIN jobs j ON j.id = r.job_id
      WHERE j.status = 'reported' AND r.reported_at <= now() - make_interval(days => $1)
      ORDER BY r.reported_at LIMIT 200`,
    [AUTO_ACCEPT_DAYS], db);
  const done: number[] = [];
  for (const row of due.rows) {
    const num = Number(row.num);
    try {
      await tx(async (t) => {
        const j = await lockJob(num, t);
        if (j.status !== 'reported') return;
        await acceptLocked(j, true, t);
        done.push(num);
      });
    } catch (e) {
      console.error('[auto-accept]', num, (e as Error).message);
    }
  }
  return done;
}

/** Перенос даты: нельзя закрытую/отменённую; нанятые и откликнувшиеся уведомляются. */
export async function moveDate(num: number, raw: unknown, viewer: Viewer, todayRaw: unknown): Promise<JobDetail> {
  const today = clientToday(todayRaw);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : '';
  const ahead = date ? daysAhead(date, today) : null;
  if (ahead == null) throw new AppError(422, 'Укажите новую дату.', 'date');
  if (ahead < 0) throw new AppError(422, 'Новая дата уже прошла — выберите сегодня или позже.', 'date');
  if (ahead > 366) throw new AppError(422, 'Дата выхода — не дальше чем через год.', 'date');
  await tx(async (db) => {
    const j = await lockJob(num, db);
    needOwner(j, viewer);
    if (j.status === 'cancelled' || j.status === 'accepted') throw new AppError(409, 'Смена закрыта или отменена — переносить нельзя.');
    if (j.date === date) throw new AppError(422, 'Это та же дата.', 'date');
    await query('UPDATE jobs SET date = $2, urgent = $3, updated_at = now() WHERE id = $1', [j.id, date, ahead <= 1], db);
    invalidateSearch();
    const people = [...(await hiredOf(j.id, db)).map(h => h.freelancer_id), ...(await openApplicants(j.id, db))];
    const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const label = parseInt(date.slice(8), 10) + ' ' + MONTHS[parseInt(date.slice(5, 7), 10) - 1];
    await addEvents(people.map(id => ({ userId: id, kind: 'move', text: 'Дата выхода перенесена на ' + label + ' · заказ № ' + jobNum(num) + ' «' + j.title + '»', jobId: j.id, num, deliver: true, urgent: ahead <= 1 })), db);
    await publish(people, { t: 'job', num }, db);
  });
  return getJob(num, viewer);
}

// ───────────────────────── После приёмки: расчёт, отзыв, жалоба ─────────────────────────

/** Расчёт — информационно: «оплата передана» / «деньги получены». */
export async function markSettled(num: number, viewer: Viewer): Promise<JobDetail> {
  const u = needUser(viewer);
  await tx(async (db) => {
    const j = await lockJob(num, db);
    if (j.status !== 'accepted') throw new AppError(409, 'Сначала работодатель принимает работу.');
    const hired = await hiredOf(j.id, db);
    const isOwner = u.id === j.employer_id;
    if (!isOwner && !hired.some(h => h.freelancer_id === u.id)) throw new AppError(403, 'Отметку ставят только стороны смены.');
    const s = await one<{ employer_marked: boolean; freelancer_marked: boolean }>(
      isOwner
        ? `INSERT INTO settlements (job_id, employer_marked, employer_at) VALUES ($1, true, now())
           ON CONFLICT (job_id) DO UPDATE SET employer_marked = true, employer_at = coalesce(settlements.employer_at, now())
           RETURNING employer_marked, freelancer_marked`
        : `INSERT INTO settlements (job_id, freelancer_marked, freelancer_at) VALUES ($1, true, now())
           ON CONFLICT (job_id) DO UPDATE SET freelancer_marked = true, freelancer_at = coalesce(settlements.freelancer_at, now())
           RETURNING employer_marked, freelancer_marked`,
      [j.id], db);
    const t = 'заказ № ' + jobNum(num) + ' «' + j.title + '»';
    const others = isOwner ? hired.map(h => h.freelancer_id) : [j.employer_id];
    const both = s!.employer_marked && s!.freelancer_marked;
    await addEvents(others.map(id => ({
      userId: id, kind: 'settle', jobId: j.id, num,
      text: both ? 'Расчёт подтверждён обеими сторонами · ' + t : (isOwner ? 'Работодатель отметил: оплата передана · ' : 'Исполнитель отметил: деньги получены · ') + t
    })), db);
    await publish([j.employer_id, ...hired.map(h => h.freelancer_id)], { t: 'job', num }, db);
  });
  return getJob(num, viewer);
}

/** Кому адресован отзыв/жалоба: работодатель выбирает нанятого (id отклика), исполнитель — работодателя. */
async function resolveTarget(j: JobRow, u: U, target: unknown, db: Db): Promise<string> {
  const hired = await hiredOf(j.id, db);
  if (u.id === j.employer_id) {
    if (typeof target !== 'string' || !UUID_RE.test(target)) throw new AppError(422, 'Выберите исполнителя.', 'target');
    const a = await one<{ freelancer_id: string }>('SELECT freelancer_id FROM applications WHERE id = $1 AND job_id = $2', [target, j.id], db);
    if (!a || !hired.some(h => h.freelancer_id === a.freelancer_id)) throw new AppError(422, 'Оценить можно только того, кто работал на смене.', 'target');
    return a.freelancer_id;
  }
  if (!hired.some(h => h.freelancer_id === u.id)) throw new AppError(403, 'Оценку ставят только стороны смены.');
  return j.employer_id;
}

/** Отзыв: после приёмки, обе стороны, 1–5 + текст; изменить или удалить можно 10 минут. */
export async function saveReview(num: number, raw: unknown, viewer: Viewer): Promise<JobDetail> {
  const u = needUser(viewer);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rating = Number(r.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new AppError(422, 'Поставьте оценку от 1 до 5.', 'rating');
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, 1000) : '';
  const cat = badWordIn(text);
  if (cat) throw new ModerationError('text', 'Отзыв', cat);
  await tx(async (db) => {
    const j = await lockJob(num, db);
    if (j.status !== 'accepted') throw new AppError(409, 'Отзыв оставляют после приёмки работы.');
    const target = await resolveTarget(j, u, r.target, db);
    const prev = await one<{ id: string; editable_until: Date }>(
      'SELECT id, editable_until FROM reviews WHERE job_id = $1 AND author_id = $2 AND target_id = $3 FOR UPDATE', [j.id, u.id, target], db);
    if (prev) {
      if (prev.editable_until.getTime() <= Date.now()) throw new AppError(409, 'Отзыв уже нельзя изменить — прошло ' + REVIEW_EDIT_MIN + ' минут.');
      await query('UPDATE reviews SET rating = $2, text = $3, updated_at = now() WHERE id = $1', [prev.id, rating, text], db);
    } else {
      await query(
        `INSERT INTO reviews (job_id, author_id, target_id, rating, text, editable_until)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))`,
        [j.id, u.id, target, rating, text, REVIEW_EDIT_MIN], db);
      await addEvents([{ userId: target, kind: 'review', text: 'Новый отзыв: ' + rating + '/5 · заказ № ' + jobNum(num) + ' «' + j.title + '»', jobId: j.id, num }], db);
    }
  });
  return getJob(num, viewer);
}

export async function deleteReview(num: number, raw: unknown, viewer: Viewer): Promise<JobDetail> {
  const u = needUser(viewer);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  await tx(async (db) => {
    const j = await lockJob(num, db);
    const target = await resolveTarget(j, u, r.target, db);
    const prev = await one<{ id: string; editable_until: Date }>(
      'SELECT id, editable_until FROM reviews WHERE job_id = $1 AND author_id = $2 AND target_id = $3 FOR UPDATE', [j.id, u.id, target], db);
    if (!prev) throw new AppError(404, 'Отзыва нет.');
    if (prev.editable_until.getTime() <= Date.now()) throw new AppError(409, 'Отзыв уже нельзя удалить — прошло ' + REVIEW_EDIT_MIN + ' минут.');
    await query('DELETE FROM reviews WHERE id = $1', [prev.id], db);
  });
  return getJob(num, viewer);
}

/** Жалоба: после приёмки. Площадка разбирает поведение (пометка, понижение, блокировка), деньги не возвращает. */
export async function fileComplaint(num: number, raw: unknown, viewer: Viewer): Promise<JobDetail> {
  const u = needUser(viewer);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kinds = COMPLAINT_KINDS[u.role];
  const reason = typeof r.reason === 'string' && kinds.includes(r.reason) ? r.reason : '';
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, 2000) : '';
  if (!reason) throw new AppError(422, 'Выберите тему жалобы.', 'reason');
  if (!text) throw new AppError(422, 'Опишите, что произошло.', 'text');
  const hit = findBadField([{ field: 'text', label: 'Жалоба', value: text }]);
  if (hit) throw new ModerationError(hit.field, hit.label, hit.category);
  await limitOrThrow(`complaint:${u.id}`, 10, 86400, 'Слишком много жалоб за сутки — напишите в поддержку.');
  await tx(async (db) => {
    const j = await lockJob(num, db);
    if (j.status !== 'accepted') throw new AppError(409, 'Жалобу подают после приёмки работы.');
    const target = u.id === j.employer_id && r.target ? await resolveTarget(j, u, r.target, db) : u.id === j.employer_id ? null : await resolveTarget(j, u, null, db);
    try {
      await query('INSERT INTO complaints (job_id, author_id, target_id, reason, text) VALUES ($1, $2, $3, $4, $5)', [j.id, u.id, target, reason, text], db);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'Жалоба по этой смене уже подана — ответ придёт в течение 3 рабочих дней.');
      throw e;
    }
    // Жалобы уходят в поддержку по почте (через очередь доставки).
    const author = await one<{ login: string; phone: string; role: string }>('SELECT login, phone, role FROM users WHERE id = $1', [u.id], db);
    await mailSupport('Жалоба · заказ № ' + jobNum(num) + ' · ' + reason,
      'Заказ № ' + jobNum(num) + ' «' + j.title + '»\nАвтор: ' + author?.login + ' (' + author?.role + ', ' + author?.phone + ')\n' +
      (target ? 'На кого: ' + (await one<{ login: string }>('SELECT login FROM users WHERE id = $1', [target], db))?.login + '\n' : '') +
      'Тема: ' + reason + '\n\n' + text, db);
    await addEvents([{ userId: u.id, kind: 'complaint', text: 'Жалоба зарегистрирована · заказ № ' + jobNum(num) + ' — ответ за 3 рабочих дня', jobId: j.id, num, silent: true }], db);
  });
  return getJob(num, viewer);
}

// ───────────────────────── Чат ─────────────────────────

type Thread = { jobId: string; num: number; employerId: string; freelancerId: string; canSend: boolean; status: JobStatus; title: string };

/** Диалог внутри заказа: работодатель ↔ конкретный исполнитель. Открывается при найме. */
async function threadFor(num: number, freelancerId: string, u: U, db: Db): Promise<Thread> {
  if (!UUID_RE.test(freelancerId)) throw new AppError(404, 'Диалог не найден.');
  const j = await one<{ id: string; employer_id: string; status: JobStatus; title: string; hired: boolean; msgs: number }>(
    `SELECT j.id, j.employer_id, j.status, j.title,
            EXISTS (SELECT 1 FROM hires h WHERE h.job_id = j.id AND h.freelancer_id = $2) AS hired,
            (SELECT count(*) FROM messages m WHERE m.job_id = j.id AND m.freelancer_id = $2)::int AS msgs
       FROM jobs j WHERE j.num = $1`,
    [num, freelancerId], db);
  if (!j) throw new AppError(404, 'Заказ не найден.');
  const party = u.id === j.employer_id || u.id === freelancerId;
  if (!party || (!j.hired && !j.msgs)) throw new AppError(403, 'Чат открывается после найма.');
  return { jobId: j.id, num, employerId: j.employer_id, freelancerId, status: j.status, title: j.title, canSend: j.hired && j.status !== 'cancelled' };
}

export async function listMessages(num: number, freelancerId: string, viewer: Viewer) {
  const u = needUser(viewer);
  const th = await threadFor(num, freelancerId, u, pool());
  const myRole = u.id === th.employerId ? 'employer' : 'freelancer';
  // Прочитали — отмечаем входящие и сообщаем второй стороне.
  const marked = await query(
    `UPDATE messages SET read_at = now() WHERE job_id = $1 AND freelancer_id = $2 AND author_role <> $3 AND read_at IS NULL RETURNING id`,
    [th.jobId, th.freelancerId, myRole]);
  if (marked.rowCount) await publish([myRole === 'employer' ? th.freelancerId : th.employerId], { t: 'read', num, thread: th.freelancerId });
  const rows = await query<{ id: string; author_id: string; text: string; created_at: Date; read_at: Date | null }>(
    `SELECT id, author_id, text, created_at, read_at FROM messages WHERE job_id = $1 AND freelancer_id = $2 ORDER BY created_at, id LIMIT 500`,
    [th.jobId, th.freelancerId]);
  const other = await one<{ name: string }>('SELECT name FROM users WHERE id = $1', [myRole === 'employer' ? th.freelancerId : th.employerId]);
  const messages: ChatMessage[] = rows.rows.map(m => ({ id: m.id, mine: m.author_id === u.id, text: m.text, at: m.created_at.toISOString(), read: !!m.read_at }));
  return { messages, canSend: th.canSend, who: shortName(other?.name || ''), initials: initialsOf(other?.name || ''), title: th.title };
}

export async function sendMessage(num: number, freelancerId: string, raw: unknown, viewer: Viewer): Promise<ChatMessage> {
  const u = needUser(viewer);
  const text = typeof raw === 'object' && raw && typeof (raw as Record<string, unknown>).text === 'string' ? ((raw as Record<string, unknown>).text as string).trim().slice(0, 2000) : '';
  if (!text) throw new AppError(422, 'Напишите сообщение.', 'text');
  const cat = badWordIn(text);
  if (cat) throw new ModerationError('text', 'Сообщение', cat);
  await limitOrThrow(`msg:${u.id}`, 30, 60, 'Слишком часто — подождите минуту.');
  return tx(async (db) => {
    const th = await threadFor(num, freelancerId, u, db);
    if (!th.canSend) throw new AppError(409, th.status === 'cancelled' ? 'Смена отменена — чат только для чтения.' : 'Исполнитель снят со смены — чат только для чтения.');
    const role = u.id === th.employerId ? 'employer' : 'freelancer';
    const m = await one<{ id: string; created_at: Date }>(
      'INSERT INTO messages (job_id, freelancer_id, author_id, author_role, text) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
      [th.jobId, th.freelancerId, u.id, role, text], db);
    await publish([th.employerId, th.freelancerId], { t: 'message', num, thread: th.freelancerId }, db);
    return { id: m!.id, mine: true, text, at: m!.created_at.toISOString(), read: false };
  });
}

/** Список диалогов пользователя: последние сверху, с числом непрочитанных. */
export async function listChats(viewer: Viewer): Promise<ChatThread[]> {
  const u = needUser(viewer);
  const r = await query<{ num: string; thread: string; title: string; who: string; last: string | null; last_author: string | null; last_at: Date | null; unread: number; status: JobStatus }>(
    // Четыре ветки вместо «employer = $1 OR freelancer = $1» по соединению: так каждая идёт по своему индексу,
    // а не перебирает все наймы и сообщения площадки.
    `WITH pairs AS (
       SELECT h.job_id, h.freelancer_id FROM hires h JOIN jobs j ON j.id = h.job_id WHERE j.employer_id = $1
       UNION
       SELECT h.job_id, h.freelancer_id FROM hires h WHERE h.freelancer_id = $1
       UNION
       SELECT DISTINCT m.job_id, m.freelancer_id FROM messages m JOIN jobs j ON j.id = m.job_id WHERE j.employer_id = $1
       UNION
       SELECT DISTINCT m.job_id, m.freelancer_id FROM messages m WHERE m.freelancer_id = $1
     ), threads AS (
       SELECT j.id AS job_id, j.num, j.title, j.status, j.employer_id, p.freelancer_id FROM pairs p JOIN jobs j ON j.id = p.job_id
     )
     SELECT t.num, t.freelancer_id AS thread, t.title, t.status,
            (SELECT name FROM users WHERE id = CASE WHEN t.employer_id = $1 THEN t.freelancer_id ELSE t.employer_id END) AS who,
            lm.text AS last, lm.author_id AS last_author, lm.created_at AS last_at,
            (SELECT count(*) FROM messages m WHERE m.job_id = t.job_id AND m.freelancer_id = t.freelancer_id AND m.read_at IS NULL
                AND m.author_role = CASE WHEN t.employer_id = $1 THEN 'freelancer' ELSE 'employer' END)::int AS unread
       FROM threads t
       LEFT JOIN LATERAL (SELECT text, author_id, created_at FROM messages m
                           WHERE m.job_id = t.job_id AND m.freelancer_id = t.freelancer_id ORDER BY created_at DESC, id DESC LIMIT 1) lm ON true
      ORDER BY lm.created_at DESC NULLS LAST
      LIMIT 200`,
    [u.id]);
  return r.rows.map(x => ({
    num: Number(x.num), thread: x.thread, title: x.title, who: shortName(x.who || ''), last: x.last || 'нет сообщений',
    lastMine: x.last_author === u.id, lastAt: x.last_at ? x.last_at.toISOString() : null, unread: x.unread, jobStatus: x.status
  }));
}

// ───────────────────────── «Мои смены / Мои заказы», «Отклики» ─────────────────────────

export async function myJobs(viewer: Viewer): Promise<MyJob[]> {
  const u = needUser(viewer);
  const emp = u.role === 'employer';
  const r = await query<Record<string, unknown>>(
    `SELECT j.num, j.title, j.type_id, t.label AS type_label, j.address, j.district, j.lat, j.lng, j.pay, j.unit, j.pay_type,
            to_char(j.date, 'YYYY-MM-DD') AS date, j.volume, j.crew, j.urgent, j.repeat, j.status, j.created_at, j.employer_id,
            (SELECT count(*) FROM hires h WHERE h.job_id = j.id)::int AS hired,
            (SELECT count(*) FROM applications a WHERE a.job_id = j.id AND a.status IN ('sent', 'hired'))::int AS applicants,
            ${emp ? 'NULL' : 'a.status'} AS my_status,
            rp.reported_at, ac.accepted_at, ac.auto, c.reason AS cancel_reason, c.at AS cancel_at,
            ${emp ? 'NULL' : "(SELECT reason FROM withdrawals w WHERE w.job_id = j.id AND w.freelancer_id = $1 ORDER BY at DESC LIMIT 1)"} AS w_reason,
            ${emp ? 'NULL' : "(SELECT at FROM withdrawals w WHERE w.job_id = j.id AND w.freelancer_id = $1 ORDER BY at DESC LIMIT 1)"} AS w_at,
            ${emp ? 'false' : 'EXISTS (SELECT 1 FROM no_shows n WHERE n.job_id = j.id AND n.freelancer_id = $1)'} AS no_show,
            ${emp
              ? "(SELECT string_agg(split_part(u2.name, ' ', 1), ', ') FROM hires h JOIN users u2 ON u2.id = h.freelancer_id WHERE h.job_id = j.id)"
              : "(SELECT coalesce(CASE WHEN p.org_type <> 'частное лицо' THEN p.org_name END, u2.name) FROM users u2 LEFT JOIN employer_profiles p ON p.user_id = u2.id WHERE u2.id = j.employer_id)"} AS counterpart,
            ${emp ? 'EXISTS (SELECT 1 FROM hires h WHERE h.job_id = j.id)' : 'EXISTS (SELECT 1 FROM hires h WHERE h.job_id = j.id AND h.freelancer_id = $1) OR EXISTS (SELECT 1 FROM messages m WHERE m.job_id = j.id AND m.freelancer_id = $1)'} AS has_chat,
            (SELECT count(*) FROM reviews v WHERE v.job_id = j.id AND v.author_id = $1)::int AS reviewed,
            ${emp ? '(SELECT count(*) FROM hires h WHERE h.job_id = j.id)::int' : '(CASE WHEN EXISTS (SELECT 1 FROM hires h WHERE h.job_id = j.id AND h.freelancer_id = $1) THEN 1 ELSE 0 END)'} AS reviewable
       FROM jobs j JOIN job_types t ON t.id = j.type_id
       ${emp ? '' : 'JOIN applications a ON a.job_id = j.id AND a.freelancer_id = $1'}
       LEFT JOIN reports rp ON rp.job_id = j.id
       LEFT JOIN acceptances ac ON ac.job_id = j.id
       LEFT JOIN cancellations c ON c.job_id = j.id
      WHERE ${emp ? 'j.employer_id = $1' : 'true'}
      -- Сверху то, что требует действия: сдано → набрано → открыто; закрытые — ниже, свежие первыми.
      ORDER BY CASE j.status WHEN 'reported' THEN 0 WHEN 'staffed' THEN 1 WHEN 'open' THEN 2 WHEN 'accepted' THEN 3 ELSE 4 END,
               CASE WHEN j.status IN ('accepted', 'cancelled') THEN NULL ELSE j.date END,
               j.date DESC, j.created_at DESC
      LIMIT 300`,
    [u.id]);
  return r.rows.map((x) => {
    const reported = x.reported_at as Date | null, accepted = x.accepted_at as Date | null;
    return {
      num: Number(x.num), title: x.title as string, typeId: x.type_id as string, typeLabel: x.type_label as string,
      address: x.address as string, district: x.district as string | null, lat: x.lat as number, lng: x.lng as number,
      pay: x.pay as number, unit: x.unit as string, payType: x.pay_type as string | null, date: x.date as string,
      volume: x.volume as string | null, crew: x.crew as number, urgent: x.urgent as boolean, repeat: x.repeat as string | null,
      status: x.status as JobStatus, hired: x.hired as number, applicants: x.applicants as number,
      mine: emp, myStatus: (x.my_status as AppStatus | null) ?? null, distanceKm: null, createdAt: (x.created_at as Date).toISOString(),
      reportedAt: reported ? reported.toISOString() : null,
      acceptedAt: accepted ? accepted.toISOString() : null,
      autoAccepted: !!x.auto,
      autoAcceptAt: reported && !accepted ? new Date(reported.getTime() + AUTO_ACCEPT_DAYS * 86400_000).toISOString() : null,
      cancellation: x.cancel_reason ? { reason: x.cancel_reason as string, at: (x.cancel_at as Date).toISOString() } : null,
      withdrawal: x.w_reason ? { reason: x.w_reason as string, at: (x.w_at as Date).toISOString() } : null,
      noShow: !!x.no_show,
      counterpart: emp ? (x.counterpart as string | null) || '' : shortName((x.counterpart as string | null) || ''),
      hasChat: !!x.has_chat,
      chatThread: emp ? null : u.id,
      reviewed: x.reviewed as number,
      reviewable: accepted ? (x.reviewable as number) : 0
    };
  });
}

export type ApplicantCard = {
  id: string; name: string; initials: string; status: AppStatus; isLead: boolean; appliedAt: string;
  rating: number | null; reviews: number; done: number; noShows: number; gear: string[]; ownCar: boolean; cities: string[]; skills: string[];
  reqConfirmed: boolean; lateMark: boolean;
  /** ФНС подтвердила статус самозанятого (перепроверка раз в сутки). */
  npd: boolean;
};

/** Вкладка «Отклики»: открытые заказы работодателя и люди по ним. */
export async function applicantsBoard(viewer: Viewer) {
  const u = needUser(viewer);
  if (u.role !== 'employer') throw new AppError(403, 'Отклики — раздел работодателя.');
  const jobs = await myJobs(viewer);
  const live = jobs.filter(j => j.status === 'open' || j.status === 'staffed' || j.status === 'reported');
  if (!live.length) return { jobs: [] as (MyJob & { people: ApplicantCard[] })[] };
  const rows = await query<{
    num: string; id: string; name: string; status: AppStatus; created_at: Date; is_lead: boolean | null; rating: number | null; reviews: number;
    done: number; no_show_count: number; gear: string[] | null; own_car: boolean | null; work_cities: string[] | null; skills: string[] | null;
    custom_skills: string[] | null; req_confirmed: boolean; late: boolean; npd: boolean | null;
  }>(
    `SELECT j.num, a.id, u.name, a.status, a.created_at, h.is_lead, a.req_confirmed,
            (SELECT avg(rating)::float8 FROM reviews WHERE target_id = u.id) AS rating,
            (SELECT count(*) FROM reviews WHERE target_id = u.id)::int AS reviews,
            (SELECT count(*) FROM hires h2 JOIN acceptances ac ON ac.job_id = h2.job_id WHERE h2.freelancer_id = u.id)::int AS done,
            u.no_show_count, fp.gear, fp.own_car, fp.work_cities, fp.skills, fp.custom_skills, (fp.npd_status = 'ok' AND fp.npd_checked_at > now() - interval '3 days') AS npd,
            EXISTS (SELECT 1 FROM user_marks m WHERE m.user_id = u.id AND m.kind = 'late_withdrawal' AND m.until > now()) AS late
       FROM applications a JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = a.freelancer_id
       LEFT JOIN freelancer_profiles fp ON fp.user_id = u.id
       LEFT JOIN hires h ON h.job_id = a.job_id AND h.freelancer_id = a.freelancer_id
      WHERE j.employer_id = $1 AND j.num = ANY($2::bigint[]) AND a.status IN ('sent', 'hired')
      ORDER BY a.status = 'hired' DESC, a.created_at`,
    [u.id, live.map(j => j.num)]);
  const labels = new Map((await query<{ id: string; label: string }>('SELECT id, label FROM job_types')).rows.map(t => [t.id, t.label]));
  const byNum = new Map<number, ApplicantCard[]>();
  for (const a of rows.rows) {
    const list = byNum.get(Number(a.num)) ?? [];
    list.push({
      id: a.id, name: shortName(a.name), initials: initialsOf(a.name), status: a.status, isLead: !!a.is_lead, appliedAt: a.created_at.toISOString(),
      rating: a.rating == null ? null : Math.round(a.rating * 10) / 10, reviews: a.reviews, done: a.done, noShows: a.no_show_count,
      gear: (a.gear || []).filter(g => g !== 'Ничего нет'), ownCar: !!a.own_car, cities: a.work_cities || [],
      skills: [...(a.skills || []).map(s => labels.get(s) || s), ...(a.custom_skills || [])],
      reqConfirmed: a.req_confirmed, lateMark: a.late, npd: !!a.npd
    });
    byNum.set(Number(a.num), list);
  }
  // Сначала заказы, где кто-то ждёт решения, затем с нанятыми, пустые — в конце.
  const rank = (people: ApplicantCard[]) => (people.some(p => p.status === 'sent') ? 0 : people.length ? 1 : 2);
  return {
    jobs: live.map(j => ({ ...j, people: byNum.get(j.num) ?? [] }))
      .sort((a, b) => rank(a.people) - rank(b.people))
  };
}

export { LEAVE_REASONS };

/** Чек-лист «Перед выходом»: отмечает нанятый исполнитель, пока работа не принята. */
export async function setSafety(num: number, raw: unknown, viewer: Viewer) {
  const u = needUser(viewer);
  const items = (Array.isArray(raw) ? raw : []).filter((x): x is string => SAFETY_ITEMS.some(i => i.id === x));
  const j = await one<{ id: string; employer_id: string; status: string }>('SELECT id, employer_id, status FROM jobs WHERE num = $1', [num]);
  if (!j) throw new AppError(404, 'Заказ не найден.');
  const hired = await one('SELECT 1 FROM hires WHERE job_id = $1 AND freelancer_id = $2', [j.id, u.id]);
  if (!hired) throw new AppError(403, 'Чек-лист отмечает нанятый исполнитель.');
  if (j.status === 'accepted' || j.status === 'cancelled') throw new AppError(409, 'Смена закрыта.');
  await query(
    `INSERT INTO safety_checks (job_id, freelancer_id, items) VALUES ($1, $2, $3)
     ON CONFLICT (job_id, freelancer_id) DO UPDATE SET items = $3, updated_at = now()`, [j.id, u.id, [...new Set(items)]]);
  await publish([j.employer_id], { t: 'job', num });
  return getJob(num, viewer);
}

/**
 * Экран «Смена» (мобильный): самая актуальная смена пользователя.
 * Исполнитель: нанят и работа не принята → принята, но расчёт не отмечен → ждёт ответа на отклик.
 * Работодатель: сдана и ждёт приёмки → идёт (есть нанятые) → принята, но расчёт не отмечен.
 */
export async function currentShift(viewer: Viewer): Promise<JobDetail | null> {
  const u = needUser(viewer);
  const r = u.role === 'freelancer'
    ? await one<{ num: string }>(
      `SELECT j.num FROM jobs j
         LEFT JOIN hires h ON h.job_id = j.id AND h.freelancer_id = $1
         LEFT JOIN applications a ON a.job_id = j.id AND a.freelancer_id = $1
         LEFT JOIN settlements s ON s.job_id = j.id
        WHERE j.status <> 'cancelled' AND (
              (h.job_id IS NOT NULL AND j.status <> 'accepted')
           OR (h.job_id IS NOT NULL AND j.status = 'accepted' AND NOT coalesce(s.freelancer_marked, false) AND j.date > current_date - 14)
           OR (h.job_id IS NULL AND a.status = 'sent' AND a.withdrawn_at IS NULL AND j.date >= current_date))
        ORDER BY CASE WHEN h.job_id IS NOT NULL AND j.status <> 'accepted' THEN 0 WHEN h.job_id IS NOT NULL THEN 1 ELSE 2 END, j.date, j.num
        LIMIT 1`, [u.id])
    : await one<{ num: string }>(
      `SELECT j.num FROM jobs j LEFT JOIN settlements s ON s.job_id = j.id
        WHERE j.employer_id = $1 AND j.status <> 'cancelled' AND EXISTS (SELECT 1 FROM hires h WHERE h.job_id = j.id)
          AND (j.status <> 'accepted' OR (NOT coalesce(s.employer_marked, false) AND j.date > current_date - 14))
        ORDER BY CASE j.status WHEN 'reported' THEN 0 WHEN 'accepted' THEN 2 ELSE 1 END, j.date, j.num
        LIMIT 1`, [u.id]);
  return r ? getJob(Number(r.num), viewer) : null;
}

// ───────────────────────── Серия выходов ─────────────────────────

/** «Не смогу» / «Вернуть» для одного дня серии: только нанятый, только будущий день. Три снятых дня подряд — пометка. */
export async function toggleSeriesDay(num: number, raw: unknown, viewer: Viewer): Promise<JobDetail> {
  const u = needUser(viewer);
  const day = raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).day === 'string' ? (raw as Record<string, string>).day : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError(422, 'Укажите день серии.', 'day');
  await tx(async (db) => {
    const j = await lockJob(num, db);
    const row = await one<{ series_len: number }>('SELECT series_len FROM jobs WHERE id = $1', [j.id], db);
    if (!j.repeat) throw new AppError(409, 'Это разовый заказ — серии нет.');
    const dates = seriesDates(j.repeat, j.date, row!.series_len);
    if (!dates) throw new AppError(409, 'Выходы по снегопаду — по вызову, заранее снимать нечего.');
    if (!dates.includes(day)) throw new AppError(422, 'Такого дня в серии нет.', 'day');
    if (!(await one('SELECT 1 FROM hires WHERE job_id = $1 AND freelancer_id = $2', [j.id, u.id], db))) throw new AppError(403, 'Снять день может только нанятый исполнитель.');
    if (j.status === 'cancelled' || j.status === 'accepted') throw new AppError(409, 'Серия закрыта.');
    if (day < localClock().day) throw new AppError(409, 'Этот день уже прошёл.');
    const removed = await query('DELETE FROM series_skips WHERE job_id = $1 AND freelancer_id = $2 AND day = $3', [j.id, u.id, day], db);
    const skipping = !removed.rowCount;
    if (skipping) await query('INSERT INTO series_skips (job_id, freelancer_id, day) VALUES ($1, $2, $3)', [j.id, u.id, day], db);
    const name = await userName(u.id, db);
    const ahead = daysAhead(day, localClock().day) ?? 99;
    await addEvents([{
      userId: j.employer_id, kind: 'withdrawal', jobId: j.id, num, deliver: skipping, urgent: skipping && ahead <= 1,
      text: skipping
        ? name + ' не сможет выйти ' + seriesDayLabel(day) + ' · серия заказа № ' + jobNum(num) + '. Остальные дни — за ним.'
        : name + ' снова выходит ' + seriesDayLabel(day) + ' · серия заказа № ' + jobNum(num)
    }], db);
    if (skipping) {
      // Больше двух снятых дней подряд — пометка в профиле (один раз на серию).
      const mine = new Set((await query<{ day: string }>(`SELECT to_char(day, 'YYYY-MM-DD') AS day FROM series_skips WHERE job_id = $1 AND freelancer_id = $2`, [j.id, u.id], db)).rows.map(x => x.day));
      let run = 0, worst = 0;
      for (const d of dates) { run = mine.has(d) ? run + 1 : 0; worst = Math.max(worst, run); }
      if (worst >= 3 && !(await one(`SELECT 1 FROM user_marks WHERE user_id = $1 AND job_id = $2 AND kind = 'late_withdrawal'`, [u.id, j.id], db))) {
        await query(`INSERT INTO user_marks (user_id, kind, reason, job_id, until) VALUES ($1, 'late_withdrawal', $2, $3, now() + make_interval(days => $4))`,
          [u.id, 'Три выхода серии подряд сняты · заказ № ' + jobNum(num), j.id, LATE_MARK_DAYS], db);
      }
    }
    await publish([j.employer_id, u.id], { t: 'job', num }, db);
  });
  return getJob(num, viewer);
}

/** «Продлить серию на месяц»: плюс SERIES_STEP выходов; нанятым — предложение продолжить на тех же условиях. */
export async function extendSeries(num: number, viewer: Viewer): Promise<JobDetail> {
  await tx(async (db) => {
    const j = await lockJob(num, db);
    needOwner(j, viewer);
    if (!j.repeat) throw new AppError(409, 'Это разовый заказ — продлевать нечего.');
    if (j.status === 'cancelled' || j.status === 'accepted') throw new AppError(409, 'Серия закрыта.');
    const r = await query('UPDATE jobs SET series_len = series_len + $2, updated_at = now() WHERE id = $1 AND series_len + $2 <= 60', [j.id, SERIES_STEP], db);
    if (!r.rowCount) throw new AppError(409, 'Серия уже максимальной длины.');
    const hired = await hiredOf(j.id, db);
    await addEvents(hired.map(h => ({
      userId: h.freelancer_id, kind: 'job', jobId: j.id, num, deliver: true,
      text: 'Серия заказа № ' + jobNum(num) + ' «' + j.title + '» продлена ещё на ' + SERIES_STEP + ' выхода на тех же условиях. Если какой-то день не подходит — отметьте «Не смогу».'
    })), db);
    await publish(hired.map(h => h.freelancer_id), { t: 'job', num }, db);
  });
  invalidateSearch();
  return getJob(num, viewer);
}
