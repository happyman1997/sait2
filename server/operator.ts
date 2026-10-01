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
    rknNumber: v('OPERATOR_RKN_NUMBER', 'номер в реестре операторов'),
    hosting: v('PROCESSOR_HOSTING', 'хостинг-провайдер, ИНН'),
    sms: v('PROCESSOR_SMS', 'SMS-провайдер, ИНН'),
    mail: v('PROCESSOR_MAIL', 'почтовый сервис, ИНН'),
    storage: v('PROCESSOR_STORAGE', 'хранилище файлов, ИНН'),
    site: config.publicUrl().replace(/^https?:\/\//, '').replace(/\/$/, ''),
    edition: config.offerVersion
  };
}

/** «ИП Иванов Иван Иванович, ОГРНИП …, ИНН …» */
export function operatorLine() {
  const o = operator();
  return 'ИП ' + o.name + ', ОГРНИП ' + o.ogrnip + ', ИНН ' + o.inn;
}
