// «Мои объекты» работодателя: карточка адреса (объём, кто встречает, доступ, инвентарь),
// заказ с объекта в один клик и история смен по нему.
import { ACCESS, TOOLS } from '@/lib/catalog';
import { findBadField } from '@/lib/moderation';
import { one, query } from './db';
import { AppError, ModerationError } from './errors';
import type { SessionUser } from './session';

type U = Pick<SessionUser, 'id' | 'role'>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OBJECTS = 50;

export type ObjectCard = {
  id: string; name: string; address: string; lat: number; lng: number; area: string; contact: string;
  access: string[]; tools: string; shifts: number; lastDate: string | null;
};

function needEmployer(u: U | null): U {
  if (!u) throw new AppError(401, 'Нужно войти в аккаунт.');
  if (u.role !== 'employer') throw new AppError(403, 'Объекты ведёт работодатель.');
  return u;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

type Row = { id: string; name: string | null; address: string; lat: number; lng: number; area: string | null; contact: string | null; access: string[]; tools: string | null; shifts: number; last_date: string | null };

const SELECT = `SELECT o.id, o.name, o.address, o.lat, o.lng, o.area, o.contact, o.access, o.tools,
                       (SELECT count(*) FROM jobs j WHERE j.object_id = o.id)::int AS shifts,
                       (SELECT to_char(max(j.date), 'YYYY-MM-DD') FROM jobs j WHERE j.object_id = o.id) AS last_date
                  FROM objects o`;

const card = (r: Row): ObjectCard => ({
  id: r.id, name: r.name || r.address, address: r.address, lat: r.lat, lng: r.lng, area: r.area || '', contact: r.contact || '',
  access: r.access, tools: r.tools || '', shifts: r.shifts, lastDate: r.last_date
});

export async function listObjects(viewer: U | null): Promise<ObjectCard[]> {
  const u = needEmployer(viewer);
  const r = await query<Row>(SELECT + ' WHERE o.employer_id = $1 ORDER BY o.updated_at DESC', [u.id]);
  return r.rows.map(card);
}

/** Создать (id не указан) или изменить объект. */
export async function saveObject(viewer: U | null, raw: unknown, id?: string): Promise<ObjectCard> {
  const u = needEmployer(viewer);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const f = {
    name: str(r.name, 80), address: str(r.address, 200), area: str(r.area, 120), contact: str(r.contact, 160),
    lat: typeof r.lat === 'number' && Math.abs(r.lat) <= 90 ? r.lat : null,
    lng: typeof r.lng === 'number' && Math.abs(r.lng) <= 180 ? r.lng : null,
    access: (Array.isArray(r.access) ? r.access : []).filter((a): a is string => typeof a === 'string' && ACCESS.includes(a)),
    tools: typeof r.tools === 'string' && TOOLS.includes(r.tools) ? r.tools : ''
  };
  if (!f.name) throw new AppError(422, 'У объекта должно быть название.', 'name');
  if (!f.address) throw new AppError(422, 'Укажите адрес объекта.', 'address');
  const bad = findBadField([
    { field: 'name', label: 'Название', value: f.name }, { field: 'address', label: 'Адрес', value: f.address },
    { field: 'area', label: 'Объём', value: f.area }, { field: 'contact', label: 'Кто встречает', value: f.contact }
  ]);
  if (bad) throw new ModerationError(bad.field, bad.label, bad.category);

  if (id) {
    if (!UUID_RE.test(id)) throw new AppError(404, 'Объект не найден.');
    const cur = await one<{ lat: number; lng: number }>('SELECT lat, lng FROM objects WHERE id = $1 AND employer_id = $2', [id, u.id]);
    if (!cur) throw new AppError(404, 'Объект не найден.');
    await query(
      `UPDATE objects SET name = $3, address = $4, lat = $5, lng = $6, area = $7, contact = $8, access = $9, tools = $10, updated_at = now()
        WHERE id = $1 AND employer_id = $2`,
      [id, u.id, f.name, f.address, f.lat ?? cur.lat, f.lng ?? cur.lng, f.area || null, f.contact || null, f.access, f.tools || null]);
  } else {
    if (f.lat == null || f.lng == null) throw new AppError(422, 'Поставьте точку объекта на карте.', 'address');
    const n = (await one<{ n: number }>('SELECT count(*)::int AS n FROM objects WHERE employer_id = $1', [u.id]))!.n;
    if (n >= MAX_OBJECTS) throw new AppError(409, 'Не больше ' + MAX_OBJECTS + ' объектов — удалите ненужные.');
    const row = await one<{ id: string }>(
      `INSERT INTO objects (employer_id, name, address, lat, lng, area, contact, access, tools) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [u.id, f.name, f.address, f.lat, f.lng, f.area || null, f.contact || null, f.access, f.tools || null]);
    id = row!.id;
  }
  return card((await one<Row>(SELECT + ' WHERE o.id = $1', [id]))!);
}

export async function deleteObject(viewer: U | null, id: string) {
  const u = needEmployer(viewer);
  if (!UUID_RE.test(id)) throw new AppError(404, 'Объект не найден.');
  const r = await query('DELETE FROM objects WHERE id = $1 AND employer_id = $2', [id, u.id]);
  if (!r.rowCount) throw new AppError(404, 'Объект не найден.');
  return { ok: true };
}

/** Смены по объекту — для карточки объекта. */
export async function objectShifts(viewer: U | null, id: string) {
  const u = needEmployer(viewer);
  if (!UUID_RE.test(id)) throw new AppError(404, 'Объект не найден.');
  const r = await query<{ num: string; title: string; date: string; status: string; hired: number }>(
    `SELECT j.num, j.title, to_char(j.date, 'YYYY-MM-DD') AS date, j.status,
            (SELECT count(*) FROM hires h WHERE h.job_id = j.id)::int AS hired
       FROM jobs j JOIN objects o ON o.id = j.object_id
      WHERE o.id = $1 AND o.employer_id = $2 ORDER BY j.date DESC LIMIT 30`, [id, u.id]);
  return r.rows.map(j => ({ num: Number(j.num), title: j.title, date: j.date, status: j.status, hired: j.hired }));
}
