-- Ревью: индексы для частых выборок, найденных без опоры на индекс.
-- «Сколько смен закрыл исполнитель» (карточка отклика, профиль, экран «Смена») — по freelancer_id.
CREATE INDEX hires_freelancer_idx ON hires (freelancer_id);
-- Уборка файлов: есть ли фото со ссылкой на файл.
CREATE INDEX photos_file_idx ON photos (file_id) WHERE file_id IS NOT NULL;
-- Незакрытые споры в профиле исполнителя.
CREATE INDEX disputes_freelancer_idx ON disputes (freelancer_id) WHERE status IN ('open', 'review');
-- Поиск пользователей в кабинете поддержки (подстрока в логине, имени, e-mail, телефоне).
CREATE INDEX users_login_trgm_idx ON users USING gin (lower(login) gin_trgm_ops);
CREATE INDEX users_name_trgm_idx ON users USING gin (lower(name) gin_trgm_ops);
CREATE INDEX users_email_trgm_idx ON users USING gin (lower(email) gin_trgm_ops);
CREATE INDEX users_phone_trgm_idx ON users USING gin (phone_key gin_trgm_ops);
