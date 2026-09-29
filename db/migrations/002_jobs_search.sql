-- Короткий номер заказа для людей и ссылок (/?job=42): «Заказ 42».
ALTER TABLE jobs ADD COLUMN num bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX jobs_num_uq ON jobs (num);

-- Пользовательский тип всегда заводится в справочнике — type_custom (и CHECK на него) больше не нужен.
ALTER TABLE jobs DROP COLUMN type_custom;
ALTER TABLE jobs ALTER COLUMN type_id SET NOT NULL;

-- Отзыв отклика до найма: когда и сколько раз (повторный отклик разрешён).
ALTER TABLE applications ADD COLUMN withdrawn_at timestamptz;

CREATE INDEX applications_job_idx ON applications (job_id, status);
CREATE INDEX jobs_type_idx ON jobs (type_id);
