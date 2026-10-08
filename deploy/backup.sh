#!/bin/sh
# Резервная копия: база (deploy/backups/arena-ГГГГММДД-ЧЧММ.dump) и, если фото хранятся на сервере, а не в S3,
# архив фото (uploads-ГГГГММДД-ЧЧММ.tar.gz). На сервере копии хранятся 14 дней. Каждая копия сразу уходит
# в объектное хранилище (BACKUP_S3_BUCKET или S3_BUCKET, папка backups/, 30 дней) — переживёт потерю сервера.
# В cron (ежедневно в 03:30):  30 3 * * * cd /opt/arena && sh deploy/backup.sh >> deploy/backups/backup.log 2>&1
# Восстановление — DEPLOY.md, раздел «Резервные копии».
set -eu
cd "$(dirname "$0")/.."
mkdir -p deploy/backups
dc() { docker compose -f docker-compose.prod.yml --env-file "${ENV_FILE:-.env.production}" "$@"; }
stamp=$(date +%Y%m%d-%H%M)

# В хранилище; код 3 — хранилище не настроено (предупреждаем, но копия на сервере есть).
offsite() {
  rc=0
  dc exec -T app node scripts/backup-upload.mjs "$(basename "$1")" < "$1" || rc=$?
  if [ "$rc" = 3 ]; then echo "ВНИМАНИЕ: копия только на сервере — задайте BACKUP_S3_BUCKET (DEPLOY.md)" >&2
  elif [ "$rc" != 0 ]; then echo "ОШИБКА: копия $1 не ушла в хранилище" >&2; failed=1; fi
}
failed=0

f="deploy/backups/arena-$stamp.dump"
dc exec -T db pg_dump -U arena -d arena -Fc > "$f"
[ -s "$f" ] || { echo "пустой дамп: $f" >&2; rm -f "$f"; exit 1; }
echo "ok $f $(du -h "$f" | cut -f1)"
offsite "$f"

u="deploy/backups/uploads-$stamp.tar.gz"
dc exec -T app sh -c 'cd /app/data && [ -n "$(ls -A uploads 2>/dev/null)" ] && tar -czf - uploads || true' > "$u"
if [ -s "$u" ]; then echo "ok $u $(du -h "$u" | cut -f1)"; offsite "$u"; else rm -f "$u"; fi

find deploy/backups \( -name 'arena-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +14 -delete
exit "$failed"
