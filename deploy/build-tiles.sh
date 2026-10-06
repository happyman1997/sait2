#!/usr/bin/env bash
# Своя карта одной командой: тайлы региона (Planetiler, данные OpenStreetMap с Geofabrik), стиль, шрифты и значки.
#   bash deploy/build-tiles.sh                     # Центральный федеральный округ — хватает 4 ГБ памяти, ~20–40 минут
#   bash deploy/build-tiles.sh russia              # вся Россия с Крымом — 16–32 ГБ памяти, ~80 ГБ диска, несколько часов
#   bash deploy/build-tiles.sh volga-fed-district https://arenarabot.ru
# Запускать из папки проекта (/opt/arena). Работающий сайт не мешает: готовый файл подменяет старый в последний момент.
# Потом — один раз: NEXT_PUBLIC_MAP_STYLE_URL=/map/style.json в .env.production и пересборка (скрипт подскажет).
set -euo pipefail
cd "$(dirname "$0")/.."

AREA="${1:-central-fed-district}"
MAP_DIR="${MAP_DIR:-deploy/map}"
PLANETILER_IMAGE="${PLANETILER_IMAGE:-ghcr.io/onthegomap/planetiler:latest}"
NODE_IMAGE="${NODE_IMAGE:-node:22-bookworm-slim}"
TOOLS_IMAGE="${TOOLS_IMAGE:-debian:bookworm-slim}"
MIN_RUSSIA_MB="${MIN_RUSSIA_MB:-1000}"
# Доп. параметры docker run (например, --network host для прокси) и свой исходный стиль — по необходимости.
read -r -a RUN_OPTS <<< "${DOCKER_RUN_OPTS:-}"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nОшибка: %s\n' "$*" >&2; exit 1; }

case "$AREA" in
  russia|central-fed-district|northwestern-fed-district|south-fed-district|north-caucasus-fed-district|\
  volga-fed-district|ural-fed-district|siberian-fed-district|far-eastern-fed-district|kaliningrad|crimean-fed-district) ;;
  *) die "неизвестный регион «$AREA». Подходят: russia, central-fed-district, northwestern-fed-district, south-fed-district,
  north-caucasus-fed-district, volga-fed-district, ural-fed-district, siberian-fed-district, far-eastern-fed-district,
  kaliningrad, crimean-fed-district (названия Geofabrik)." ;;
esac

# Адрес сайта: аргумент или PUBLIC_URL из .env.production.
SITE="${2:-}"
if [ -z "$SITE" ] && [ -f .env.production ]; then
  SITE="$(grep -E '^PUBLIC_URL=' .env.production | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
fi
case "$SITE" in https://*|http://*) ;; *) die "не знаю адрес сайта: укажите вторым аргументом (https://arenarabot.ru) или PUBLIC_URL в .env.production." ;; esac
SITE="${SITE%/}"

command -v docker >/dev/null || die "нужен Docker."
mkdir -p "$MAP_DIR"
MAP_ABS="$(cd "$MAP_DIR" && pwd)"

# Память и диск: Planetiler берёт ~3/4 свободной памяти; диску нужен запас под исходник OSM и временные файлы.
MEM_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
HEAP_MB=$(( MEM_MB * 3 / 4 ))
if [ "$AREA" = russia ]; then NEED_MEM=8000; NEED_DISK=80; else NEED_MEM=2500; NEED_DISK=12; fi
NEED_DISK="${NEED_DISK_GB:-$NEED_DISK}"
[ "$HEAP_MB" -ge "$NEED_MEM" ] || die "мало свободной памяти: доступно ${MEM_MB} МБ, для «$AREA» нужно от $(( NEED_MEM * 4 / 3 )) МБ.
  Для всей России соберите на временном сервере (DEPLOY.md, раздел 9) или начните с округа."
FREE_GB=$(df -Pk "$MAP_DIR" | awk 'NR==2 {print int($4/1024/1024)}')
[ "$FREE_GB" -ge "$NEED_DISK" ] || die "мало места на диске: свободно ${FREE_GB} ГБ, для «$AREA» нужно от ${NEED_DISK} ГБ."
echo "Регион: $AREA · сайт: $SITE · память для сборки: $(( HEAP_MB / 1024 )) ГБ · свободно на диске: ${FREE_GB} ГБ"

