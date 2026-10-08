import { describe, expect, it } from 'vitest';
import { productionProblems } from '@/server/startup-check';

const full = {
  OPERATOR_NAME: 'Петров Пётр Петрович', OPERATOR_OGRNIP: '300000000000000', OPERATOR_INN: '770000000000',
  OPERATOR_ADDRESS: '101000, Москва, а/я 1', OPERATOR_EMAIL: 'privacy@arenarabot.ru',
  PROCESSOR_HOSTING: 'ООО «Хостинг», ИНН 7700000000', PROCESSOR_SMS: 'ООО «СМС», ИНН 7700000001', PROCESSOR_MAIL: 'ООО «Почта», ИНН 7700000002',
  PUBLIC_URL: 'https://arenarabot.ru', AUTH_CODE_SECRET: 'a'.repeat(64), SMS_PROVIDER: 'smsru', SMSRU_API_ID: 'key', EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtps://x'
};

describe('проверка настроек перед запуском', () => {
  it('всё заполнено — проблем нет', () => {
    expect(productionProblems(full)).toEqual([]);
  });

  it('пустые реквизиты и имя из примера — названы по именам', () => {
    const p = productionProblems({ ...full, OPERATOR_INN: '', PROCESSOR_SMS: ' ', OPERATOR_NAME: 'Иванов Иван Иванович' });
    expect(p.map(x => x.split(' — ')[0])).toEqual(['OPERATOR_NAME', 'OPERATOR_INN', 'PROCESSOR_SMS']);
  });

  it('хранилище фото обязательно только при S3; адрес — https; ключи провайдеров — по выбору', () => {
    expect(productionProblems(full).some(x => x.startsWith('PROCESSOR_STORAGE'))).toBe(false);
    expect(productionProblems({ ...full, S3_BUCKET: 'arena' })[0]).toMatch(/^PROCESSOR_STORAGE/);
    expect(productionProblems({ ...full, PUBLIC_URL: 'http://arenarabot.ru' })[0]).toMatch(/https/);
    expect(productionProblems({ ...full, AUTH_CODE_SECRET: 'short' })[0]).toMatch(/32 символов/);
    expect(productionProblems({ ...full, SMSRU_API_ID: '' })[0]).toMatch(/^SMSRU_API_ID/);
    expect(productionProblems({ ...full, SMS_PROVIDER: 'console', SMSRU_API_ID: '' })).toEqual([]);
  });
});
