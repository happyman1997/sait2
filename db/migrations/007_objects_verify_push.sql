-- Этап 6: объекты работодателя, подтверждение e-mail, статус самозанятого (НПД), веб-пуш.

-- Объект: карточка адреса, с которого заказ создаётся в один клик.
ALTER TABLE objects ADD COLUMN contact text;
ALTER TABLE objects ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX jobs_object_idx ON jobs (object_id) WHERE object_id IS NOT NULL;

-- E-mail: письма уходят только на подтверждённый адрес (иначе можно «подписать» чужой ящик).
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
CREATE TABLE email_verifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email      text NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verifications_user_idx ON email_verifications (user_id);

-- Самозанятость: ИНН и результат проверки в открытом сервисе ФНС (statusnpd.nalog.ru).
ALTER TABLE freelancer_profiles ADD COLUMN inn text;
ALTER TABLE freelancer_profiles ADD COLUMN npd_status text CHECK (npd_status IN ('ok', 'not_found'));
ALTER TABLE freelancer_profiles ADD COLUMN npd_checked_at timestamptz;

-- Веб-пуш (Service Worker): подписки браузеров, канал в очереди доставки.
CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_channel_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_channel_check CHECK (channel IN ('sms', 'email', 'push'));
