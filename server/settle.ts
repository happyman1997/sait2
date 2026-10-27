// «Деньги получены» — у каждого исполнителя своя отметка (settle_marks): в бригаде отметка одного не закрывает расчёт
// остальных. Сводные флаги «отметили все» пересчитываются отсюда: settlements.freelancer_marked (разовый заказ —
// все нанятые) и series_days.freelancer_paid_at (день серии — все, кто в нём выходил).
import { one, query, type Db } from './db';

/**
 * SQL-выражение: отметил ли исполнитель me получение по заказу job. Разовый заказ — его отметка есть; серия (repeat
 * не NULL) — отмечены все принятые дни, в которые он выходил. Аргументы — SQL-выражения ($1, j.id, j.repeat…).
 */
export const myPaidSql = (job: string, me: string, repeat: string) => `(CASE WHEN ${repeat} IS NULL
    THEN EXISTS (SELECT 1 FROM settle_marks m WHERE m.job_id = ${job} AND m.freelancer_id = ${me})
    ELSE NOT EXISTS (SELECT 1 FROM series_days d WHERE d.job_id = ${job} AND d.accepted_at IS NOT NULL AND ${me} = ANY(d.workers)
           AND NOT EXISTS (SELECT 1 FROM settle_marks m WHERE m.job_id = d.job_id AND m.freelancer_id = ${me} AND m.day = d.day)) END)`;

/** Разовый заказ: отметка исполнителя; true — новая (не стояла раньше). Сводка по заказу пересчитывается. */
export async function markJobPaid(jobId: string, day: string, freelancerId: string, db: Db) {
  const r = await query('INSERT INTO settle_marks (job_id, freelancer_id, day) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [jobId, freelancerId, day], db);
  await syncCrewSettle(jobId, db);
  return !!r.rowCount;
}

/** Серия: отметки исполнителя за все принятые дни, в которые он выходил; true — хоть одна новая. */
export async function markSeriesPaid(jobId: string, freelancerId: string, db: Db) {
  const r = await query(
    `INSERT INTO settle_marks (job_id, freelancer_id, day)
     SELECT job_id, $2, day FROM series_days WHERE job_id = $1 AND accepted_at IS NOT NULL AND $2::uuid = ANY(workers)
     ON CONFLICT DO NOTHING`, [jobId, freelancerId], db);
  await syncDaysPaid(jobId, db);
  await syncSeriesSettle(jobId, db);
  return !!r.rowCount;
}

/** День серии: отметка исполнителя за день; true — новая. */
export async function markDayPaid(jobId: string, day: string, freelancerId: string, db: Db) {
  const r = await query('INSERT INTO settle_marks (job_id, freelancer_id, day) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [jobId, freelancerId, day], db);
  await syncDaysPaid(jobId, db);
  return !!r.rowCount;
}

/** Разовый заказ: «деньги получены» по заказу — когда отметили все нанятые. */
export async function syncCrewSettle(jobId: string, db: Db) {
  return one<{ employer_marked: boolean; freelancer_marked: boolean }>(
    `INSERT INTO settlements (job_id, freelancer_marked, freelancer_at)
     SELECT $1, x.f, CASE WHEN x.f THEN now() END
       FROM (SELECT NOT EXISTS (SELECT 1 FROM hires h WHERE h.job_id = $1
                     AND NOT EXISTS (SELECT 1 FROM settle_marks m WHERE m.job_id = $1 AND m.freelancer_id = h.freelancer_id)) AS f) x
     ON CONFLICT (job_id) DO UPDATE SET freelancer_marked = EXCLUDED.freelancer_marked,
            freelancer_at = CASE WHEN EXCLUDED.freelancer_marked THEN coalesce(settlements.freelancer_at, now()) END
     RETURNING employer_marked, freelancer_marked`, [jobId], db);
}

/** День серии: «деньги получены» за день — когда отметили все, кто в нём выходил. */
async function syncDaysPaid(jobId: string, db: Db) {
  await query(
    `UPDATE series_days d SET freelancer_paid_at = now()
      WHERE d.job_id = $1 AND d.accepted_at IS NOT NULL AND d.freelancer_paid_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM unnest(d.workers) w(id)
                         WHERE NOT EXISTS (SELECT 1 FROM settle_marks m WHERE m.job_id = d.job_id AND m.day = d.day AND m.freelancer_id = w.id))`,
    [jobId], db);
}

/** Расчёт по завершённой серии — сводка по дням: отмечен, когда отмечены все принятые дни. */
export async function syncSeriesSettle(jobId: string, db: Db) {
  await query(
    `UPDATE settlements s SET employer_marked = x.e, freelancer_marked = x.f,
            employer_at = CASE WHEN x.e THEN coalesce(s.employer_at, now()) END,
            freelancer_at = CASE WHEN x.f THEN coalesce(s.freelancer_at, now()) END
       FROM (SELECT coalesce(bool_and(employer_paid_at IS NOT NULL), true) AS e, coalesce(bool_and(freelancer_paid_at IS NOT NULL), true) AS f
               FROM series_days WHERE job_id = $1 AND accepted_at IS NOT NULL) x
      WHERE s.job_id = $1`, [jobId], db);
}
