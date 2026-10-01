# Развёртывание «Арены Работы»

Три контейнера: **Postgres 16**, **приложение** (Next.js в режиме standalone, ~440 МБ с базовым образом Node) и **nginx** (HTTPS, лимит загрузки 10 МБ, поток живых событий без буферизации). Миграции применяются при каждом старте приложения под блокировкой — несколько экземпляров стартуют безопасно.

Проверено на стенде: регистрация обеих ролей по HTTPS (cookie `Secure`, `HttpOnly`), заказ, отклик с живым уведомлением через nginx, найм, загрузка фото (6 МБ проходит, 12 МБ — 413), назначение поддержки, резервная копия и восстановление, данные переживают пересоздание контейнеров.

## 1. Сервер

- Linux с Docker Engine 24+ и плагином compose; 2 vCPU, 4 ГБ RAM, 40 ГБ SSD — с запасом для старта.
- Серверы в РФ (152-ФЗ: персональные данные граждан РФ).
- DNS: A-запись домена на IP сервера. Открыть порты 80 и 443.

## 2. Код и настройки

```sh
git clone <репозиторий> /opt/arena && cd /opt/arena
cp .env.production.example .env.production
nano .env.production        # обязательный блок: домен, пароли, SMS, почта, геокодер
```

## 3. Сертификат Let's Encrypt (первый выпуск)

nginx без сертификата не стартует, поэтому первый раз — certbot в режиме standalone (порт 80 свободен):

```sh
docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot \
  certonly --standalone -d arenarabot.ru -m admin@arenarabot.ru --agree-tos -n
```

Продление — раз в сутки из cron (через nginx, без остановки):

```sh
15 4 * * * docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v arena_certbot-www:/var/www/certbot certbot/certbot renew --webroot -w /var/www/certbot -q && docker compose -f /opt/arena/docker-compose.prod.yml --env-file /opt/arena/.env.production exec nginx nginx -s reload
```

(`arena_certbot-www` — том compose; имя начинается с имени папки проекта: `docker volume ls`.)

## 4. Запуск

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps     # app и db — healthy
curl https://arenarabot.ru/api/health                                    # {"ok":true,...}
```

Первый сотрудник поддержки (после его регистрации на сайте):

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production exec app node scripts/staff.mjs add <логин>
```

Реклама (креативы с erid): `exec app node scripts/ads.mjs` — список команд; добавить креатив из файла на сервере: `exec -T app node scripts/ads.mjs add /dev/stdin < ad.json` (поля — в `scripts/ads.ts`).

## 5. Обновление

```sh
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build app
```

Миграции применятся при старте нового контейнера. Перед обновлением с миграциями — резервная копия (ниже).

## 6. Резервные копии

```sh
sh deploy/backup.sh          # deploy/backups/arena-ГГГГММДД-ЧЧММ.dump, хранятся 14 дней
```

В cron ежедневно: `30 3 * * * cd /opt/arena && sh deploy/backup.sh >> deploy/backups/backup.log 2>&1`. Копии стоит дополнительно уносить с сервера (S3, другой сервер).

Восстановление:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db \
  pg_restore -U arena -d arena --clean --if-exists < deploy/backups/<файл>.dump
```

Фото лежат в томе `uploads` (или в S3, если задан `S3_BUCKET`) — том тоже включите в резервное копирование.

## 7. Мониторинг

- Живость: `GET /api/health` (200 — база отвечает). Docker перезапускает приложение, если проверка не проходит.
- Метрики Prometheus: `GET /api/metrics` с заголовком `Authorization: Bearer <METRICS_TOKEN>` — запросы и задержки API, пул базы, живые потоки, очередь уведомлений, очередь поддержки, нарушения CSP.
- Журнал: `docker compose ... logs -f app`.

## 8. Несколько экземпляров

Приложение без состояния, кроме фото: задайте `S3_BUCKET` и запускайте несколько контейнеров `app` за балансировщиком (`docker compose ... up -d --scale app=3` и `upstream` в nginx). Живые обновления идут через Postgres `LISTEN/NOTIFY`, фоновые задачи защищены блокировкой — работают корректно при любом числе экземпляров. Кэш выдачи на соседних экземплярах обновляется в пределах 5 с (вошедшим) и 20 с (гостям).

## 9. Своя карта (без зарубежных серверов)

По умолчанию стиль и тайлы карты грузятся браузером с OpenFreeMap (за рубежом). Чтобы всё шло с вашего сервера:

1. **Тайлы России** — один файл `russia.pmtiles` (схема OpenMapTiles), собирается Planetiler из данных OpenStreetMap. Нужна машина с 16 ГБ RAM и ~60 ГБ диска, несколько часов; собрать можно и на другой машине, а файл (~10–15 ГБ) скопировать:
   ```sh
   mkdir -p deploy/map
   docker run --rm -e JAVA_TOOL_OPTIONS="-Xmx12g" -v "$PWD/deploy/map:/data" ghcr.io/onthegomap/planetiler:latest \
     --download --area=russia --output=/data/russia.pmtiles
   ```
2. **Стиль, шрифты подписей, значки** (стиль liberty, адреса переписываются на ваш сайт):
   ```sh
   docker run --rm -v "$PWD:/work" -w /work node:22-bookworm-slim node deploy/map-setup.mjs https://arenarabot.ru
   ```
3. В `.env.production`: `NEXT_PUBLIC_MAP_STYLE_URL=/map/style.json` (и `CSP_CONNECT_SRC=` пустой), затем пересборка:
   ```sh
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```

nginx отдаёт `deploy/map` по адресу `/map/` (другая папка — `MAP_DIR`); карта читает файл тайлов кусками (Range-запросы), отдельный сервер тайлов не нужен. Подпись на карте сменится на «© OpenMapTiles · © участники OpenStreetMap». Обновлять тайлы — повтором шага 1 раз в несколько месяцев.

Проверено на стенде с тестовым файлом тайлов: карта рисуется, все запросы страницы — только на свой сервер, нарушений CSP нет. Шаги 1–2 на стенде не запускались (нужен доступ к Geofabrik и OpenFreeMap).

Шрифт интерфейса (Golos Text) уже отдаётся со своего сервера — Google Fonts не используется.

## 10. Сборка за прокси с подменой TLS

Если сервер ходит в интернет через корпоративный прокси со своим сертификатом:

```sh
docker build --secret id=ca,src=/путь/к/ca.crt -t arena-raboty:latest .
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-build
```

## Перед публичным запуском

- Оферта, политика, согласие и правила (/legal/*) — утвердить юристом (сейчас черновики); реквизиты — `OPERATOR_*`, `PROCESSOR_*` в `.env.production`.
- Уведомление в Роскомнадзор об обработке ПДн — до первой регистрации; номер из реестра — в `OPERATOR_RKN_NUMBER`.
- Своя карта (раздел 9) — иначе браузер ходит за тайлами за рубеж, а политика говорит, что трансграничной передачи нет.
- Реальные erid рекламы — через оператора рекламных данных.
- Свой геокодер (Nominatim/Photon) и, при росте, свой хостинг тайлов карты.
- Внешняя проверка безопасности.
