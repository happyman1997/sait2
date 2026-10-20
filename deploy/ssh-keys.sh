#!/usr/bin/env bash
# Вход на сервер только по ключу: выключает вход по паролю — боты со всего интернета подбирают пароли круглосуточно,
# а ключ подобрать нельзя. Запускать, когда вход по ключу уже работает (DEPLOY.md, «Безопасность сервера»).
# Вернуть вход по паролю: rm /etc/ssh/sshd_config.d/10-arena-keys.conf && systemctl reload ssh
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "Запустите от root: sudo bash deploy/ssh-keys.sh"; exit 1; }
AK=/root/.ssh/authorized_keys
# Ubuntu читает настройки по порядку и берёт первое значение: «10-» раньше «50-cloud-init», где пароль бывает включён.
CONF=/etc/ssh/sshd_config.d/10-arena-keys.conf

keys=0; [ -s "$AK" ] && keys=$(grep -cE '^(ssh-|ecdsa-|sk-)' "$AK" || true)
if [ "$keys" -eq 0 ]; then
  echo "На сервере нет ни одного ключа — если выключить пароль, вы потеряете доступ. Ничего не изменено."
  echo "Сначала добавьте ключ со своего компьютера: DEPLOY.md, «Безопасность сервера», шаги 1–3."
  exit 1
fi
if ! grep -qiE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/' /etc/ssh/sshd_config; then
  echo "Настройки SSH устроены не так, как в Ubuntu, — ничего не меняю."
  exit 1
fi

echo "Ключей на сервере: $keys."
echo "Проверьте в ДРУГОМ окне PowerShell: команда  ssh root@<адрес сервера>  входит без пароля от сервера."
read -r -p "Входит без пароля? Напишите «да»: " answer
[ "$answer" = "да" ] || { echo "Ничего не изменено."; exit 1; }

cat > "$CONF" <<'CFG'
# Вход только по ключу (deploy/ssh-keys.sh). Вернуть вход по паролю: удалить этот файл и systemctl reload ssh.
PasswordAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin prohibit-password
CFG
if ! sshd -t 2>/dev/null; then
  rm -f "$CONF"
  echo "Проверка настроек SSH не прошла — ничего не изменено."
  exit 1
fi
systemctl reload ssh 2>/dev/null || systemctl reload sshd

if [ "$(sshd -T 2>/dev/null | awk '$1 == "passwordauthentication" {print $2}')" = no ]; then
  echo "Готово: вход по паролю выключен."
  echo "Не закрывайте это окно, пока не проверите в новом окне, что вход по ключу работает."
  echo "Если ключ потеряется (новый компьютер) — войдите через консоль в панели reg.ru и выполните:"
  echo "  rm $CONF && systemctl reload ssh"
else
  echo "Не применилось: другой файл настроек включает вход по паролю. Пришлите вывод: grep -ri passwordauthentication /etc/ssh/"
fi
