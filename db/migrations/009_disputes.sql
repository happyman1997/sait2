-- Этап 8: споры по расчёту между работодателем и исполнителем (площадка денег не держит — фиксирует и разбирает).
CREATE TABLE disputes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  num           integer GENERATED ALWAYS AS IDENTITY (START WITH 1001) UNIQUE,
  job_id        uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,   -- пара «работодатель ↔ этот исполнитель»
  opened_by     text NOT NULL CHECK (opened_by IN ('employer', 'freelancer')),
  reason        text NOT NULL,
  sum           integer NOT NULL CHECK (sum >= 0),
  text          text NOT NULL,
  evidence      jsonb NOT NULL DEFAULT '[]',
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'review', 'paid', 'withdrawn', 'resolved')),
  response      text,
  resolution    text,
  resolved_for  text CHECK (resolved_for IN ('employer', 'freelancer')),
  resolved_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Один незакрытый спор на пару в заказе.
CREATE UNIQUE INDEX disputes_open_uq ON disputes (job_id, freelancer_id) WHERE status IN ('open', 'review');
CREATE INDEX disputes_queue_idx ON disputes (created_at) WHERE status IN ('open', 'review');
