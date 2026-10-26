#!/usr/bin/env bash
# Резервные копии — ещё и в Яндекс Облако (Object Storage): тогда они переживут потерю сервера.
# Спрашивает бакет и статический ключ доступа, записывает их в .env.production вместе с обработчиком данных для
# политики, перезапускает сайт с новыми настройками и делает пробную копию. Повторный запуск безопасен.
#   bash /opt/arena/deploy/backup-setup.sh
# Как создать бакет и ключ — DEPLOY.md, раздел «Резервные копии».
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ENV=.env.production
[ "$(id -u)" = 0 ] || { echo "Запустите от root: sudo bash deploy/backup-setup.sh"; exit 1; }
[ -f "$ENV" ] || { echo "Нет $ENV — сначала: bash deploy/setup.sh"; exit 1; }
get() { grep -aE "^$1=" "$ENV" | tail -1 | cut -d= -f2- || true; }
# Замена строки KEY=… целиком (как в configure.sh); нет строки — добавляется в конец. Права файла сохраняются.
set_kv() {
  local tmp; tmp=$(mktemp)
  K="$1" V="$2" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next } { print }
    END { if (!done) print k "=" v }' "$ENV" > "$tmp"
  cat "$tmp" > "$ENV"; rm -f "$tmp"
}
trim() { printf '%s' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }
dc() { docker compose -f docker-compose.prod.yml --env-file "$ENV" "$@"; }

echo "Резервные копии в Яндекс Облако. Нужны имя бакета и статический ключ доступа сервисного аккаунта"
echo "(как получить — DEPLOY.md, «Резервные копии»). Enter — оставить прежнее (оно в скобках)."
echo

# ask КЛЮЧ "Вопрос" ПРОВЕРКА "Подсказка" [скрыть] — пока ответ не пройдёт проверку; Enter — прежнее, если оно есть.
ask() {
  local k=$1 q=$2 re=$3 hint=$4 hide=${5:-} cur v
  cur=$(get "$k")
  while :; do
    if [ -n "$hide" ]; then
      read -r -s -p "$q${cur:+ [задан — Enter оставит]}: " v || v=''; echo
    else
      read -r -p "$q${cur:+ [$cur]}: " v || v=''
    fi
    v=$(trim "$v")
    if [ -z "$v" ] && [ -n "$cur" ] && [[ "$cur" =~ $re ]]; then return 0; fi
    if [[ "$v" =~ $re ]]; then set_kv "$k" "$v"; return 0; fi
    echo "  $hint${hide:+ (введено символов: ${#v})}"
  done
}

ask BACKUP_S3_BUCKET "Имя бакета (латиница, цифры, дефис)" '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' \
  "Имя бакета — строчная латиница, цифры, точка и дефис, от 3 до 63 знаков. Как в консоли Яндекс Облака."
ask BACKUP_S3_ACCESS_KEY "Идентификатор ключа (обычно начинается с YCAJ)" '^[A-Za-z0-9_-]{16,64}$' \
  "Это не похоже на идентификатор ключа — скопируйте строку «Идентификатор ключа» ещё раз."
ask BACKUP_S3_SECRET_KEY "Секретный ключ (обычно начинается с YC; при вводе не виден)" '^[A-Za-z0-9_+/=-]{30,100}$' \
  "Это не похоже на секретный ключ — скопируйте строку «Ваш секретный ключ» ещё раз." hide
# Облако хранит копии базы с персональными данными по вашему поручению — оно должно быть в политике (обработчики).
[ -n "$(get PROCESSOR_STORAGE)" ] || echo "  Подсказка: у Yandex Cloud это обычно «ООО «Яндекс.Облако», ИНН 7704458262» — сверьте с вашим договором."
ask PROCESSOR_STORAGE "Кто хранит копии — название и ИНН из договора Yandex Cloud" '[0-9]{10}' \
  "Нужны название и ИНН из 10 цифр, например: ООО «Яндекс.Облако», ИНН 7704458262"

echo
echo "== Перезапуск сайта с новыми настройками"
dc up -d >/dev/null 2>&1 || { echo "Не удалось перезапустить — запустите: bash $(pwd)/deploy/launch.sh"; exit 1; }
app=$(dc ps -q app); st='?'
for _ in $(seq 1 40); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app" 2>/dev/null || echo "?")
  [ "$st" = healthy ] && break
  sleep 3
done
[ "$st" = healthy ] || { echo "Сайт не поднялся (состояние: $st) — запустите: bash $(pwd)/deploy/launch.sh"; exit 1; }
echo "  сайт работает"

echo "== Пробная копия"
if sh deploy/backup.sh; then
  echo
  echo "Готово: копии каждую ночь уходят в бакет $(get BACKUP_S3_BUCKET) и хранятся там 30 дней."
else
  echo
  echo "Копия на сервере сделана, а в хранилище — нет: причина в строке «[backup-upload]» выше."
  echo "Частые причины: опечатка в имени бакета; у сервисного аккаунта нет роли storage.editor; ключ скопирован не целиком."
  echo "Исправьте и запустите этот скрипт ещё раз."
  exit 1
fi
