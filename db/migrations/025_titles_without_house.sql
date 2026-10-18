-- Заголовок заказа — без дома, корпуса и квартиры (lib/jobs.ts autoTitle): его видят все, а дом частного заказчика —
-- только нанятый исполнитель. Пересчитываем заголовки, собранные по прежнему правилу (две последние части адреса),
-- и те же строки в журнале. Заголовки, заданные иначе (демо-данные), не трогаем.
CREATE TEMP TABLE title_fix ON COMMIT DROP AS
SELECT j.id,
       left(upper(left(t.label, 1)) || substr(t.label, 2) || coalesce(' — ' || nullif(o.head, ''), ''), 160) AS old_title,
       left(upper(left(t.label, 1)) || substr(t.label, 2) || coalesce(' — ' || nullif(n.head, ''), ''), 160) AS new_title
  FROM jobs j
  JOIN job_types t ON t.id = j.type_id
  CROSS JOIN LATERAL (
    SELECT string_agg(p, ', ' ORDER BY i) AS head FROM (
      SELECT p, i FROM (SELECT btrim(u.p) AS p, u.i FROM unnest(string_to_array(j.address, ',')) WITH ORDINALITY AS u(p, i)) a
       WHERE p <> '' ORDER BY i DESC LIMIT 2) x) o
  CROSS JOIN LATERAL (
    SELECT string_agg(p, ', ' ORDER BY i) AS head FROM (
      SELECT p, i FROM (SELECT btrim(u.p) AS p, u.i FROM unnest(string_to_array(j.address, ',')) WITH ORDINALITY AS u(p, i)) a
       WHERE p <> '' AND p !~ '[0-9]' ORDER BY i DESC LIMIT 2) x) n;

DELETE FROM title_fix f USING jobs j WHERE j.id = f.id AND (j.title <> f.old_title OR f.old_title = f.new_title);

UPDATE events e SET text = replace(e.text, '«' || f.old_title || '»', '«' || f.new_title || '»')
  FROM title_fix f WHERE e.job_id = f.id;
UPDATE events e SET text = replace(e.text, ': ' || f.old_title || ' · ', ': ' || f.new_title || ' · ')
  FROM title_fix f WHERE e.job_id = f.id;
UPDATE jobs j SET title = f.new_title FROM title_fix f WHERE j.id = f.id;
