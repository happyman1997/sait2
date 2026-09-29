-- Профиль, файлы, журнал и доставка уведомлений.

-- Список диалогов исполнителя: сообщения по исполнителю.
CREATE INDEX messages_freelancer_idx ON messages (freelancer_id, job_id);

-- База для поиска: подпись точки (адрес или город), координаты уже есть.
ALTER TABLE users ADD COLUMN base_label text;

-- Смена телефона тоже подтверждается кодом.
ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_purpose_check;
ALTER TABLE auth_challenges ADD CONSTRAINT auth_challenges_purpose_check CHECK (purpose IN ('signup', 'recover', 'phone'));

-- Загруженные файлы (аватары, фото смены). Храним на диске/в объектном хранилище, в БД — метаданные.
CREATE TABLE files (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('avatar', 'photo')),
  mime       text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  size       integer NOT NULL,
  job_id     uuid REFERENCES jobs (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_owner_idx ON files (owner_id);
ALTER TABLE photos ADD COLUMN file_id uuid REFERENCES files (id) ON DELETE CASCADE;

-- Журнал: доставка во внешние каналы.
ALTER TABLE events ADD COLUMN urgent boolean NOT NULL DEFAULT false;

-- Очередь доставки SMS/e-mail: отправка вне запроса, с повторами.
CREATE TABLE notification_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users (id) ON DELETE CASCADE,
  event_id    uuid REFERENCES events (id) ON DELETE SET NULL,
  channel     text NOT NULL CHECK (channel IN ('sms', 'email')),
  to_addr     text NOT NULL,
  subject     text,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts    integer NOT NULL DEFAULT 0,
  next_try_at timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON notification_outbox (next_try_at) WHERE status = 'pending';
CREATE INDEX outbox_user_day_idx ON notification_outbox (user_id, created_at);

-- Настройки для «новых смен рядом»: ищем исполнителей по базе.
CREATE INDEX users_base_geo_idx ON users USING gist (ll_to_earth(base_lat, base_lng)) WHERE role = 'freelancer' AND base_lat IS NOT NULL;
