// Копия базы (и файлов) — в объектное хранилище, чтобы она пережила потерю сервера.
// Запускается из deploy/backup.sh внутри контейнера приложения: файл приходит на stdin.
//   docker compose exec -T app node scripts/backup-upload.mjs arena-20261008-0330.dump < файл
// Хранилище: BACKUP_S3_BUCKET (лучше отдельный бакет со своим ключом — тогда взлом сайта не сотрёт копии),
// иначе бакет файлов сайта S3_BUCKET, папка backups/. Копии старше BACKUP_KEEP_DAYS (30) удаляются.
// Код выхода 3 — хранилище не настроено (копия осталась только на сервере).
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const PREFIX = 'backups/';
const env = (name: string, fallback = '') => process.env[name]?.trim() || fallback;

async function main() {
  const name = process.argv[2] || '';
  if (!/^[\w.-]{1,100}$/.test(name)) throw new Error('имя копии: латиница, цифры, точка, дефис');
  const bucket = env('BACKUP_S3_BUCKET', env('S3_BUCKET'));
  if (!bucket) {
    console.error('Хранилище для копий не настроено (BACKUP_S3_BUCKET или S3_BUCKET) — копия осталась только на сервере.');
    process.exit(3);
  }
  const s3 = new S3Client({
    endpoint: env('BACKUP_S3_ENDPOINT', env('S3_ENDPOINT', 'https://storage.yandexcloud.net')),
    region: env('BACKUP_S3_REGION', env('S3_REGION', 'ru-central1')),
    forcePathStyle: true,
    credentials: {
      accessKeyId: env('BACKUP_S3_ACCESS_KEY', env('S3_ACCESS_KEY')),
      secretAccessKey: env('BACKUP_S3_SECRET_KEY', env('S3_SECRET_KEY'))
    }
  });

  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  if (!body.length) throw new Error('пустой файл на входе');
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: PREFIX + name, Body: body, ContentType: 'application/octet-stream' }));

  const keep = Math.max(1, parseInt(env('BACKUP_KEEP_DAYS', '30'), 10) || 30);
  const edge = Date.now() - keep * 86400_000;
  const old: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token }));
    for (const o of r.Contents || []) if (o.Key && o.LastModified && o.LastModified.getTime() < edge) old.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  for (let i = 0; i < old.length; i += 1000) {
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: old.slice(i, i + 1000).map(Key => ({ Key })) } }));
  }
  console.log(`в хранилище: ${bucket}/${PREFIX}${name} (${(body.length / 1048576).toFixed(1)} МБ)${old.length ? `, удалено старых: ${old.length}` : ''}`);
}

main().catch(e => {
  console.error('[backup-upload]', (e as Error).message);
  process.exit(1);
});
