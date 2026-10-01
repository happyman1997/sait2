-- Удаление аккаунта пользователем: личные данные стираются, строка остаётся «Удалённым пользователем»
-- (на неё ссылаются заказы, переписка, отзывы, споры второй стороны).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'blocked', 'deleted'));
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
