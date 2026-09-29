-- Замена на день серии: после «Не смогу» день открыт для других исполнителей — отклик и найм только на этот день.
CREATE TABLE series_subs (
  job_id        uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  day           date NOT NULL,
  freelancer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'hired', 'rejected')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  PRIMARY KEY (job_id, day, freelancer_id)
);
CREATE INDEX series_subs_freelancer_idx ON series_subs (freelancer_id);
