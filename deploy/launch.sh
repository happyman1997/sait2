#!/usr/bin/env bash
# Запуск и обновление сайта. Первый раз — после deploy/setup.sh и заполнения .env.production; потом — для
# обновления: cd /opt/arena && git pull && bash deploy/launch.sh. Повторный запуск безопасен.
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

echo "== 1/5 Настройки (версия $(git log -1 --format=%h 2>/dev/null || echo ?))"
miss=()
for k in OPERATOR_NAME OPERATOR_OGRNIP OPERATOR_INN OPERATOR_ADDRESS OPERATOR_EMAIL PROCESSOR_HOSTING PROCESSOR_MAIL SMTP_URL; do
  [ -n "$(get "$k")" ] || miss+=("$k")
done
case "$(get SMTP_URL)" in *ПАРОЛЬ*) miss+=("SMTP_URL (вместо слова ПАРОЛЬ — пароль приложения почты)");; esac
if [ ${#miss[@]} -gt 0 ]; then
  echo "Не заполнено в $ENV:"; printf '  - %s\n' "${miss[@]}"
  echo "Заполните: bash $DIR/deploy/configure.sh — и запустите этот скрипт снова."; exit 1
fi
# Карта раньше по умолчанию грузилась браузером напрямую с OpenFreeMap (за рубежом) — теперь через свой nginx.
if grep -qE '^NEXT_PUBLIC_MAP_STYLE_URL=https://tiles\.openfreemap\.org/styles/liberty$' "$ENV"; then
  sed -i 's#^NEXT_PUBLIC_MAP_STYLE_URL=https://tiles\.openfreemap\.org/styles/liberty$#NEXT_PUBLIC_MAP_STYLE_URL=/ofm/styles/liberty#' "$ENV"
  echo "Карта: теперь через ваш сервер (/ofm/…) — браузер посетителя не обращается к зарубежным серверам."
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
vol="$(basename "$DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')_certbot-www"

echo "== 3/5 Сертификат HTTPS"
cert="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
# Без конвейера с grep -q: при pipefail ранний выход grep мог бы дать ложный ответ.
has_www() { case "$(openssl x509 -in "$cert" -noout -text 2>/dev/null || true)" in *"DNS:www.$DOMAIN"*) return 0;; esac; return 1; }
reload=0
if [ ! -f "$cert" ]; then
  names=(-d "$DOMAIN"); [ $www_ok = 1 ] && names+=(-d "www.$DOMAIN")
  dc stop nginx >/dev/null 2>&1 || true   # порт 80 нужен certbot
  docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot \
    certonly --standalone "${names[@]}" -m "$MAIL" --agree-tos -n
elif has_www; then
  echo "уже есть, вместе с www.$DOMAIN"
else
  # Пробуем всегда, даже если сервер ещё не видит запись www (его DNS-кэш может отставать на часы):
  # решает Let's Encrypt. Не вышло — сайт без www работает дальше, скрипт не прерывается.
  echo "добавляю www.$DOMAIN в сертификат"
  ok=0
  if [ -n "$(dc ps -q nginx 2>/dev/null)" ]; then
    # Сайт работает — проверка через него, без остановки.
    docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v "$vol":/var/www/certbot certbot/certbot \
      certonly --webroot -w /var/www/certbot --expand -d "$DOMAIN" -d "www.$DOMAIN" -m "$MAIL" --agree-tos -n && ok=1 && reload=1
  else
    docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot \
      certonly --standalone --expand -d "$DOMAIN" -d "www.$DOMAIN" -m "$MAIL" --agree-tos -n && ok=1
  fi
  [ $ok = 1 ] || echo "www.$DOMAIN пока не добавлен — причина в строках выше (обычно запись www ещё не разошлась). Продолжаю без него."
fi

echo "== 4/5 Сборка и запуск — первый раз 5–15 минут"
dc up -d --build
app=$(dc ps -q app)
for _ in $(seq 1 60); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app" 2>/dev/null || echo "?")
  [ "$st" = healthy ] && break
  sleep 5
done
# Настройки nginx — файл, смонтированный в контейнер: после git pull контейнер видит старый файл. Изменился — пересоздаём.
if [ -n "$(dc ps -q nginx 2>/dev/null)" ] && ! dc exec -T nginx cat /etc/nginx/templates/default.conf.template 2>/dev/null | cmp -s - deploy/nginx.conf.template; then
  echo "обновляю настройки nginx"
  dc up -d --force-recreate --no-deps nginx
  sleep 3
  reload=0
fi
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
# www — напрямую в свой nginx, мимо DNS сервера: проверяется сам сертификат.
wcode=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "www.$DOMAIN:443:127.0.0.1" "https://www.$DOMAIN/" || true)
echo
if [ "$code" = 200 ]; then echo "Готово: https://$DOMAIN работает."; else echo "Сайт запущен, но https://$DOMAIN ответил кодом ${code:-нет ответа} — пришлите эти строки."; fi
if [ "$wcode" = 301 ]; then echo "Адрес с www тоже работает: https://www.$DOMAIN ведёт на https://$DOMAIN."
else echo "Адрес с www пока НЕ работает (в сертификате нет www.$DOMAIN). Проверьте A-запись www → $me у регистратора; через 1–2 часа запустите снова: cd $DIR && bash deploy/launch.sh"; fi

# Карта через свой сервер: nginx берёт стиль у OpenFreeMap и отдаёт со своими адресами.
style=$(get NEXT_PUBLIC_MAP_STYLE_URL)
case "${style:-/ofm/styles/liberty}" in
  /ofm/*)
    m=$(curl -s --max-time 20 "https://$DOMAIN${style:-/ofm/styles/liberty}" || true)
    if printf '%s' "$m" | grep -q "https://$DOMAIN/ofm/"; then echo "Карта: работает через ваш сервер."
    else echo "Карта: сервер не получил карту от OpenFreeMap — посетители увидят метки без подложки. Пришлите эти строки."; fi;;
  /map/*) echo "Карта: свой файл тайлов (/map/)." ;;
  *) echo "Карта: грузится браузером напрямую с $style — зарубежный сервер. Уберите строку NEXT_PUBLIC_MAP_STYLE_URL из $ENV и запустите скрипт снова." ;;
esac
# Поиск адреса: один пробный запрос через сайт.
g=$(curl -s --max-time 20 "https://$DOMAIN/api/geo/search?q=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0%2C%20%D0%A2%D0%B2%D0%B5%D1%80%D1%81%D0%BA%D0%B0%D1%8F%2C%201" || true)
if printf '%s' "$g" | grep -q '"lat"'; then echo "Поиск адреса: работает."
elif [ -z "$(get DADATA_API_KEY)" ]; then echo "Поиск адреса: не подключён — добавьте ключ DaData: bash $DIR/deploy/configure.sh, затем снова этот скрипт."
else echo "Поиск адреса: DaData не ответил или не принял ключ. Проверьте ключ (bash $DIR/deploy/configure.sh) и пришлите строки ниже:"; dc logs --tail 200 app 2>/dev/null | grep '\[geo\]' | tail -3 || true; fi
