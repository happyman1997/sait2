#!/usr/bin/env bash
# Проверка безопасности сервера: обновления, файрвол, что открыто в интернет, вход по SSH, защита от подбора пароля,
# файл с паролями, резервные копии, сертификат и заголовки сайта, сотрудники поддержки.
# Ничего не меняет — только показывает и подсказывает, что сделать. Запуск: bash deploy/seccheck.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ENV=.env.production
[ "$(id -u)" = 0 ] || { echo "Запустите от root: sudo bash deploy/seccheck.sh"; exit 1; }
[ -f "$ENV" ] || { echo "Нет $ENV — сначала: bash deploy/setup.sh"; exit 1; }
get() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- || true; }
dc() { docker compose -f docker-compose.prod.yml --env-file "$ENV" "$@"; }
bad=0; warn=0
ok()  { echo "  ОК        $*"; }
wn()  { echo "  ВНИМАНИЕ  $*"; warn=$((warn + 1)); }
no()  { echo "  ПЛОХО     $*"; bad=$((bad + 1)); }
fix() { echo "            что сделать: $*"; }
domain=$(get SERVER_NAME)

echo "== 1/8 Обновления системы"
if systemctl is-enabled unattended-upgrades >/dev/null 2>&1; then ok "автообновления безопасности включены"
else no "автообновления выключены"; fix "apt-get install -y unattended-upgrades && systemctl enable --now unattended-upgrades"; fi
n=$(apt list --upgradable 2>/dev/null | grep -c -- '-security' || true)
if [ "${n:-0}" -gt 0 ]; then wn "ждут установки обновлений безопасности: $n"; fix "apt-get update && apt-get upgrade -y"
else ok "обновлений безопасности в очереди нет"; fi
[ -f /var/run/reboot-required ] && { wn "после обновлений нужна перезагрузка"; fix "reboot — сайт поднимется сам через 1–2 минуты"; }

echo "== 2/8 Файрвол"
if ufw status 2>/dev/null | grep -q "Status: active"; then
  extra=$(ufw status | awk '/ALLOW/ {print $1}' | grep -vE '^(22|80|443|80,443)(/tcp)?$|^OpenSSH$' | sort -u | tr '\n' ' ')
  if [ -n "$extra" ]; then wn "кроме SSH и сайта открыто: $extra"; fix "если это не нужно — ufw delete allow <порт>"
  else ok "включён: открыты только SSH и сайт (80, 443)"; fi
else no "файрвол выключен"; fix "ufw allow OpenSSH && ufw allow 80,443/tcp && ufw --force enable"; fi

echo "== 3/8 Что слушает интернет"
# Порты, открытые не только для самого сервера (127.0.0.1 и ::1 — внутренние).
ports=$(ss -tlnH 2>/dev/null | awk '{print $4}' | grep -vE '^(127\.|\[::1\]|::1|\[::ffff:127\.)' | sed -E 's/.*:([0-9]+)$/\1/' | sort -un)
ssh_port=$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2; exit}')
odd=""
for p in $ports; do case "$p" in 80|443|"${ssh_port:-22}") ;; *) odd="$odd $p";; esac; done
if [ -n "$odd" ]; then wn "открыты порты:$odd"; fix "посмотреть, какая программа их держит: ss -tlnp — лишнее остановить или закрыть"
else ok "наружу открыты только SSH (${ssh_port:-22}) и сайт (80, 443)"; fi
if docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E '0\.0\.0\.0:5432|:::5432' >/dev/null; then
  no "база данных открыта в интернет (порт 5432)"; fix "уберите ports у db в docker-compose.prod.yml и перезапустите: bash deploy/launch.sh"
else ok "база данных в интернет не открыта"; fi
others=$(awk -F: '$3 == 0 && $1 != "root" {print $1}' /etc/passwd | tr '\n' ' ')
[ -n "$others" ] && { no "есть другие пользователи с правами root: $others"; fix "если вы их не создавали — срочно напишите в поддержку хостинга"; }

echo "== 4/8 Вход по SSH"
cfg=$(sshd -T 2>/dev/null)
pa=$(awk '$1 == "passwordauthentication" {print $2}' <<<"$cfg")
keys=0; [ -s /root/.ssh/authorized_keys ] && keys=$(grep -cE '^(ssh-|ecdsa-|sk-)' /root/.ssh/authorized_keys || true)
if [ "$pa" = no ]; then ok "вход только по ключу (ключей у root: $keys)"
else
  wn "на сервер можно войти по паролю — его подбирают боты со всего интернета"
  fix "пароль root — длинный и случайный (от 16 символов); надёжнее — вход по ключу: DEPLOY.md, «Безопасность сервера»"
