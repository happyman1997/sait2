// Хранилище загруженных файлов: локальная папка (UPLOAD_DIR) или S3-совместимое объектное хранилище
// (Yandex Object Storage, VK Cloud, Selectel, MinIO) — для нескольких инстансов приложения.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from './config';

export interface Storage {
  put(id: string, data: Uint8Array, mime: string): Promise<void>;
  get(id: string): Promise<Uint8Array | null>;
  remove(id: string): Promise<void>;
  /** Файлы старше суток — для уборки сирот (id без записи в БД). */
  listOld(olderThanMs: number): Promise<string[]>;
}

class LocalStorage implements Storage {
  private dir = () => path.resolve(config.uploadDir());
  private file = (id: string) => path.join(this.dir(), id);
  async put(id: string, data: Uint8Array) {
    await fs.mkdir(this.dir(), { recursive: true });
    await fs.writeFile(this.file(id), data);
  }
  async get(id: string) {
    try { return new Uint8Array(await fs.readFile(this.file(id))); } catch { return null; }
  }
  async remove(id: string) { await fs.rm(this.file(id), { force: true }); }
  async listOld(olderThanMs: number) {
    let names: string[];
    try { names = await fs.readdir(this.dir()); } catch { return []; }
    const edge = Date.now() - olderThanMs, out: string[] = [];
    for (const n of names) {
      const st = await fs.stat(this.file(n)).catch(() => null);
      if (st?.isFile() && st.mtimeMs < edge) out.push(n);
    }
    return out;
  }
}

class S3Storage implements Storage {
  private s3 = new S3Client({
    endpoint: config.s3Endpoint(), region: config.s3Region(), forcePathStyle: true,
    credentials: { accessKeyId: config.s3AccessKey(), secretAccessKey: config.s3SecretKey() }
  });
  private bucket = config.s3Bucket();
  private key = (id: string) => 'uploads/' + id;
  async put(id: string, data: Uint8Array, mime: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(id), Body: data, ContentType: mime }));
  }
  async get(id: string) {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(id) }));
      return r.Body ? await r.Body.transformToByteArray() : null;
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }
  async remove(id: string) { await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(id) })); }
  async listOld(olderThanMs: number) {
    const edge = Date.now() - olderThanMs, out: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: 'uploads/', ContinuationToken: token }));
      for (const o of r.Contents || []) if (o.Key && o.LastModified && o.LastModified.getTime() < edge) out.push(o.Key.slice('uploads/'.length));
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token && out.length < 10_000);
    return out;
  }
}

let storage: Storage | null = null;
export function getStorage(): Storage {
  if (!storage) storage = config.s3Bucket() ? new S3Storage() : new LocalStorage();
  return storage;
}
export function setStorage(s: Storage | null) { storage = s; }
