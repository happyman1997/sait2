#!/usr/bin/env bash
# Первая подготовка сервера (Ubuntu 22.04/24.04, под root). Повторный запуск безопасен.
#   apt-get update && apt-get install -y git && git clone https://github.com/happyman1997/sait2.git /opt/arena
#   bash /opt/arena/deploy/setup.sh
# Ставит Docker, открывает в файрволе только SSH, 80 и 443, включает автообновления безопасности и защиту от
# перебора паролей SSH, создаёт .env.production с готовыми паролями и ключами. Дальше — заполнить .env.production
# и запустить deploy/launch.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN=${1:-arenarabot.ru}
ENV=.env.production

[ "$(id -u)" = 0 ] || { echo "Нужны права root: sudo bash deploy/setup.sh"; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "ВНИМАНИЕ: скрипт проверен на Ubuntu, у вас ${PRETTY_NAME:-неизвестная система}"

echo "== 1/4 Программы (Docker, файрвол, автообновления) — несколько минут"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 git openssl ufw fail2ban unattended-upgrades cron curl
# BuildKit для сборки образа; в старых выпусках Ubuntu пакета может не быть — тогда он уже внутри docker.io.
apt-get install -y -q docker-buildx >/dev/null 2>&1 || true
# Образы с Docker Hub — через зеркало Google (если зеркало недоступно, Docker сам идёт на Docker Hub).
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  printf '{\n  "registry-mirrors": ["https://mirror.gcr.io"],\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "20m", "max-file": "5" }\n}\n' > /etc/docker/daemon.json
fi
systemctl enable --now docker >/dev/null
systemctl restart docker
systemctl enable --now fail2ban unattended-upgrades cron >/dev/null 2>&1 || true

echo "== 2/4 Файрвол: открыты только SSH, 80 и 443"
ufw allow OpenSSH >/dev/null
ufw allow 80,443/tcp >/dev/null
ufw --force enable >/dev/null

echo "== 3/4 Файл настроек $ENV"
set_kv() { sed -i "s|^$1=.*|$1=$2|" "$ENV"; }
b64url() { base64 -w0 | tr -d '=' | tr '/+' '_-'; }
if [ -f "$ENV" ]; then
  echo "уже есть — не трогаю"
else
  cp .env.production.example "$ENV"
  set_kv SERVER_NAME "$DOMAIN"
  set_kv PUBLIC_URL "https://$DOMAIN"
  set_kv POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_kv AUTH_CODE_SECRET "$(openssl rand -hex 32)"
  set_kv METRICS_TOKEN "$(openssl rand -hex 24)"
  # Ключи VAPID для пуш-уведомлений в браузер: пара P-256 в формате web-push (base64url).
  key=$(mktemp)
  openssl ecparam -name prime256v1 -genkey -noout -out "$key"
  set_kv VAPID_PRIVATE_KEY "$(openssl ec -in "$key" -outform DER 2>/dev/null | tail -c +8 | head -c 32 | b64url)"
  set_kv VAPID_PUBLIC_KEY "$(openssl ec -in "$key" -pubout -outform DER 2>/dev/null | tail -c 65 | b64url)"
  rm -f "$key"
  echo "создан: пароль базы, ключ кодов, ключи пуш-уведомлений и токен метрик уже вписаны"
fi
chmod 600 "$ENV"

echo "== 4/4 Готово"
ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
cat <<MSG

Сервер подготовлен (IP ${ip:-?}). Дальше:
  1. Заполните настройки:   nano $(pwd)/$ENV
     (реквизиты ИП, почта SMTP, обработчики данных; сохранить — Ctrl+O, Enter, выйти — Ctrl+X)
  2. Когда домен $DOMAIN укажет на этот сервер, запустите сайт:   bash $(pwd)/deploy/launch.sh
MSG
