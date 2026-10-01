-- Последний выход серии по графику: закончившаяся серия пропадает из поиска и не принимает отклики.
-- NULL — разовый заказ или «по снегопаду» (конца нет). Точное значение пишет приложение (seriesDates);
-- для уже созданных серий — оценка сверху (реже раза в неделю выходов не бывает), уточнится при следующей правке.
ALTER TABLE jobs ADD COLUMN series_end date;
UPDATE jobs SET series_end = date + series_len * 7 WHERE repeat IS NOT NULL AND repeat NOT LIKE '%снегопад%';
