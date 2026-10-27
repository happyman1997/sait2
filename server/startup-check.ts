// Проверка настроек перед запуском в продакшене: без реквизитов оператора и ключевых настроек сайт не стартует.
// Иначе в оферте и политике стояло бы «[ФИО]», а коды и письма молча не уходили бы.
// Номер в реестре Роскомнадзора не обязателен: его присваивают позже, чем подаётся уведомление.

const EXAMPLE_NAME = 'Иванов Иван Иванович';

export function productionProblems(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  const val = (name: string) => env[name]?.trim() || '';
  const need = (name: string, what: string) => { if (!val(name)) out.push(name + ' — ' + what); };

  need('OPERATOR_NAME', 'ФИО владельца (ИП) для оферты и политики');
  if (val('OPERATOR_NAME') === EXAMPLE_NAME) out.push('OPERATOR_NAME — осталось имя из примера, впишите своё');
  need('OPERATOR_OGRNIP', 'ОГРНИП');
  need('OPERATOR_INN', 'ИНН');
  need('OPERATOR_ADDRESS', 'адрес для писем');
  need('OPERATOR_EMAIL', 'e-mail для обращений по персональным данным');
  need('PROCESSOR_HOSTING', 'хостинг-провайдер и его ИНН (кто хранит данные по вашему поручению)');
  need('PROCESSOR_MAIL', 'почтовый сервис и его ИНН');
  if (val('S3_BUCKET') || val('BACKUP_S3_BUCKET')) need('PROCESSOR_STORAGE', 'облачное хранилище и его ИНН (фото или резервные копии хранятся в нём)');

  need('PUBLIC_URL', 'адрес сайта, например https://arenarabot.ru');
  if (val('PUBLIC_URL') && !val('PUBLIC_URL').startsWith('https://')) out.push('PUBLIC_URL — должен начинаться с https://');
  if (val('AUTH_CODE_SECRET').length < 32) out.push('AUTH_CODE_SECRET — случайная строка не короче 32 символов (openssl rand -hex 32)');
  // Почта — единственный способ получить код при регистрации и восстановлении: без SMTP сайт не запускается.
  if (val('EMAIL_PROVIDER') !== 'smtp') out.push('EMAIL_PROVIDER — должно быть smtp: коды подтверждения приходят письмом');
  need('SMTP_URL', 'адрес почтового сервера с логином и паролем');
  // Вход через Яндекс ID без секрета не заработает — кнопка просто не появится, лучше сказать сразу.
  if (val('YANDEX_CLIENT_ID')) need('YANDEX_CLIENT_SECRET', 'Client secret приложения на oauth.yandex.ru (или уберите YANDEX_CLIENT_ID)');
  if (val('YANDEX_CLIENT_SECRET') && !val('YANDEX_CLIENT_ID')) out.push('YANDEX_CLIENT_ID — ClientID приложения на oauth.yandex.ru (секрет указан, а ClientID нет)');
  if (val('VK_CLIENT_ID') && !/^\d+$/.test(val('VK_CLIENT_ID'))) out.push('VK_CLIENT_ID — ID приложения VK ID, только цифры');
  // Иначе счётчик молча не включился бы (server/config.ts) — а владелец ждал бы статистику.
  if (val('YANDEX_METRIKA_ID') && !/^\d{5,12}$/.test(val('YANDEX_METRIKA_ID'))) out.push('YANDEX_METRIKA_ID — номер счётчика Яндекс Метрики, только цифры (или пусто)');
  return out;
}

/** Вызывается при старте сервера. ALLOW_INCOMPLETE_CONFIG=1 — только для проверки сборки на своём компьютере. */
export function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_INCOMPLETE_CONFIG === '1') return;
  const problems = productionProblems();
  if (!problems.length) return;
  console.error('Сайт не запущен: в .env.production не заполнено или заполнено неверно:\n  - ' + problems.join('\n  - ') +
    '\nИсправьте .env.production и перезапустите приложение (DEPLOY.md, раздел 2).');
  process.exit(1);
}
