#!/usr/bin/env bash
# Проверка почты сайта по шагам: связь с почтовым сервером, вход в ящик, тестовое письмо — и что делать, если не вышло.
# Запуск: bash deploy/mailcheck.sh ваш@адрес — на этот адрес придёт тестовое письмо (без адреса — только вход). Пароль не печатается.
set -uo pipefail
cd "$(dirname "$0")/.."
ENV=.env.production
[ -f "$ENV" ] || { echo "Нет $ENV — сначала: bash deploy/setup.sh"; exit 1; }
get() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- || true; }
dc() { docker compose -f docker-compose.prod.yml --env-file "$ENV" "$@"; }

to="${1:-}"
case "$to" in ''|[!@\ ]*@*.*) ;; *) echo "«$to» не похоже на адрес почты. Пример: bash deploy/mailcheck.sh ivan@mail.ru"; exit 1;; esac
url=$(get SMTP_URL)
[ -n "$url" ] || { echo "Почта не настроена — запустите: bash $(pwd)/deploy/configure.sh"; exit 1; }
hp=${url##*@}; hp=${hp%%/*}; hp=${hp%%\?*}
host=${hp%%:*}; port=${hp##*:}
if [ "$port" = "$hp" ]; then case "$url" in smtps:*) port=465;; *) port=587;; esac; fi
me=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')

echo "== 1/2 Связь с почтовым сервером $host:$port"
if timeout 10 bash -c ": > /dev/tcp/$host/$port" 2>/dev/null; then
  echo "  есть"
else
  echo "  НЕТ — за 10 секунд подключиться не удалось."
  echo
  echo "Что сделать: похоже, хостинг закрывает исходящую почту. Напишите в поддержку хостинга:"
  echo "  «Прошу открыть исходящие соединения на порт $port к $host для сервера ${me:-<IP сервера>} —"
  echo "   сайт отправляет письма с кодами подтверждения через свою почту.»"
  exit 1
fi

echo "== 2/2 Вход в ящик${to:+ и тестовое письмо}"
# Отдельный временный контейнер, а не работающий сайт: он читает $ENV заново — проверяются текущие настройки,
# даже если сайт ещё не перезапущен после configure.sh. Пароль не попадает в командную строку.
if ! dc run --rm --no-deps -T app test -f scripts/mailcheck.mjs >/dev/null 2>&1; then
  echo "Сайт ещё старой версии — сначала обновите: cd $(pwd) && bash deploy/launch.sh"
  exit 1
fi
dc run --rm --no-deps -T -e SERVER_IP="$me" -e APP_DIR="$(pwd)" app node scripts/mailcheck.mjs "$to"
