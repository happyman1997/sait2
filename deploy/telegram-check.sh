#!/usr/bin/env bash
# Telegram-канал сводки заказов: верный ли ключ бота и может ли бот публиковать — те же запросы, что делает сайт.
# Одна строка итога (при ошибке — и что сделать). Вызывают deploy/configure.sh и deploy/launch.sh; можно и самому:
#   bash /opt/arena/deploy/telegram-check.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ENV=.env.production
get() { grep -aE "^$1=" "$ENV" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
ch=$(get TELEGRAM_CHANNEL)
tok=$(get TELEGRAM_BOT_TOKEN)
if [ -z "$ch" ] || [ -z "$tok" ]; then
  echo "Telegram-канал: не подключён (по желанию — DEPLOY.md, раздел 15)."
  exit 0
fi
api="https://api.telegram.org/bot$tok"
me=$(curl -s --max-time 10 "$api/getMe" 2>/dev/null || true)
bot_id=$(printf '%s' "$me" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2 || true)
bot=$(printf '%s' "$me" | grep -o '"username":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
if [ -z "$me" ]; then
  echo "Telegram-канал: сервер не достучался до Telegram (api.telegram.org) — сводка не выйдет. Проверьте позже; не пройдёт — напишите в поддержку хостинга."
  exit 1
fi
if [ -z "$bot_id" ]; then
  echo "Telegram-канал: Telegram не принял ключ бота. Скопируйте его у @BotFather ещё раз (команда /token) и введите в bash $(pwd)/deploy/configure.sh."
  exit 1
fi
member=$(curl -s --max-time 10 -G --data-urlencode "chat_id=$ch" --data-urlencode "user_id=$bot_id" "$api/getChatMember" 2>/dev/null || true)
if printf '%s' "$member" | grep -q '"status":"administrator"' && printf '%s' "$member" | grep -q '"can_post_messages":true'; then
  city=$(get TELEGRAM_DIGEST_CITY)
  hour=$(get TELEGRAM_DIGEST_HOUR)
  where='все города'; [ -n "$city" ] && where="$city и 50 км вокруг"
  echo "Telegram-канал: бот @$bot публикует в $ch — сводка заказов каждый день в ${hour:-19}:00 по Москве, $where."
else
  echo "Telegram-канал: бот @$bot не может публиковать в $ch."
  echo "  Откройте канал → «Управление каналом» → «Администраторы» → «Добавить администратора» → найдите @$bot и включите «Публикация сообщений»."
  echo "  Если адрес канала с опечаткой — исправьте его в bash $(pwd)/deploy/configure.sh."
  exit 1
fi
