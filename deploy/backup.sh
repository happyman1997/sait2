#!/bin/sh
# Резервная копия базы: deploy/backups/arena-ГГГГММДД-ЧЧММ.dump, хранится 14 дней.
# В cron (ежедневно в 03:30):  30 3 * * * cd /opt/arena && sh deploy/backup.sh >> deploy/backups/backup.log 2>&1
# Восстановление:  docker compose -f docker-compose.prod.yml exec -T db pg_restore -U arena -d arena --clean --if-exists < deploy/backups/<файл>.dump
set -eu
cd "$(dirname "$0")/.."
mkdir -p deploy/backups
f="deploy/backups/arena-$(date +%Y%m%d-%H%M).dump"
docker compose -f docker-compose.prod.yml --env-file "${ENV_FILE:-.env.production}" exec -T db pg_dump -U arena -d arena -Fc > "$f"
[ -s "$f" ] || { echo "пустой дамп: $f" >&2; rm -f "$f"; exit 1; }
find deploy/backups -name 'arena-*.dump' -mtime +14 -delete
echo "ok $f $(du -h "$f" | cut -f1)"
