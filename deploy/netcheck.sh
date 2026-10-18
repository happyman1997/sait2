#!/usr/bin/env bash
# Почему сайт не открывается у части посетителей (например, с VPN): адреса домена в DNS, IPv6 и главное —
# доходят ли их запросы до сервера. Порядок: попросите человека с VPN открыть https://ВАШ-ДОМЕН/?vpn-check,
# затем на сервере: bash deploy/netcheck.sh. Ничего не меняет, только показывает.
set -uo pipefail
cd "$(dirname "$0")/.."
ENV=.env.production
[ -f "$ENV" ] || { echo "Нет $ENV — сначала: bash deploy/setup.sh"; exit 1; }
get() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- || true; }
dc() { docker compose -f docker-compose.prod.yml --env-file "$ENV" "$@"; }
DOMAIN=$(get SERVER_NAME)
src() { awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}'; }
me4=$(ip -4 route get 1.1.1.1 2>/dev/null | src)
me6=$(ip -6 route get 2606:4700:4700::1111 2>/dev/null | src)

echo "== 1/3 Адреса домена в DNS"
bad6=0
for h in "$DOMAIN" "www.$DOMAIN"; do
  a=$(getent ahostsv4 "$h" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
  # Без IPv6 на сервере getent может вернуть IPv4 в виде ::ffff:… — это не запись AAAA.
  aaaa=$(getent ahostsv6 "$h" 2>/dev/null | awk '{print $1}' | grep -v '^::ffff:' | sort -u | tr '\n' ' ')
  echo "  $h: IPv4 ${a:-нет}; IPv6 ${aaaa:-нет}"
  for x in $aaaa; do [ "$x" = "$me6" ] || bad6=1; done
done
echo "  этот сервер: IPv4 ${me4:-?}; IPv6 ${me6:-нет}"
if [ $bad6 = 1 ]; then
  echo "  ВНИМАНИЕ: у домена есть запись AAAA (IPv6), и она ведёт не на этот сервер. Посетители с IPv6 — а он часто"
  echo "  есть у VPN — попадают по ней на чужой сервер. Удалите записи AAAA для $DOMAIN и www.$DOMAIN в DNS у регистратора."
fi
if [ -n "$me6" ]; then
  c6=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:443:[$me6]" "https://$DOMAIN/api/health" || true)
  echo "  сайт по IPv6 этого сервера: ${c6:-нет ответа}$([ "$c6" = 200 ] && echo ' — работает')"
fi

echo "== 2/3 Заходы с пометкой ?vpn-check за последние 6 часов"
hits=$(dc logs --no-log-prefix --since 6h nginx 2>/dev/null | grep -E '"[A-Z]+ /\?vpn-check' || true)
if [ -z "$hits" ]; then
  echo "  нет ни одного."
  echo "  Если человек с VPN открывал https://$DOMAIN/?vpn-check, а здесь пусто — его запрос до сервера не дошёл:"
  echo "  его отсекает сеть по дороге (хостинг или фильтры провайдеров), а не сам сайт."
else
  # Формат журнала nginx: IP - - [время] "запрос" код размер "откуда" "браузер".
  printf '%s\n' "$hits" | tail -10 | awk '{t = $4; sub(/^\[/, "", t); print "  " t "  IP " $1 "  код ответа " $9}'
  codes=$(printf '%s\n' "$hits" | awk '{print $9}' | sort -u | tr '\n' ' ')
  case " $codes" in
    *" 429 "*) echo "  Код 429 — сработал предел запросов с одного адреса: за VPN-адресом много людей. Пришлите эти строки." ;;
    *" 200 "*|*" 304 "*) echo "  Запрос дошёл, сайт ответил нормально. Значит, мешает что-то на стороне VPN или браузера — пришлите эти строки." ;;
    *) echo "  Запрос дошёл, но ответ необычный — пришлите эти строки." ;;
  esac
fi

echo "== 3/3 Ответы «слишком много запросов» (429) за сутки"
n429=$(dc logs --no-log-prefix --since 24h nginx 2>/dev/null | grep -c '" 429 ' || true)
echo "  ${n429:-0}"

echo
echo "Проверка из разных стран (откройте в браузере): https://check-host.net/check-http?host=https://$DOMAIN"
