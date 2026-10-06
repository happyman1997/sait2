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

По умолчанию стиль и тайлы карты грузятся браузером с OpenFreeMap (за рубежом). Чтобы всё шло с вашего сервера — одна команда в папке проекта:

```sh
bash deploy/build-tiles.sh                  # Центральный федеральный округ: 4 ГБ памяти, ~12 ГБ диска, 20–40 минут
bash deploy/build-tiles.sh russia           # вся зона сайта: 16–32 ГБ памяти, ~80 ГБ диска, несколько часов
```

Скрипт:
- собирает Planetiler'ом тайлы региона из данных OpenStreetMap (Geofabrik) в `deploy/map/russia.pmtiles`. Для `russia` это вся зона сайта: Россия, Республика Крым и Севастополь, ДНР, ЛНР, Запорожская и Херсонская области. У Geofabrik они в разных выгрузках, скрипт склеивает их сам;
- скачивает стиль liberty, шрифты подписей и значки и переписывает их адреса на ваш сайт — `PUBLIC_URL` из `.env.production` или второй аргумент;
- проверяет результат и подсказывает, что включить.

Перед стартом скрипт проверяет память и диск. Пока идёт сборка, сайт работает со старой картой: новый файл подменяет старый только в конце.

Включить один раз — в `.env.production`: `NEXT_PUBLIC_MAP_STYLE_URL=/map/style.json` и пустой `CSP_CONNECT_SRC=`, затем пересборка:
```sh
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

**Вся Россия при маленьком сервере.** Соберите на временном облачном сервере с почасовой оплатой (8 ядер, 32 ГБ, 150 ГБ) той же командой. Затем скопируйте `deploy/map/` на рабочий сервер (`rsync -a deploy/map/ root@<IP>:/opt/arena/deploy/map/`) и удалите временный. За пределами собранного региона карта будет пустой (без улиц), метки заказов видны везде.

nginx отдаёт `deploy/map` по адресу `/map/` (другая папка — `MAP_DIR`); карта читает файл тайлов кусками (Range-запросы), отдельный сервер тайлов не нужен. Подпись на карте сменится на «© OpenMapTiles · © участники OpenStreetMap». Обновлять тайлы — повтором `build-tiles.sh` раз в несколько месяцев; пересборка сайта не нужна.

Проверено на стенде с тестовым файлом тайлов: карта рисуется, все запросы страницы — только на свой сервер, нарушений CSP нет. Скрипт проверен с подставным Planetiler и локальным стилем; настоящая сборка на стенде не запускалась (нет доступа к Geofabrik и OpenFreeMap).

Шрифт интерфейса (Golos Text) уже отдаётся со своего сервера — Google Fonts не используется.

## 10. Сборка за прокси с подменой TLS

Если сервер ходит в интернет через корпоративный прокси со своим сертификатом:

```sh
docker build --secret id=ca,src=/путь/к/ca.crt -t arena-raboty:latest .
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-build
```

## 11. Безопасность

Что уже встроено:

- **Вход.** Пароли — scrypt; новые — от 8 символов, без самых частых и без логина или телефона вместо пароля. На вход — лимиты на аккаунт и IP.
- **Коды из SMS.** 3 попытки на код и не больше 10 неверных кодов на номер в сутки по всем сценариям, поэтому подобрать код к чужому аккаунту нельзя. Не больше 10 SMS на номер в сутки — защита от «SMS-бомбы» и лишних расходов.
- **Сессии.** Cookie `__Host-arena_session` (HttpOnly, Secure, SameSite=Lax), до 90 дней с входа. У поддержки — до 7 дней и гаснет после 12 часов без действий. Смена пароля завершает остальные входы.
- **Запросы с чужих сайтов** отклоняются по Sec-Fetch-Site и Origin; адрес сайта сверяется с `PUBLIC_URL`. Поэтому `PUBLIC_URL` должен совпадать с адресом в браузере до буквы: без `www` и без лишнего `/`.
- **Фото.** Тип определяется по содержимому, метаданные (EXIF с GPS, XMP, комментарии) удаляются при загрузке. Фото смены видят только её участники.
- **nginx.** Запросы на IP или чужое имя отбрасываются, версия nginx скрыта. Вход и регистрация — не чаще 30 запросов в минуту с IP, API — 30 в секунду, живых соединений — до 20 с IP и до 8 на аккаунт.
- **Страницы.** Строгая CSP по nonce, HSTS, запрет встраивания во фреймы, `nosniff`.

Что сделать на сервере:

```sh
# Вход по SSH только по ключу, без пароля и без root
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config && systemctl reload ssh
# Открыты только SSH, 80 и 443
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable
# Обновления безопасности ставятся сами
apt install -y unattended-upgrades fail2ban
```

`.env.production` — только для владельца: `chmod 600 .env.production`. Резервные копии содержат персональные данные: храните их зашифрованными (например, `gpg -c`) и не в публичном хранилище.

## Перед публичным запуском

- Оферта, политика, согласие и правила (/legal/*) — утвердить юристом (сейчас черновики); реквизиты — `OPERATOR_*`, `PROCESSOR_*` в `.env.production`.
- Уведомление в Роскомнадзор об обработке ПДн — до первой регистрации; номер из реестра — в `OPERATOR_RKN_NUMBER`.
- Своя карта (раздел 9) — иначе браузер ходит за тайлами за рубеж, а политика говорит, что трансграничной передачи нет.
- Реальные erid рекламы — через оператора рекламных данных.
- Свой геокодер (Nominatim/Photon) — с данными той же зоны, что и карта: выгрузка России, Крымского ФО и Украины (поиск сам отбирает нужные регионы, `server/geo.ts`).
- Внешняя проверка безопасности (пентест) — после запуска, когда появятся пользователи.
