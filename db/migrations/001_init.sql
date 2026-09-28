-- Арена Работы — базовая схема.
-- Перечисления — через CHECK, чтобы добавлять значения без ALTER TYPE.
-- Гео: cube + earthdistance (есть в contrib любого Postgres, в т.ч. Yandex Managed PG / Selectel).

CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- ───────────────────────── Пользователи и профили ─────────────────────────

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role                text NOT NULL CHECK (role IN ('freelancer', 'employer')),   -- один аккаунт — одна роль, не меняется
  login               text NOT NULL CHECK (login ~ '^[a-zA-Z0-9._]{3,20}$'),
  phone               text NOT NULL,                                             -- +7XXXXXXXXXX для отображения
  phone_key           text NOT NULL CHECK (phone_key ~ '^[0-9]{10}$'),           -- последние 10 цифр, по ним сравнение
  email               text NOT NULL,
  password_hash       text NOT NULL,
  name                text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  city                text NOT NULL,
  base_lat            double precision,
  base_lng            double precision,
  avatar_url          text,
  bio                 text,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  no_show_count       integer NOT NULL DEFAULT 0,
  offer_accepted_at   timestamptz NOT NULL,                                      -- оферта + согласие на обработку ПДн
  offer_version       text NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_login_uq ON users (lower(login));
CREATE UNIQUE INDEX users_phone_key_uq ON users (phone_key);
CREATE INDEX users_role_idx ON users (role);

CREATE TABLE freelancer_profiles (
  user_id       uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  skills        text[] NOT NULL DEFAULT '{}',    -- id из job_types
  custom_skills text[] NOT NULL DEFAULT '{}',    -- свои навыки
  gear          text[] NOT NULL DEFAULT '{}',    -- свой инвентарь (справочные + свои)
  custom_gear   text[] NOT NULL DEFAULT '{}',
  own_car       boolean NOT NULL DEFAULT false,
  work_cities   text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE employer_profiles (
  user_id      uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  org_type     text NOT NULL DEFAULT 'частное лицо',
  org_name     text,
  inn          text,
  inn_checked  boolean NOT NULL DEFAULT false,   -- проверки ИНН нет намеренно; поле на будущее
  object_kind  text,
  object_other text,
  access       text[] NOT NULL DEFAULT '{}',      -- как попасть на объект
  tools        text,                             -- чей инвентарь
  meet_name    text,
  meet_phone   text,
  pass_mode    text,
  pass_whom    text,
  safety_req   text[] NOT NULL DEFAULT '{}'
);

-- Пометки площадки: поздний отказ (90 дней), неявка, решения по жалобам.
CREATE TABLE user_marks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('late_cancel', 'late_withdrawal', 'no_show', 'complaint', 'demoted', 'blocked')),
  reason     text,
  job_id     uuid,
  until      timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_marks_user_idx ON user_marks (user_id, created_at DESC);

-- ───────────────────────── Авторизация ─────────────────────────

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,            -- sha256 от токена в cookie
  user_agent   text,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Коды подтверждения (SMS / звонок): регистрация и восстановление пароля.
CREATE TABLE auth_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose       text NOT NULL CHECK (purpose IN ('signup', 'recover')),
  phone         text NOT NULL,
  phone_key     text NOT NULL,
  user_id       uuid REFERENCES users (id) ON DELETE CASCADE,   -- для recover
  payload       jsonb,                                         -- для signup: данные анкеты (пароль — уже хэш)
  channel       text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'call')),
  code_hash     text,                                          -- null для «пустышки» (восстановление несуществующего аккаунта)
  attempts      integer NOT NULL DEFAULT 0,
  sent_count    integer NOT NULL DEFAULT 1,
  last_sent_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  verified_at   timestamptz,
  consumed_at   timestamptz,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_challenges_phone_idx ON auth_challenges (phone_key, created_at DESC);

-- Счётчики ограничения частоты (вход, отправка кодов) — работают и при нескольких инстансах.
CREATE TABLE rate_limits (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL
);

-- ───────────────────────── Справочники ─────────────────────────

