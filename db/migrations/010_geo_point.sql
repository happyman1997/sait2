-- Оптимизация поиска: точка заказа хранится готовой (ll_to_earth не пересчитывается на каждой строке при сортировке и фильтре).
ALTER TABLE jobs ADD COLUMN pt earth GENERATED ALWAYS AS (ll_to_earth(lat, lng)) STORED;
CREATE INDEX jobs_pt_idx ON jobs USING gist (pt);
DROP INDEX jobs_geo_idx;