fi

echo "== 5/8 Защита от подбора пароля (fail2ban)"
if st=$(fail2ban-client status sshd 2>/dev/null); then
  cur=$(awk -F: '/Currently banned/ {gsub(/[ \t]/, "", $2); print $2}' <<<"$st")
  tot=$(awk -F: '/Total banned/ {gsub(/[ \t]/, "", $2); print $2}' <<<"$st")
  ok "работает: заблокировано адресов сейчас — ${cur:-0}, всего — ${tot:-0}"
else no "fail2ban не следит за SSH"; fix "apt-get install -y fail2ban && systemctl enable --now fail2ban"; fi
fails=$(journalctl -u ssh -u sshd --since "24 hours ago" 2>/dev/null | grep -cE 'Failed password|Invalid user' || true)
echo "            неудачных попыток входа по SSH за сутки: ${fails:-0} — обычный фон интернета, если пароль надёжный"

echo "== 6/8 Файл с паролями ($ENV)"
perm=$(stat -c %a "$ENV")
if [ "$perm" = 600 ]; then ok "читает только root"; else no "права $perm — файл могут читать другие"; fix "chmod 600 $(pwd)/$ENV"; fi
if git ls-files --error-unmatch "$ENV" >/dev/null 2>&1; then no "файл с паролями попал в git"; fix "напишите разработчику — его нужно убрать из репозитория и сменить пароли"
else ok "в git не попадает"; fi

echo "== 7/8 Резервные копии"
last=$(ls -t deploy/backups/arena-*.dump 2>/dev/null | head -1)
if [ -z "$last" ]; then no "копий базы нет"; fix "сделать сейчас: sh deploy/backup.sh; ежедневная — в /etc/cron.d/arena (её ставит deploy/launch.sh)"
else
  age=$(( ($(date +%s) - $(stat -c %Y "$last")) / 86400 ))
  if [ "$age" -gt 2 ]; then wn "последняя копия — $age дн. назад ($(basename "$last"))"; fix "проверьте журнал: tail deploy/backups/backup.log"
  else ok "последняя копия: $(basename "$last")"; fi
fi
if [ -n "$(get BACKUP_S3_BUCKET)$(get S3_BUCKET)" ]; then ok "копии уходят в хранилище — переживут потерю сервера"
else wn "копии только на этом сервере — пропадут вместе с ним"; fix "задайте BACKUP_S3_BUCKET (DEPLOY.md, «Резервные копии»)"; fi

echo "== 8/8 Сайт снаружи: сертификат, заголовки, сотрудники"
crt="/etc/letsencrypt/live/$domain/fullchain.pem"
if [ -n "$domain" ] && [ -f "$crt" ]; then
  days=$(( ($(date -d "$(openssl x509 -enddate -noout -in "$crt" | cut -d= -f2)" +%s) - $(date +%s)) / 86400 ))
  if [ "$days" -lt 14 ]; then no "сертификат истекает через $days дн."; fix "продление — в /etc/cron.d/arena; вручную: bash deploy/launch.sh"
  else ok "сертификат действует ещё $days дн."; fi
else wn "не найден сертификат $crt"; fi
h=$(curl -sI --max-time 10 --resolve "$domain:443:127.0.0.1" "https://$domain/" 2>/dev/null || true)
for hd in Strict-Transport-Security Content-Security-Policy X-Content-Type-Options; do
  grep -qi "^$hd:" <<<"$h" && ok "заголовок $hd есть" || wn "нет заголовка $hd"
done
staff=$(dc exec -T db psql -U arena -d arena -tAc "SELECT string_agg(login, ', ' ORDER BY login) FROM users WHERE is_staff" 2>/dev/null | tr -d '\r')
echo "            сотрудники поддержки (видят данные всех пользователей): ${staff:-нет}"
echo "            незнакомый логин — снять роль: docker compose -f docker-compose.prod.yml --env-file $ENV exec app node scripts/staff.mjs remove <логин>"

echo
if [ "$bad" -gt 0 ]; then echo "Итог: серьёзных проблем — $bad, замечаний — $warn. Начните с «ПЛОХО»."
elif [ "$warn" -gt 0 ]; then echo "Итог: серьёзных проблем нет, замечаний — $warn."
else echo "Итог: всё в порядке."; fi
