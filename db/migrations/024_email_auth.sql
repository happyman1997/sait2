-- Вход и регистрация — по e-mail (код в письме), Яндекс ID или VK ID. Телефон пользователя больше не собирается,
-- звонков и SMS площадка не отправляет.

-- Телефоны: новые аккаунты без них, прежние стираются (не нужны ни для входа, ни для связи — связь в чате).
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL, ALTER COLUMN phone_key DROP NOT NULL;
UPDATE users SET phone = NULL, phone_key = NULL;
DROP INDEX IF EXISTS users_phone_trgm_idx;

-- Почта — логин и способ восстановления: один адрес — один аккаунт (у удалённых аккаунтов адрес пустой).
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE email <> '';

-- Коды подтверждения: на почту. target_key — по нему паузы и лимиты: 'e:<почта>' или 'l:<логин>'
-- («пустое» восстановление несуществующего логина).
DELETE FROM auth_challenges;
ALTER TABLE auth_challenges DROP COLUMN phone;
ALTER TABLE auth_challenges RENAME COLUMN phone_key TO target_key;
ALTER INDEX auth_challenges_phone_idx RENAME TO auth_challenges_target_idx;
ALTER TABLE auth_challenges ADD COLUMN email text;
ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_channel_check;
ALTER TABLE auth_challenges ALTER COLUMN channel SET DEFAULT 'email';
ALTER TABLE auth_challenges ADD CONSTRAINT auth_challenges_channel_check CHECK (channel = 'email');
ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_purpose_check;
ALTER TABLE auth_challenges ADD CONSTRAINT auth_challenges_purpose_check CHECK (purpose IN ('signup', 'recover', 'email'));

-- SMS-уведомлений больше нет.
UPDATE notification_settings SET sms = false;
UPDATE notification_outbox SET status = 'skipped', error = 'SMS отключены' WHERE channel = 'sms' AND status = 'pending';
