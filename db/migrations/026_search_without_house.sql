-- Поиск по заказам — без дома, корпуса и квартиры. Раньше строка поиска содержала полный адрес: перебором
-- «Тверская, 16», «Тверская, 18»… можно было узнать дом частного заказчика, который до найма скрыт.
-- Части адреса с цифрами отбрасываются по тому же правилу, что в заголовке и гостевой карточке (server/privacy.ts).
DROP INDEX IF EXISTS jobs_search_trgm_idx;
ALTER TABLE jobs DROP COLUMN search;
ALTER TABLE jobs ADD COLUMN search text
  GENERATED ALWAYS AS (lower(title || ' ' || regexp_replace(address, '(^|,)[^,]*[0-9][^,]*', '', 'g') || ' ' || coalesce(district, ''))) STORED;
CREATE INDEX jobs_search_trgm_idx ON jobs USING gin (search gin_trgm_ops);
