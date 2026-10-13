-- Уведомления у новых пользователей — бесплатными каналами: SMS выключены по умолчанию (человек включает их сам),
-- письма включены (уходят только на подтверждённый адрес; письмо для подтверждения приходит сразу после регистрации).
-- Уже заданные настройки не меняются.
ALTER TABLE notification_settings ALTER COLUMN sms SET DEFAULT false;
ALTER TABLE notification_settings ALTER COLUMN email SET DEFAULT true;
