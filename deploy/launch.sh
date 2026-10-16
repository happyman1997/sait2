#!/usr/bin/env bash
# Запуск и обновление сайта. Первый раз — после deploy/setup.sh и заполнения .env.production; потом — для
# обновления: cd /opt/arena && git pull && bash deploy/launch.sh. Повторный запуск безопасен.
# WWW=yes bash deploy/launch.sh — добавить www в сертификат, даже если сервер ещё не видит новую запись www.
# Проверяет настройки и домен, выпускает сертификат (один раз), собирает и запускает сайт, ставит в cron
# продление сертификата и ежедневную резервную копию.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=$(pwd)
ENV=.env.production
[ -f "$ENV" ] || { echo "Нет $ENV — сначала: bash deploy/setup.sh"; exit 1; }
get() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- || true; }
dc() { docker compose -f docker-compose.prod.yml --env-file "$ENV" "$@"; }
DOMAIN=$(get SERVER_NAME)
MAIL=$(get OPERATOR_EMAIL)

echo "== 1/5 Настройки"
miss=()
for k in OPERATOR_NAME OPERATOR_OGRNIP OPERATOR_INN OPERATOR_ADDRESS OPERATOR_EMAIL PROCESSOR_HOSTING PROCESSOR_MAIL SMTP_URL; do
  [ -n "$(get "$k")" ] || miss+=("$k")
done
case "$(get SMTP_URL)" in *ПАРОЛЬ*) miss+=("SMTP_URL (вместо слова ПАРОЛЬ — пароль приложения почты)");; esac
if [ ${#miss[@]} -gt 0 ]; then
  echo "Не заполнено в $ENV:"; printf '  - %s\n' "${miss[@]}"
  echo "Заполните: bash $DIR/deploy/configure.sh — и запустите этот скрипт снова."; exit 1
fi

echo "== 2/5 Домен $DOMAIN"
me=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
resolve() { getent ahostsv4 "$1" 2>/dev/null | awk 'NR == 1 {print $1}' || true; }
now=$(resolve "$DOMAIN")
if [ "$now" != "$me" ]; then
  echo "Домен $DOMAIN пока указывает на «${now:-никуда}», а этот сервер — $me."
  echo "Проверьте A-запись у регистратора домена: $DOMAIN → $me. Обновление занимает от минут до нескольких часов."
  exit 1
fi
www_ok=0
[ "$(resolve "www.$DOMAIN")" = "$me" ] && www_ok=1
# WWW=yes — не ждать, пока сервер «узнает» новую запись www (проверять её всё равно будет Let's Encrypt).
[ "${WWW:-}" = yes ] && www_ok=1
[ $www_ok = 1 ] || echo "Подсказка: www.$DOMAIN не указывает на этот сервер — добавьте A-запись www → $me и запустите скрипт снова, тогда адрес с www тоже заработает."
vol="$(basename "$DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')_certbot-www"

echo "== 3/5 Сертификат HTTPS"
cert="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
names=(-d "$DOMAIN"); [ $www_ok = 1 ] && names+=(-d "www.$DOMAIN")
reload=0
if [ ! -f "$cert" ]; then
  dc stop nginx >/dev/null 2>&1 || true   # порт 80 нужен certbot
  docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot \
    certonly --standalone "${names[@]}" -m "$MAIL" --agree-tos -n
elif [ $www_ok = 1 ] && ! openssl x509 -in "$cert" -noout -text | grep -q "DNS:www.$DOMAIN"; then
  echo "добавляю www.$DOMAIN в сертификат"
  if [ -n "$(dc ps -q nginx 2>/dev/null)" ]; then
    # Сайт работает — проверка через него, без остановки.
    docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v "$vol":/var/www/certbot certbot/certbot \
      certonly --webroot -w /var/www/certbot --expand "${names[@]}" -m "$MAIL" --agree-tos -n
    reload=1
  else
    docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot \
      certonly --standalone --expand "${names[@]}" -m "$MAIL" --agree-tos -n
  fi
else
  echo "уже есть"
fi

echo "== 4/5 Сборка и запуск — первый раз 5–15 минут"
dc up -d --build
app=$(dc ps -q app)
for _ in $(seq 1 60); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app" 2>/dev/null || echo "?")
  [ "$st" = healthy ] && break
  sleep 5
done
# nginx держит сертификат в памяти: после добавления www — перечитать.
[ $reload = 1 ] && dc exec -T nginx nginx -s reload
if [ "$st" != healthy ]; then
  echo "Сайт не запустился (состояние: $st). Последние строки журнала:"
  dc logs --tail 40 app
  exit 1
fi

echo "== 5/5 Ежедневные задачи: продление сертификата, резервная копия"
cat > /etc/cron.d/arena <<CRON
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 4 * * * root docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v $vol:/var/www/certbot certbot/certbot renew --webroot -w /var/www/certbot -q && cd $DIR && docker compose -f docker-compose.prod.yml --env-file $ENV exec -T nginx nginx -s reload
30 3 * * * root cd $DIR && sh deploy/backup.sh >> deploy/backups/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/arena

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/api/health" || true)
echo
if [ "$code" = 200 ]; then echo "Готово: https://$DOMAIN работает."; else echo "Сайт запущен, но https://$DOMAIN ответил кодом ${code:-нет ответа} — пришлите эти строки."; fi
