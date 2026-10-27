-- «Деньги получены» — у каждого исполнителя своя отметка: в бригаде отметка одного не закрывает расчёт остальных.
-- day — дата выхода: у разового заказа — его дата, у серии — день серии. Сводные флаги (settlements.freelancer_marked,
-- series_days.freelancer_paid_at) — «отметили все» — пересчитывает server/settle.ts.
CREATE TABLE settle_marks (
  job_id        uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day           date NOT NULL,
  at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, freelancer_id, day)
);

-- Прежние отметки ставились одна на всех — переносим каждому, кто был в смене.
INSERT INTO settle_marks (job_id, freelancer_id, day, at)
  SELECT s.job_id, h.freelancer_id, j.date, coalesce(s.freelancer_at, now())
    FROM settlements s JOIN jobs j ON j.id = s.job_id JOIN hires h ON h.job_id = s.job_id
   WHERE s.freelancer_marked AND j.repeat IS NULL
ON CONFLICT DO NOTHING;
INSERT INTO settle_marks (job_id, freelancer_id, day, at)
  SELECT d.job_id, w.id, d.day, d.freelancer_paid_at
    FROM series_days d CROSS JOIN LATERAL unnest(d.workers) AS w(id)
   WHERE d.freelancer_paid_at IS NOT NULL
ON CONFLICT DO NOTHING;
