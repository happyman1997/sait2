-- Выходы «по снегопаду»: работодатель вызывает бригаду на дату; каждый вызов — день серии
-- (снять, замена, сдать, принять, расчёт — как у дней по графику).
CREATE TABLE series_calls (
  job_id     uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  day        date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, day)
);
