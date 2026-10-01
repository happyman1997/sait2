// Общие счётчики для карточек и профиля.

/**
 * Закрытые смены исполнителя (SQL-выражение): разовые заказы, принятые с его наймом, плюс принятые дни серий,
 * в которые он выходил, — и в составе, и на замену. id — SQL-выражение (u.id, $1), не пользовательский ввод.
 */
export const doneSql = (id: string) =>
  `((SELECT count(*) FROM hires dh JOIN jobs dj ON dj.id = dh.job_id JOIN acceptances da ON da.job_id = dh.job_id
      WHERE dh.freelancer_id = ${id} AND dj.repeat IS NULL)
  + (SELECT count(*) FROM series_days sd WHERE sd.accepted_at IS NOT NULL AND sd.workers @> ARRAY[${id}]::uuid[]))::int`;
