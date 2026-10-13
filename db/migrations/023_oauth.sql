-- Вход через Яндекс ID и VK ID.
-- user_identities — привязанные аккаунты: (провайдер, id пользователя у провайдера) → наш пользователь.
CREATE TABLE user_identities (
  provider   text NOT NULL CHECK (provider IN ('yandex', 'vk')),
  subject    text NOT NULL,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  UNIQUE (user_id, provider)
);

-- oauth_flows — один вход через провайдера: state и PKCE-верификатор до возврата от провайдера, затем
-- (для новой регистрации) проверенные провайдером данные под одноразовым билетом. Привязаны к браузеру,
-- начавшему вход (nonce из cookie): чужой state или билет в другом браузере не срабатывают.
CREATE TABLE oauth_flows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL CHECK (provider IN ('yandex', 'vk')),
  state_hash   bytea NOT NULL UNIQUE,
  browser_hash bytea NOT NULL,
  verifier     text NOT NULL,
  intent       text NOT NULL CHECK (intent IN ('login', 'link')),
  user_id      uuid REFERENCES users (id) ON DELETE CASCADE,   -- для intent = link
  apply_num    bigint,                                         -- отложенный отклик: вернуть к заказу
  profile      jsonb,                                          -- данные от провайдера для регистрации
  ticket_hash  bytea UNIQUE,
  returned_at  timestamptz,
  used_at      timestamptz,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_flows_expires_idx ON oauth_flows (expires_at);
