-- Этап 7: кабинет поддержки — разбор жалоб, блокировки, журнал действий сотрудников.

ALTER TABLE users ADD COLUMN is_staff boolean NOT NULL DEFAULT false;

ALTER TABLE complaints ADD COLUMN status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'rejected'));
ALTER TABLE complaints ADD COLUMN resolution text;
ALTER TABLE complaints ADD COLUMN resolved_by uuid REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE complaints ADD COLUMN resolved_at timestamptz;
CREATE INDEX complaints_open_idx ON complaints (created_at) WHERE status = 'open';

-- Кто из сотрудников что сделал — для разборов и споров.
CREATE TABLE staff_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  action       text NOT NULL,
  user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  complaint_id uuid REFERENCES complaints (id) ON DELETE SET NULL,
  note         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_actions_user_idx ON staff_actions (user_id, created_at DESC);

-- Площадка отменяет открытые заказы заблокированного работодателя.
ALTER TABLE cancellations DROP CONSTRAINT cancellations_by_role_check;
ALTER TABLE cancellations ADD CONSTRAINT cancellations_by_role_check CHECK (by_role IN ('employer', 'platform'));
