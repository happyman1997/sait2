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
  need('PROCESSOR_SMS', 'SMS-провайдер и его ИНН');
  need('PROCESSOR_MAIL', 'почтовый сервис и его ИНН');
  if (val('S3_BUCKET')) need('PROCESSOR_STORAGE', 'хранилище фото и его ИНН (задан S3_BUCKET)');

  need('PUBLIC_URL', 'адрес сайта, например https://arenarabot.ru');
  if (val('PUBLIC_URL') && !val('PUBLIC_URL').startsWith('https://')) out.push('PUBLIC_URL — должен начинаться с https://');
  if (val('AUTH_CODE_SECRET').length < 32) out.push('AUTH_CODE_SECRET — случайная строка не короче 32 символов (openssl rand -hex 32)');
  if (val('SMS_PROVIDER') === 'smsru') need('SMSRU_API_ID', 'ключ из личного кабинета SMS.ru');
  if (val('EMAIL_PROVIDER') === 'smtp') need('SMTP_URL', 'адрес почтового сервера с логином и паролем');
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
