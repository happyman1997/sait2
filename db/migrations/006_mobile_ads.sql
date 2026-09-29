-- Этап 5: чек-лист «Перед выходом» и реклама с маркировкой (erid, 38-ФЗ ст. 18.1).

-- Чек-лист исполнителя по смене: инструктаж, СИЗ. Работодатель видит отметки нанятых.
CREATE TABLE safety_checks (
  job_id        uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  items         text[] NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, freelancer_id)
);

-- Рекламные креативы. Без erid показывать нельзя — поле обязательное.
CREATE TABLE ads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement     text NOT NULL CHECK (placement IN ('feed', 'profile')),
  audience      text CHECK (audience IN ('freelancer', 'employer')),   -- NULL — всем, включая гостей
  advertiser    text NOT NULL,                                        -- наименование рекламодателя
  advertiser_inn text,
  title         text NOT NULL,
  line          text NOT NULL DEFAULT '',
  cta           text NOT NULL DEFAULT 'Подробнее',
  url           text NOT NULL CHECK (url ~ '^https?://'),
  erid          text NOT NULL CHECK (length(erid) BETWEEN 4 AND 64),
  weight        integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 100),
  starts_at     timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ads_live_idx ON ads (placement) WHERE active;

-- Статистика по дням — для отчётов в ЕРИР через ОРД.
CREATE TABLE ad_daily (
  ad_id       uuid NOT NULL REFERENCES ads (id) ON DELETE CASCADE,
  day         date NOT NULL,
  impressions integer NOT NULL DEFAULT 0,
  clicks      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ad_id, day)
);
