#!/usr/bin/env bash
# Временно закрыть сайт и открыть снова. Посетители видят страницу «Сайт временно не работает» (код 503,
# поисковики не выкидывают сайт из выдачи). Данные, почта, резервные копии и продление сертификата не затрагиваются.
#   bash deploy/site.sh off   — закрыть
#   bash deploy/site.sh on    — открыть
#   bash deploy/site.sh       — что сейчас
# Переключение мгновенное: nginx проверяет файл deploy/site-off/on при каждом запросе (deploy/nginx.conf.template).
set -euo pipefail
cd "$(dirname "$0")/.."
FLAG=deploy/site-off/on
case "${1:-}" in
  off) touch "$FLAG"; echo "Сайт закрыт: посетители видят «Сайт временно не работает». Открыть: bash $(pwd)/deploy/site.sh on" ;;
  on)  rm -f "$FLAG"; echo "Сайт открыт." ;;
  *)   if [ -f "$FLAG" ]; then echo "Сейчас сайт закрыт."; else echo "Сейчас сайт открыт."; fi
       echo "Закрыть: bash $(pwd)/deploy/site.sh off · открыть: bash $(pwd)/deploy/site.sh on" ;;
esac
