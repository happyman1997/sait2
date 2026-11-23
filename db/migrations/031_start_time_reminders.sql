-- Время начала смены (NULL — «по договорённости») и напоминания перед выходом.
-- В серии время одно на все дни; перенос даты и времени — moveDate.
ALTER TABLE jobs ADD COLUMN start_time time;

-- Отметка отправленного напоминания: одно на человека, заказ, день выхода и вид (накануне / в день выхода).
-- Перенос даты — новый день, напоминание по нему уйдёт заново.
CREATE TABLE shift_reminders (
  job_id     uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        date NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('eve', 'soon')),
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id, day, kind)
);
CREATE INDEX shift_reminders_day_idx ON shift_reminders (day);
