#!/usr/bin/env bash
# Ежедневная сводка владельцу на почту: что было на площадке за сутки и что требует внимания (server/digest.ts).
# Сервер добавляет свои проверки: резервная копия, место на диске, сертификат, ответ сайта, обновления системы.
#   Отправить сейчас:          bash /opt/arena/deploy/digest.sh
#   Показать, не отправляя:    bash /opt/arena/deploy/digest.sh --print
# Cron (ставит deploy/launch.sh) запускает его каждый час с --cron: письмо уходит один раз — в 9 утра по времени
# площадки (APP_TIME_ZONE, по умолчанию московское; другой час — DIGEST_HOUR=08). Кому — DIGEST_EMAIL, иначе
# OPERATOR_EMAIL; DIGEST_EMAIL=off — не присылать.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ENV=.env.production
[ -f "$ENV" ] || { echo "Нет $ENV — сначала: bash deploy/setup.sh"; exit 1; }
get() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- || true; }
dc() { docker compose -f docker-compose.prod.yml --env-file "$ENV" "$@"; }

if [ "${1:-}" = --cron ]; then
  shift
  [ "$(get DIGEST_EMAIL)" = off ] && exit 0
  tz=$(get APP_TIME_ZONE); hour=$(get DIGEST_HOUR)
  [[ "$hour" =~ ^[0-9]{1,2}$ ]] || hour=9
  [ "$(TZ=${tz:-Europe/Moscow} date +%-H)" = "$((10#$hour))" ] || exit 0
fi
domain=$(get SERVER_NAME)

facts() {
  echo "dir=$(pwd)"
  df -Pk / | awk 'NR == 2 { sub("%", "", $5); print "disk_used=" $5; print "disk_avail_kb=" $4 }'
  last=$(ls -t deploy/backups/arena-*.dump 2>/dev/null | head -1)
  if [ -n "$last" ]; then
    echo "backup_last=$(basename "$last")"
    echo "backup_age_h=$(( ($(date +%s) - $(stat -c %Y "$last")) / 3600 ))"
    echo "backup_size=$(du -h "$last" | cut -f1)"
  fi
  if [ -n "$(get BACKUP_S3_BUCKET)$(get S3_BUCKET)" ]; then echo "backup_offsite=1"; else echo "backup_offsite=0"; fi
  # Ошибки последнего запуска deploy/backup.sh — строки журнала после его заголовка «== …».
  # Без grep -i: в cron локаль C, и он не сравнивает русские буквы без учёта регистра.
  log=deploy/backups/backup.log
  if [ -f "$log" ] && grep -q '^== ' "$log"; then
    tail -n 80 "$log" | awk '/^== / { buf = ""; next } { buf = buf $0 "\n" } END { printf "%s", buf }' \
      | grep -E 'ОШИБК|[Оо]шибк|[Ee]rror|ERROR|[Ff]atal|FATAL|[Пп]устой|[Ff]ailed' | grep -v 'копия только на сервере' | head -5 | sed 's/^/backup_err=/'
  fi
  crt="/etc/letsencrypt/live/$domain/fullchain.pem"
  if [ -n "$domain" ] && [ -f "$crt" ]; then
    end=$(openssl x509 -enddate -noout -in "$crt" | cut -d= -f2)
    echo "cert_days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))"
  fi
  if [ -f deploy/site-off/on ]; then echo "site_off=1"
  else echo "health=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$domain:443:127.0.0.1" "https://$domain/api/health")"; fi
  echo "updates=$(apt list --upgradable 2>/dev/null | grep -c -- '-security')"
  if [ -f /var/run/reboot-required ]; then echo "reboot=1"; fi
}

facts | dc exec -T app node scripts/digest.mjs "$@"
