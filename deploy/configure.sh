#!/usr/bin/env bash
# Заполнение .env.production вопросами: реквизиты ИП, почта для писем с кодами, обработчики данных, ключ поиска адреса.
#   bash /opt/arena/deploy/configure.sh
# Повторный запуск безопасен: Enter оставляет прежнее значение (оно показано в скобках).
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=.env.production
[ -f "$ENV" ] || { echo "Нет $ENV — сначала: bash deploy/setup.sh"; exit 1; }
DOMAIN=$(grep -E '^SERVER_NAME=' "$ENV" | tail -1 | cut -d= -f2- || true)
DOMAIN=${DOMAIN:-arenarabot.ru}

get() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- || true; }
# Замена строки KEY=… целиком (значение — любой текст в одну строку); повторы строки убираются,
# нет строки — добавляется в конец.
set_kv() {
  local tmp; tmp=$(mktemp)
  K="$1" V="$2" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next } { print }
    END { if (!done) print k "=" v }' "$ENV" > "$tmp"
  cat "$tmp" > "$ENV"; rm -f "$tmp"
}
# Повторы строк (вставили новую, не удалив старую): остаётся последняя — её же видит Docker.
dedupe() {
  local tmp; tmp=$(mktemp)
  awk '{ line[NR] = $0; key[NR] = "" }
    /^[A-Za-z_][A-Za-z0-9_]*=/ { k = $0; sub(/=.*/, "", k); key[NR] = k; last[k] = NR }
    END { for (i = 1; i <= NR; i++) if (key[i] == "" || last[key[i]] == i) print line[i] }' "$ENV" > "$tmp"
  cat "$tmp" > "$ENV"; rm -f "$tmp"
}
trim() { printf '%s' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }
# Для логина и пароля в адресе почтового сервера: всё, кроме латиницы, цифр и ._~-, — в %XX.
urlenc() { local s=$1 out='' c i; for ((i = 0; i < ${#s}; i++)); do c=${s:i:1}; case $c in [a-zA-Z0-9._~-]) out+=$c;; *) out+=$(printf '%%%02X' "'$c");; esac; done; printf '%s' "$out"; }

# ask КЛЮЧ "Вопрос" ПРОВЕРКА "Подсказка при ошибке" — спрашивает, пока ответ не пройдёт проверку (или Enter).
ask() {
  local k=$1 q=$2 re=${3:-} bad=${4:-} cur v
  cur=$(get "$k")
  while :; do
    read -r -p "$q${cur:+ [$cur]}: " v || v=''
    v=$(trim "$v")
    [ -z "$v" ] && return 0
    if [[ "$v" == *'#'* || "$v" == *'$'* ]]; then echo "  Символы # и \$ нельзя — введите без них."; continue; fi
    if [ -n "$re" ] && ! [[ "$v" =~ $re ]]; then echo "  $bad"; continue; fi
    set_kv "$k" "$v"; return 0
  done
}

dedupe
echo "Заполняем $ENV. Enter — оставить как есть (текущее значение — в квадратных скобках)."
echo
echo "── Ваши данные (попадут в оферту и политику на сайте)"
ask OPERATOR_NAME    "ФИО полностью, без «ИП» (Петров Пётр Петрович)" '^[^0-9]{5,}$' "Похоже, это не ФИО — фамилия, имя и отчество словами."
[ "$(get OPERATOR_NAME)" = "Иванов Иван Иванович" ] && echo "  ВНИМАНИЕ: осталось имя из примера — запустите скрипт ещё раз и впишите своё."
ask OPERATOR_OGRNIP  "ОГРНИП (15 цифр)" '^[0-9]{15}$' "ОГРНИП — ровно 15 цифр, без пробелов."
ask OPERATOR_INN     "ИНН (12 цифр)" '^[0-9]{12}$' "ИНН физлица и ИП — ровно 12 цифр, без пробелов."
ask OPERATOR_ADDRESS "Почтовый адрес с индексом, например «101000, Москва, а/я 123» — ВИДЕН ВСЕМ на сайте" '(^|[^0-9])[0-9]{6}([^0-9]|$).*[^0-9 ,.]' "Нужен полный почтовый адрес: индекс из 6 цифр, город, улица и дом (или а/я). Пример: 101000, Москва, а/я 123"
echo
echo "── Кто хранит и передаёт данные по вашему поручению (из их договоров-оферт)"
ask PROCESSOR_HOSTING "Хостинг: название и ИНН (ООО «Хостинг», ИНН 7700000000)" '[0-9]{10}' "Нужны название и ИНН из 10 цифр."
ask PROCESSOR_MAIL    "Почтовый сервис: название и ИНН (из оферты Яндекс 360)" '[0-9]{10}' "Нужны название и ИНН из 10 цифр."
echo
echo "── Почта, с которой сайт отправляет письма с кодами"
# Почта уже настроена — по умолчанию её ящик; иначе info@ (один платный ящик, support@ и privacy@ — его алиасы).
cur_from=info@$DOMAIN
[[ "$(get SMTP_URL)" == *ПАРОЛЬ* || -z "$(get SMTP_URL)" ]] || cur_from=$(get EMAIL_FROM | sed -n 's/.*<\(.*\)>.*/\1/p')
read -r -p "Ящик [${cur_from:-info@$DOMAIN}]: " box || box=''
box=$(trim "${box:-${cur_from:-info@$DOMAIN}}")
if ! [[ "$box" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then echo "  Это не адрес почты — запустите скрипт ещё раз."; exit 1; fi
set_kv EMAIL_FROM "Арена Работы <$box>"
# Пароль приложения Яндекса — 16 латинских букв. Пробелы (если скопировался группами) убираем; другое — переспрашиваем:
# частая причина «Invalid user or password» — вставилось не то. Тот же ввод второй раз принимается как есть.
bad=''
while :; do
  read -r -s -p "Пароль приложения для $box (16 латинских букв; при вводе не виден; Enter — оставить прежний): " pw || pw=''
  echo
  pw=${pw//[[:space:]]/}
  [ -z "$pw" ] || [[ "$pw" =~ ^[a-zA-Z0-9]{16}$ ]] || [ "$pw" = "$bad" ] && break
  bad=$pw
  echo "  Введено символов: ${#pw}, а пароль приложения Яндекса — 16 латинских букв. Скопируйте его ещё раз и вставьте."
  echo "  (Если он точно такой — вставьте тот же ещё раз.)"
done
if [ -n "$pw" ]; then
  set_kv SMTP_URL "smtps://$(urlenc "$box"):$(urlenc "$pw")@smtp.yandex.ru:465"
  set_kv EMAIL_PROVIDER smtp
elif [[ "$(get SMTP_URL)" == *ПАРОЛЬ* ]]; then
  echo "  Пароль приложения не задан — без него письма с кодами не уйдут. Запустите скрипт ещё раз, когда он будет."
fi
ask SUPPORT_EMAIL  "Адрес для жалоб пользователей [обычно support@$DOMAIN]" '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' "Это не адрес почты."
ask OPERATOR_EMAIL "Адрес для обращений по персональным данным — виден на сайте [обычно privacy@$DOMAIN]" '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' "Это не адрес почты."

echo
echo "── Поиск адреса на карте (DaData: dadata.ru → личный кабинет → «API-ключ»)"
# Ключ DaData — 40 знаков (цифры и латинские a–f). Ввод скрыт: вывод терминала часто пересылают.
bad=''
while :; do
  read -r -s -p "API-ключ DaData (при вводе не виден; Enter — $( [ -n "$(get DADATA_API_KEY)" ] && echo 'оставить прежний' || echo 'пропустить')): " key || key=''
  echo
  key=${key//[[:space:]]/}
  [ -z "$key" ] || [[ "$key" =~ ^[0-9a-fA-F]{40}$ ]] || [ "$key" = "$bad" ] && break
  bad=$key
  echo "  Введено символов: ${#key}, а API-ключ DaData — 40 знаков (цифры и буквы a–f). Скопируйте его ещё раз и вставьте."
  echo "  Нужен «API-ключ», не «Секретный ключ». (Если он точно такой — вставьте тот же ещё раз.)"
done
[ -n "$key" ] && set_kv DADATA_API_KEY "$key"
[ -n "$(get DADATA_API_KEY)" ] || echo "  Без ключа поиск адреса не работает: работодатели ставят метку кликом по карте. Ключ можно добавить позже — запустите этот скрипт ещё раз."

echo
echo "Сохранено. Сейчас в настройках (пароли не показываются):"
for k in OPERATOR_NAME OPERATOR_OGRNIP OPERATOR_INN OPERATOR_ADDRESS OPERATOR_EMAIL PROCESSOR_HOSTING PROCESSOR_MAIL EMAIL_FROM SUPPORT_EMAIL; do
  printf '  %-18s %s\n' "$k" "$(get "$k")"
done
if [[ "$(get SMTP_URL)" == *ПАРОЛЬ* || -z "$(get SMTP_URL)" ]]; then echo "  SMTP_URL           НЕ ЗАДАН"; else echo "  SMTP_URL           задан"; fi
if [ -n "$(get DADATA_API_KEY)" ]; then echo "  DADATA_API_KEY     задан"; else echo "  DADATA_API_KEY     не задан (поиск адреса выключен)"; fi
echo
echo "Если всё верно — запускайте сайт:  bash $(pwd)/deploy/launch.sh"
