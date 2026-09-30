-- Серия выходов: каждый день сдаётся, принимается и рассчитывается отдельно.
-- Строка появляется при первой отметке по дню (сдан или принят).
CREATE TABLE series_days (
  job_id             uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  day                date NOT NULL,
  reported_at        timestamptz,
  reported_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  -- Кто выходил в этот день (снимок при сдаче и приёмке): им — уведомления и отметка «деньги получены».
  workers            uuid[] NOT NULL DEFAULT '{}',
  accepted_at        timestamptz,
  auto               boolean NOT NULL DEFAULT false,
  employer_paid_at   timestamptz,
  freelancer_paid_at timestamptz,
  PRIMARY KEY (job_id, day)
);
-- Автоприёмка: сданные и не принятые дни.
CREATE INDEX series_days_due_idx ON series_days (reported_at) WHERE accepted_at IS NULL;