# 1. Тайлы — во временный файл; старый russia.pmtiles работает, пока новый не готов.
WORK="$MAP_DIR/.build"
mkdir -p "$WORK"
OSM_ARGS=(--area="$AREA")
# Выгрузка Geofabrik «russia» не включает Республику Крым и Севастополь — они отдельным файлом. Для всей России
# скачиваем оба и склеиваем (osmium); CRIMEA=0 — без Крыма.
if [ "$AREA" = russia ] && [ "${CRIMEA:-1}" != 0 ]; then
  say "0/3 Данные OSM: Россия + Крымский федеральный округ"
  mkdir -p "$WORK/sources"
  docker run --rm "${RUN_OPTS[@]}" -v "$MAP_ABS:/data" -w /data/.build/sources "$TOOLS_IMAGE" sh -c '
    set -e
    apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl osmium-tool >/dev/null
    for u in https://download.geofabrik.de/russia-latest.osm.pbf https://download.geofabrik.de/russia/crimean-fed-district-latest.osm.pbf; do
      f=$(basename "$u")
      [ -f "$f.ok" ] || { echo "скачиваю $f"; curl -fL --retry 5 -C - -o "$f" "$u"; touch "$f.ok"; }
    done
    [ -f russia-crimea.osm.pbf.ok ] || { echo "склеиваю"; osmium merge --overwrite -o russia-crimea.osm.pbf russia-latest.osm.pbf crimean-fed-district-latest.osm.pbf; touch russia-crimea.osm.pbf.ok; }'
  OSM_ARGS=(--osm_path=/data/.build/sources/russia-crimea.osm.pbf)
fi
say "1/3 Тайлы (сборка — самый долгий шаг)"
# Контейнер планетайлера пишет от root — потом отдаём файлы владельцу папки.
docker run --rm "${RUN_OPTS[@]}" -e JAVA_TOOL_OPTIONS="-Xmx${HEAP_MB}m" -v "$MAP_ABS:/data" "$PLANETILER_IMAGE" \
  --download "${OSM_ARGS[@]}" --download_dir=/data/.build/sources --tmpdir=/data/.build/tmp \
  --output=/data/.build/russia.pmtiles --force
OUT="$WORK/russia.pmtiles"
[ -s "$OUT" ] || die "Planetiler не создал файл тайлов — смотрите вывод выше."
[ "$(head -c 7 "$OUT")" = "PMTiles" ] || die "получился не PMTiles-файл."
# Вся Россия — это гигабайты; маленький файл значит, что собралось не то (исходные данные — в $WORK/sources).
if [ "$AREA" = russia ] && [ "$(stat -c %s "$OUT")" -lt $(( MIN_RUSSIA_MB * 1024 * 1024 )) ]; then
  die "файл тайлов подозрительно мал ($(du -h "$OUT" | cut -f1)) — похоже, собрался не тот регион. Пришлите вывод выше."
fi
mv -f "$OUT" "$MAP_DIR/russia.pmtiles"
[ "${KEEP_SOURCES:-0}" = 1 ] || rm -rf "$WORK"
echo "Готово: $MAP_DIR/russia.pmtiles ($(du -h "$MAP_DIR/russia.pmtiles" | cut -f1))"

# 2. Стиль, шрифты подписей, значки — с адресами на свой сайт (повторный запуск докачивает недостающее).
say "2/3 Стиль, шрифты и значки"
docker run --rm "${RUN_OPTS[@]}" ${MAP_SOURCE_STYLE:+-e MAP_SOURCE_STYLE="$MAP_SOURCE_STYLE"} \
  -v "$PWD/deploy/map-setup.mjs:/work/map-setup.mjs:ro" -v "$MAP_ABS:/map" -w /work "$NODE_IMAGE" node map-setup.mjs "$SITE" /map
grep -q "pmtiles://$SITE/map/russia.pmtiles" "$MAP_DIR/style.json" || die "style.json не указывает на $SITE/map/russia.pmtiles."
chown -R "$(stat -c %u:%g .)" "$MAP_DIR" 2>/dev/null || true

# 3. Что осталось сделать.
say "3/3 Проверка настроек"
if [ -f .env.production ] && grep -qE '^NEXT_PUBLIC_MAP_STYLE_URL=/map/style.json' .env.production; then
  echo "Карта уже включена в .env.production — новые тайлы видны сразу, пересборка не нужна (браузеры обновят кэш в течение суток)."
else
  cat <<EOF
Карта собрана. Чтобы сайт брал её со своего сервера, один раз:
  1) в .env.production:  NEXT_PUBLIC_MAP_STYLE_URL=/map/style.json   и   CSP_CONNECT_SRC=
  2) docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
EOF
fi
