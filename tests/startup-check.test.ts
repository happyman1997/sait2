import { describe, expect, it } from 'vitest';
import { productionProblems } from '@/server/startup-check';
import { processors } from '@/server/operator';

const full = {
  OPERATOR_NAME: 'Петров Пётр Петрович', OPERATOR_OGRNIP: '300000000000000', OPERATOR_INN: '770000000000',
  OPERATOR_ADDRESS: '101000, Москва, а/я 1', OPERATOR_EMAIL: 'privacy@arenarabot.ru',
  PROCESSOR_HOSTING: 'ООО «Хостинг», ИНН 7700000000', PROCESSOR_MAIL: 'ООО «Почта», ИНН 7700000002',
  PUBLIC_URL: 'https://arenarabot.ru', AUTH_CODE_SECRET: 'a'.repeat(64), EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtps://x'
};

describe('проверка настроек перед запуском', () => {
  it('всё заполнено — проблем нет', () => {
    expect(productionProblems(full)).toEqual([]);
  });

  it('пустые реквизиты и имя из примера — названы по именам', () => {
    const p = productionProblems({ ...full, OPERATOR_INN: '', PROCESSOR_MAIL: ' ', OPERATOR_NAME: 'Иванов Иван Иванович' });
    expect(p.map(x => x.split(' — ')[0])).toEqual(['OPERATOR_NAME', 'OPERATOR_INN', 'PROCESSOR_MAIL']);
  });

  it('облачное хранилище обязательно, только если в нём фото или копии; адрес — https; почта — настоящая', () => {
    expect(productionProblems(full).some(x => x.startsWith('PROCESSOR_STORAGE'))).toBe(false);
    expect(productionProblems({ ...full, S3_BUCKET: 'arena' })[0]).toMatch(/^PROCESSOR_STORAGE/);
    expect(productionProblems({ ...full, BACKUP_S3_BUCKET: 'arena-backups' })[0]).toMatch(/^PROCESSOR_STORAGE/);
    expect(productionProblems({ ...full, PUBLIC_URL: 'http://arenarabot.ru' })[0]).toMatch(/https/);
    expect(productionProblems({ ...full, AUTH_CODE_SECRET: 'short' })[0]).toMatch(/32 символов/);
    // Коды приходят письмом — без настоящей почты сайт не запускается.
    expect(productionProblems({ ...full, EMAIL_PROVIDER: 'console' })[0]).toMatch(/^EMAIL_PROVIDER/);
    expect(productionProblems({ ...full, SMTP_URL: '' })[0]).toMatch(/^SMTP_URL/);
  });

  it('вход через Яндекс ID — нужна пара ClientID + секрет; VK ID — только цифры', () => {
    expect(productionProblems({ ...full, YANDEX_CLIENT_ID: 'abc', YANDEX_CLIENT_SECRET: 'def', VK_CLIENT_ID: '51234567' })).toEqual([]);
    expect(productionProblems({ ...full, YANDEX_CLIENT_ID: 'abc' })[0]).toMatch(/^YANDEX_CLIENT_SECRET/);
    expect(productionProblems({ ...full, YANDEX_CLIENT_SECRET: 'def' })[0]).toMatch(/^YANDEX_CLIENT_ID/);
    expect(productionProblems({ ...full, VK_CLIENT_ID: 'app-1' })[0]).toMatch(/^VK_CLIENT_ID/);
  });

  it('номер счётчика Метрики — только цифры', () => {
    expect(productionProblems({ ...full, YANDEX_METRIKA_ID: '98765432' })).toEqual([]);
    expect(productionProblems({ ...full, YANDEX_METRIKA_ID: 'ym(98765432)' })[0]).toMatch(/^YANDEX_METRIKA_ID/);
  });

  it('обработчики в политике: «ИНН» дописывается, кавычки — ёлочки, защита у хостинга — одной строкой', () => {
    const keep = { ...process.env };
    try {
      Object.assign(process.env, {
        PROCESSOR_HOSTING: 'ООО «РЕГ.РУ», ИНН 7733568767', PROCESSOR_PROTECTION: 'ООО "РЕГ.РУ" 7733568767',
        PROCESSOR_MAIL: 'Яндекс 360 для Бизнеса, 9704259180', DADATA_API_KEY: 'k', PROCESSOR_GEO: 'ООО "Дейта Кью", ИНН 7721581040'
      });
      expect(processors()).toEqual([
        ['хостинг и защита от DDoS-атак', 'ООО «РЕГ.РУ», ИНН 7733568767'],
        ['почта', 'Яндекс 360 для Бизнеса, ИНН 9704259180'],
        ['поиск адреса', 'ООО «Дейта Кью», ИНН 7721581040']
      ]);
      // ИНН ИП — 12 цифр: дописывается «ИНН», число не режется.
      process.env.PROCESSOR_MAIL = 'ИП Иванов Иван Иванович 771234567890';
      expect(processors()[1]).toEqual(['почта', 'ИП Иванов Иван Иванович, ИНН 771234567890']);
      process.env.PROCESSOR_PROTECTION = 'ООО «Защита», ИНН 7700000009';
      expect(processors()[1]).toEqual(['защита от DDoS-атак', 'ООО «Защита», ИНН 7700000009']);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
      Object.assign(process.env, keep);
    }
  });
});
