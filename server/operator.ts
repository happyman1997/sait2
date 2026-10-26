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
    mail: v('PROCESSOR_MAIL', 'почтовый сервис, ИНН'),
    // Облачное хранилище — обработчик, если в нём фото (S3_BUCKET) или резервные копии (BACKUP_S3_BUCKET); иначе всё у хостинга.
    storage: usesCloudStorage() ? v('PROCESSOR_STORAGE', 'облачное хранилище, ИНН') : process.env.PROCESSOR_STORAGE?.trim() || '',
    // Поиск адреса (DaData) — обработчик, когда он включён ключом; защита от DDoS-атак — если подключена отдельно от хостинга.
    // Без PROCESSOR_GEO — название сервиса без реквизитов (не «[заглушка]» на сайте); точнее — deploy/configure.sh.
    geocoder: process.env.DADATA_API_KEY?.trim() ? process.env.PROCESSOR_GEO?.trim() || 'DaData (dadata.ru)' : '',
    protection: process.env.PROCESSOR_PROTECTION?.trim() || '',
    site: config.publicUrl().replace(/^https?:\/\//, '').replace(/\/$/, ''),
    edition: config.offerVersion
  };
}

export const usesCloudStorage = () => !!(config.s3Bucket() || process.env.BACKUP_S3_BUCKET?.trim());

const innOf = (s: string) => s.match(/(?<!\d)\d{10}(?!\d)/)?.[0] ?? '';
/** Как вписали в настройках → как показать: «ООО "Хостинг" 7700000000» → «ООО «Хостинг», ИНН 7700000000» (слово «ИНН» часто пропускают). */
export function processorLine(s: string): string {
  const t = s.replace(/"([^"]+)"/g, '«$1»');
  return /ИНН/i.test(t) ? t : t.replace(/,?\s*(\d{10})\s*$/, ', ИНН $1');
}

/** Обработчики по поручению оператора (хостинг, защита от атак, почта, хранилище, поиск адреса) — [название, кто] без пустых. */
export function processors(): [string, string][] {
  const o = operator();
  // Защиту от атак даёт сам хостинг (DDoS-Guard через REG.RU) — одной строкой, без повтора хостинга.
  const same = !!o.protection && !!innOf(o.protection) && innOf(o.protection) === innOf(o.hosting);
  return ([[same ? 'хостинг и защита от DDoS-атак' : 'хостинг', o.hosting], ['защита от DDoS-атак', same ? '' : o.protection], ['почта', o.mail],
    ['облачное хранилище фото и резервных копий', o.storage], ['поиск адреса', o.geocoder]] as [string, string][])
    .filter(p => p[1]).map(([k, s]) => [k, processorLine(s)]);
}

/** «ИП Иванов Иван Иванович, ОГРНИП …, ИНН …» */
export function operatorLine() {
  const o = operator();
  return 'ИП ' + o.name + ', ОГРНИП ' + o.ogrnip + ', ИНН ' + o.inn;
}
