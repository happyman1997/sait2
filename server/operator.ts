// Реквизиты оператора ПДн и владельца сервиса — из окружения (.env.production), чтобы не держать их в коде.
// Незаполненное поле показывается как [в скобках] — видно, что подставить перед запуском.
import { config } from './config';

const v = (name: string, label: string) => process.env[name]?.trim() || '[' + label + ']';

export function operator() {
  return {
    name: v('OPERATOR_NAME', 'ФИО'),
    ogrnip: v('OPERATOR_OGRNIP', 'ОГРНИП'),
    inn: v('OPERATOR_INN', 'ИНН'),
    address: v('OPERATOR_ADDRESS', 'адрес для писем'),
    email: v('OPERATOR_EMAIL', 'e-mail для обращений'),
    // Номер присваивают после уведомления — до этого строки о нём в политике нет.
    rknNumber: process.env.OPERATOR_RKN_NUMBER?.trim() || '',
    hosting: v('PROCESSOR_HOSTING', 'хостинг-провайдер, ИНН'),
    sms: v('PROCESSOR_SMS', 'SMS-провайдер, ИНН'),
    mail: v('PROCESSOR_MAIL', 'почтовый сервис, ИНН'),
    // Без S3 фото лежат у хостинга — отдельного обработчика нет.
    storage: config.s3Bucket() ? v('PROCESSOR_STORAGE', 'хранилище файлов, ИНН') : process.env.PROCESSOR_STORAGE?.trim() || '',
    site: config.publicUrl().replace(/^https?:\/\//, '').replace(/\/$/, ''),
    edition: config.offerVersion
  };
}

/** Обработчики по поручению оператора (хостинг, SMS, почта, хранилище фото) — [название, кто] без пустых. */
export function processors(): [string, string][] {
  const o = operator();
  return ([['хостинг', o.hosting], ['SMS', o.sms], ['почта', o.mail], ['хранилище фото', o.storage]] as [string, string][]).filter(p => p[1]);
}

/** «ИП Иванов Иван Иванович, ОГРНИП …, ИНН …» */
export function operatorLine() {
  const o = operator();
  return 'ИП ' + o.name + ', ОГРНИП ' + o.ogrnip + ', ИНН ' + o.inn;
}
