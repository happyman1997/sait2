// Загрузка изображений: аватары (видны всем) и фото смены «до/после» (только участникам смены).
// Тип определяется по сигнатуре файла, а не по расширению или Content-Type клиента.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { one, pool, query, tx, type Db } from './db';
import { AppError } from './errors';
import { publish } from './live';
import type { SessionUser } from './session';

export type Mime = 'image/jpeg' | 'image/png' | 'image/webp';
const LIMIT = { avatar: 3 * 1024 * 1024, photo: 8 * 1024 * 1024 };
const MAX_PHOTOS = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sniff(b: Uint8Array): Mime | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

const dir = () => path.resolve(config.uploadDir());
const fileOf = (id: string) => path.join(dir(), id);

async function store(ownerId: string, kind: 'avatar' | 'photo', file: unknown, jobId: string | null) {
  if (!(file instanceof Blob)) throw new AppError(422, 'Прикрепите изображение.', 'file');
  if (file.size > LIMIT[kind]) throw new AppError(413, 'Файл больше ' + LIMIT[kind] / 1024 / 1024 + ' МБ — уменьшите фото.', 'file');
  const buf = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(buf);
  if (!mime) throw new AppError(415, 'Подходят только фото JPEG, PNG или WebP.', 'file');
  const row = await one<{ id: string }>('INSERT INTO files (owner_id, kind, mime, size, job_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [ownerId, kind, mime, buf.length, jobId]);
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeFile(fileOf(row!.id), buf);
  return row!.id;
}

async function removeFile(id: string) {
  await query('DELETE FROM files WHERE id = $1', [id]);
  await fs.rm(fileOf(id), { force: true });
}

export async function setAvatar(u: Pick<SessionUser, 'id' | 'avatar_url'>, file: unknown) {
  const id = await store(u.id, 'avatar', file, null);
  const old = u.avatar_url?.match(/\/api\/files\/([0-9a-f-]{36})/)?.[1];
  await query('UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1', [u.id, '/api/files/' + id]);
  if (old) await removeFile(old);
  return { avatarUrl: '/api/files/' + id };
}

export async function clearAvatar(u: Pick<SessionUser, 'id' | 'avatar_url'>) {
  const old = u.avatar_url?.match(/\/api\/files\/([0-9a-f-]{36})/)?.[1];
  await query('UPDATE users SET avatar_url = NULL, updated_at = now() WHERE id = $1', [u.id]);
  if (old) await removeFile(old);
  return { avatarUrl: null };
}

/** Участники смены: работодатель заказа и нанятые (в т. ч. после приёмки). */
async function jobParty(jobId: string, userId: string) {
  const r = await one<{ owner: boolean; hired: boolean }>(
    `SELECT j.employer_id = $2 AS owner, EXISTS (SELECT 1 FROM hires h WHERE h.job_id = j.id AND h.freelancer_id = $2) AS hired FROM jobs j WHERE j.id = $1`,
    [jobId, userId]);
  return r && (r.owner || r.hired) ? r : null;
}

export async function readFile(id: string, viewer: Pick<SessionUser, 'id'> | null) {
  if (!UUID_RE.test(id)) throw new AppError(404, 'Файл не найден.');
  const f = await one<{ kind: string; mime: Mime; job_id: string | null }>('SELECT kind, mime, job_id FROM files WHERE id = $1', [id]);
  if (!f) throw new AppError(404, 'Файл не найден.');
  if (f.kind === 'photo' && (!viewer || !f.job_id || !(await jobParty(f.job_id, viewer.id)))) throw new AppError(403, 'Фото смены видят только её участники.');
  try {
    return { mime: f.mime, data: await fs.readFile(fileOf(id)), cache: f.kind === 'avatar' ? 'public, max-age=31536000, immutable' : 'private, max-age=3600' };
  } catch {
    throw new AppError(404, 'Файл не найден.');
  }
}

export async function addJobPhoto(num: number, kind: unknown, file: unknown, viewer: Pick<SessionUser, 'id'> | null) {
  if (!viewer) throw new AppError(401, 'Нужно войти в аккаунт.');
  if (kind !== 'before' && kind !== 'after') throw new AppError(422, 'Укажите: фото до или после работ.', 'kind');
  const j = await one<{ id: string; status: string; employer_id: string }>('SELECT id, status, employer_id FROM jobs WHERE num = $1', [num]);
  if (!j) throw new AppError(404, 'Заказ не найден.');
  if (!(await jobParty(j.id, viewer.id))) throw new AppError(403, 'Фото прикладывают только участники смены.');
  if (j.status === 'cancelled') throw new AppError(409, 'Смена отменена.');
  const n = (await one<{ n: number }>('SELECT count(*)::int AS n FROM photos WHERE job_id = $1 AND kind = $2', [j.id, kind]))!.n;
  if (n >= MAX_PHOTOS) throw new AppError(409, 'Не больше ' + MAX_PHOTOS + ' фото «' + (kind === 'before' ? 'до' : 'после') + '».');
  const fileId = await store(viewer.id, 'photo', file, j.id);
  await tx(async (db) => {
    await query('INSERT INTO photos (job_id, author_id, kind, url, file_id) VALUES ($1, $2, $3, $4, $5)', [j.id, viewer.id, kind, '/api/files/' + fileId, fileId], db);
    const hired = await query<{ freelancer_id: string }>('SELECT freelancer_id FROM hires WHERE job_id = $1', [j.id], db);
    await publish([j.employer_id, ...hired.rows.map(h => h.freelancer_id)], { t: 'job', num }, db);
  });
}

export async function deleteJobPhoto(num: number, photoId: string, viewer: Pick<SessionUser, 'id'> | null) {
  if (!viewer) throw new AppError(401, 'Нужно войти в аккаунт.');
  if (!UUID_RE.test(photoId)) throw new AppError(404, 'Фото не найдено.');
  const p = await one<{ author_id: string; file_id: string | null; status: string }>(
    'SELECT p.author_id, p.file_id, j.status FROM photos p JOIN jobs j ON j.id = p.job_id WHERE p.id = $1 AND j.num = $2', [photoId, num]);
  if (!p) throw new AppError(404, 'Фото не найдено.');
  if (p.author_id !== viewer.id) throw new AppError(403, 'Удалить фото может только тот, кто его приложил.');
  if (p.status === 'accepted') throw new AppError(409, 'Работа принята — фото остаются в истории смены.');
  await query('DELETE FROM photos WHERE id = $1', [photoId]);
  if (p.file_id) await removeFile(p.file_id);
}

export async function jobPhotos(jobId: string, viewerId: string, db: Db = pool()) {
  const r = await query<{ id: string; kind: 'before' | 'after'; url: string; author_id: string }>(
    'SELECT id, kind, url, author_id FROM photos WHERE job_id = $1 ORDER BY created_at', [jobId], db);
  return r.rows.map(p => ({ id: p.id, kind: p.kind, url: p.url, mine: p.author_id === viewerId }));
}
