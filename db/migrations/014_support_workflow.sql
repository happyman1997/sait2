-- Кабинет поддержки: шаблоны ответов, назначение обращения на сотрудника.
CREATE TABLE support_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL CHECK (kind IN ('complaint', 'dispute', 'any')),
  title      text NOT NULL,
  body       text NOT NULL,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE complaints ADD COLUMN assigned_to uuid REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE disputes ADD COLUMN assigned_to uuid REFERENCES users (id) ON DELETE SET NULL;
