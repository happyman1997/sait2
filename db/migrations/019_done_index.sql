-- Счётчик закрытых смен исполнителя учитывает принятые дни серий, в которые он выходил (в том числе на замену).
CREATE INDEX series_days_workers_idx ON series_days USING gin (workers) WHERE accepted_at IS NOT NULL;
