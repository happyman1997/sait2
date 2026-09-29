-- Текстовый поиск по заказам: триграммы вместо полного перебора с ILIKE по склейке строк.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE jobs ADD COLUMN search text
  GENERATED ALWAYS AS (lower(title || ' ' || address || ' ' || coalesce(district, ''))) STORED;
CREATE INDEX jobs_search_trgm_idx ON jobs USING gin (search gin_trgm_ops);
CREATE INDEX job_types_label_trgm_idx ON job_types USING gin (lower(label) gin_trgm_ops);

-- Карта показывает только живые заказы: частичный индекс по дате для них.
CREATE INDEX jobs_live_date_idx ON jobs (date) WHERE status IN ('open', 'staffed');

-- Служебная очистка по сроку.
CREATE INDEX auth_challenges_expires_idx ON auth_challenges (expires_at);
CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);