CREATE TABLE job_types (
  id         text PRIMARY KEY,
  label      text NOT NULL,
  season     text,                                   -- справочно; в фильтрах сезонов нет
  is_custom  boolean NOT NULL DEFAULT false,         -- пользовательский тип появляется после публикации заказа
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX job_types_label_uq ON job_types (lower(label));

INSERT INTO job_types (id, label, season) VALUES
  ('snow', 'Уборка снега', 'Зима'),
  ('ice', 'Удаление наледи', 'Зима'),
  ('roof', 'Очистка крыш', 'Зима'),
  ('salt', 'Подсыпка реагентом', 'Зима'),
  ('thaw', 'Пробивка ливневок', 'Весна'),
  ('green', 'Озеленение', 'Весна'),
  ('spring', 'Весенний субботник', 'Весна'),
  ('facade', 'Мойка фасадов и окон', 'Весна'),
  ('grass', 'Покос травы', 'Лето'),
  ('trim', 'Стрижка кустов и деревьев', 'Лето'),
  ('water', 'Полив газонов', 'Лето'),
  ('paint', 'Покраска ограждений', 'Лето'),
  ('dacha', 'Работы на участке', 'Лето'),
  ('leaves', 'Уборка листвы', 'Осень'),
  ('harvest', 'Сбор урожая', 'Осень'),
  ('winterize', 'Подготовка к зиме', 'Осень'),
  ('street', 'Уличная уборка', 'Круглый год'),
  ('trash', 'Вывоз мусора и хлама', 'Круглый год'),
  ('load', 'Погрузка и разгрузка', 'Круглый год');

-- ───────────────────────── Объекты и заказы ─────────────────────────

CREATE TABLE objects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        text,
  address     text NOT NULL,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  kind        text,
  area        text,
  access      text[] NOT NULL DEFAULT '{}',
  tools       text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX objects_employer_idx ON objects (employer_id);

CREATE TABLE jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  object_id     uuid REFERENCES objects (id) ON DELETE SET NULL,
  type_id       text REFERENCES job_types (id),
  type_custom   text,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  address       text NOT NULL,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  district      text,
  pay           integer NOT NULL CHECK (pay >= 0),
  unit          text NOT NULL,                        -- 'за заказ' | 'за час' | 'за сотку' | 'за смену' | 'за м²' | свой
  pay_type      text,
  pay_when      text,
  date          date NOT NULL,
  volume        text,
  crew          integer NOT NULL DEFAULT 1 CHECK ((crew BETWEEN 1 AND 12) OR crew = 99),  -- 99 = «сколько угодно»
  urgent        boolean NOT NULL DEFAULT false,
  repeat        text,
  repeat_note   text,
  requirement   text,                                 -- своё условие для отклика
  access        text[] NOT NULL DEFAULT '{}',
  tools         text CHECK (tools IS NULL OR tools IN ('инвентарь есть на объекте', 'нужен свой инвентарь', 'часть своя, часть на месте')),
  meet_name     text,
  meet_phone    text,                                 -- видит только нанятый
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'staffed', 'reported', 'accepted', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (type_id IS NOT NULL OR type_custom IS NOT NULL)
);
CREATE INDEX jobs_employer_idx ON jobs (employer_id, created_at DESC);
CREATE INDEX jobs_status_date_idx ON jobs (status, date);
CREATE INDEX jobs_geo_idx ON jobs USING gist (ll_to_earth(lat, lng));

-- ───────────────────────── Жизненный цикл смены ─────────────────────────

CREATE TABLE applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'hired', 'rejected', 'withdrawn')),
  req_confirmed boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, freelancer_id)                      -- повторный отклик запрещён
);
CREATE INDEX applications_freelancer_idx ON applications (freelancer_id, created_at DESC);

CREATE TABLE hires (
  job_id        uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  is_lead       boolean NOT NULL DEFAULT false,       -- старший бригады
  hired_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, freelancer_id)
);
CREATE UNIQUE INDEX hires_one_lead_uq ON hires (job_id) WHERE is_lead;

CREATE TABLE reports (
  job_id      uuid PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES users (id),
  reported_at timestamptz NOT NULL DEFAULT now()      -- +7 дней → автоприёмка
);

CREATE TABLE acceptances (
  job_id      uuid PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  auto        boolean NOT NULL DEFAULT false
);

CREATE TABLE cancellations (
  job_id  uuid PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
  by_role text NOT NULL CHECK (by_role IN ('employer')),
  reason  text NOT NULL,
  notice  text NOT NULL CHECK (notice IN ('больше суток', 'меньше суток')),
  late    boolean NOT NULL,
  at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE withdrawals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason        text NOT NULL,
  notice        text NOT NULL CHECK (notice IN ('больше суток', 'меньше суток')),
  late          boolean NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX withdrawals_job_idx ON withdrawals (job_id);

CREATE TABLE no_shows (
  job_id        uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, freelancer_id)
);

CREATE TABLE settlements (
  job_id            uuid PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
  employer_marked   boolean NOT NULL DEFAULT false,   -- «оплата передана»
  employer_at       timestamptz,
  freelancer_marked boolean NOT NULL DEFAULT false,   -- «деньги получены»
  freelancer_at     timestamptz
);

-- ───────────────────────── Чат, фото, отзывы, жалобы ─────────────────────────

CREATE TABLE messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  -- диалог внутри заказа: работодатель ↔ конкретный исполнитель
  freelancer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_role text NOT NULL CHECK (author_role IN ('freelancer', 'employer', 'system')),
  text        text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX messages_thread_idx ON messages (job_id, freelancer_id, created_at);

CREATE TABLE photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('before', 'after')),
  url         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX photos_job_idx ON photos (job_id);

CREATE TABLE reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  author_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating         smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text           text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  editable_until timestamptz NOT NULL,
  UNIQUE (job_id, author_id, target_id)
);
CREATE INDEX reviews_target_idx ON reviews (target_id, created_at DESC);

CREATE TABLE complaints (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  reason     text NOT NULL,
  text       text NOT NULL DEFAULT '',
  emailed_at timestamptz,                             -- отправлено в поддержку
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Журнал / уведомления ─────────────────────────

CREATE TABLE events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text NOT NULL,
  text       text NOT NULL,
  job_id     uuid REFERENCES jobs (id) ON DELETE SET NULL,
  muted      boolean NOT NULL DEFAULT false,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_user_idx ON events (user_id, created_at DESC);

CREATE TABLE notification_settings (
  user_id       uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  enabled       boolean NOT NULL DEFAULT true,
  push          boolean NOT NULL DEFAULT true,
  sms           boolean NOT NULL DEFAULT true,
  email         boolean NOT NULL DEFAULT false,
  radius_km     integer NOT NULL DEFAULT 50,
  quiet_on      boolean NOT NULL DEFAULT true,
  quiet_from    smallint NOT NULL DEFAULT 22,
  quiet_to      smallint NOT NULL DEFAULT 7,
  urgent_bypass boolean NOT NULL DEFAULT true,
  daily_cap     smallint NOT NULL DEFAULT 5
);

-- Счётчики на экране входа: снимок раз в сутки.
CREATE TABLE daily_stats (
  day        date PRIMARY KEY,
  freelancers integer NOT NULL,
  employers  integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
