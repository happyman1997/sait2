#!/usr/bin/env bash
# Сводка владельцу по запросу: что было на площадке и что требует внимания (server/digest.ts).
# Сервер добавляет свои проверки: резервная копия, место на диске, сертификат, ответ сайта, обновления системы.
#   За сутки, на экран:        bash /opt/arena/deploy/digest.sh
#   За 7 дней:                 bash /opt/arena/deploy/digest.sh 7
#   И ещё письмом себе:        bash /opt/arena/deploy/digest.sh --mail   (на OPERATOR_EMAIL или DIGEST_EMAIL)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ENV=.env.production
[ -f "$ENV" ] || { echo "Нет $ENV — сначала: bash deploy/setup.sh"; exit 1; }
get() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- || true; }
dc() { docker compose -f docker-compose.prod.yml --env-file "$ENV" "$@"; }
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

[ -n "$(dc ps -q app 2>/dev/null)" ] || { echo "Сайт не запущен — сводку не собрать. Запустите: cd $(pwd) && bash deploy/launch.sh"; exit 1; }
facts | dc exec -T app node scripts/digest.mjs "$@"
