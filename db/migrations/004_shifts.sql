-- Жизненный цикл смены: чат, приёмка, отзывы, жалобы.

-- Непрочитанные сообщения диалога — частичный индекс.
CREATE INDEX messages_unread_idx ON messages (job_id, freelancer_id, author_role) WHERE read_at IS NULL;

-- Автоприёмка ищет сданные, но не принятые смены по дате сдачи.
CREATE INDEX reports_reported_at_idx ON reports (reported_at);

-- Отказ в найме: когда и кто (для «Отказать остальным» и истории).
ALTER TABLE applications ADD COLUMN decided_at timestamptz;

-- Жалоба — одна от автора по заказу на конкретного человека.
CREATE UNIQUE INDEX complaints_once_uq ON complaints (job_id, author_id, coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Пометки площадки ищутся по пользователю и сроку.
CREATE INDEX user_marks_until_idx ON user_marks (user_id, until);
