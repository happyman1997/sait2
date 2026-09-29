-- Этап 9: серия выходов регулярного заказа (ежедневно, будни, 2/2, раз в неделю, по снегопаду).
-- Каждый день серии — отдельная смена; нанятый может снять один день, не снимая остальные.
ALTER TABLE jobs ADD COLUMN series_len smallint NOT NULL DEFAULT 5 CHECK (series_len BETWEEN 1 AND 60);
CREATE TABLE series_skips (
  job_id        uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day           date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, freelancer_id, day)
);
