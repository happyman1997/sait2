import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoTitle, dateLabel, daysAhead, emptyJobForm, jobAllErrors, jobStatus, jobStepErrors, money, moneyShort } from '@/lib/jobs';

describe('форматирование', () => {
  it('ставки', () => {
    expect(money(6000, 'за заказ')).toBe('6 000 ₽');
    expect(money(900, 'за час')).toBe('900 ₽ / час');
    expect(moneyShort(12000, 'за заказ')).toBe('12 тыс ₽');
    expect(moneyShort(1200, 'за час')).toBe('1 200 ₽/ч');
    expect(moneyShort(3800, 'за смену')).toBe('3 800 ₽/смену');
    expect(moneyShort(1400, 'за сотку')).toBe('1 400 ₽/сотку');
  });

  it('даты', () => {
    expect(dateLabel('2026-01-12')).toBe('12 января');
    expect(daysAhead('2026-10-01', '2026-09-29')).toBe(2);
    expect(daysAhead('2026-09-28', '2026-09-29')).toBe(-1);
    expect(daysAhead('мусор', '2026-09-29')).toBeNull();
  });

  it('автозаголовок — тип и две последние части адреса', () => {
    expect(autoTitle('уборка снега', 'Москва, ул. Тверская, 18')).toBe('Уборка снега — ул. Тверская, 18');
    expect(autoTitle('Покос травы', '')).toBe('Покос травы');
  });
});

describe('статус заказа', () => {
  const j = { status: 'open' as const, hired: 0, crew: 1, urgent: false, myStatus: null };
  it('цепочка приоритетов', () => {
    expect(jobStatus(j, null).label).toBe('Открыт');
    expect(jobStatus({ ...j, urgent: true }, null).label).toBe('Срочно');
    expect(jobStatus({ ...j, myStatus: 'sent' }, 'freelancer').label).toBe('Вы откликнулись');
    expect(jobStatus({ ...j, crew: 3, hired: 1 }, null).label).toBe('Набрано 1 из 3');
    expect(jobStatus({ ...j, crew: 99, hired: 5 }, null).label).toBe('Набрано 5');
    expect(jobStatus({ ...j, hired: 1 }, null).label).toBe('Исполнитель найден');
    expect(jobStatus({ ...j, crew: 2, hired: 2 }, null).label).toBe('Смена набрана');
    expect(jobStatus({ ...j, hired: 1, myStatus: 'hired' }, 'freelancer').label).toBe('Вас наняли');
    expect(jobStatus({ ...j, status: 'cancelled' }, null).label).toBe('Смена отменена');
    expect(jobStatus({ ...j, status: 'accepted' }, null).label).toBe('Смена закрыта');
  });
});

describe('проверка формы заказа по шагам', () => {
  it('тексты ошибок из прототипа', () => {
    const f = emptyJobForm();
    expect(jobStepErrors(1, f)).toEqual({ address: 'Укажите адрес — исполнитель должен понимать, куда идти.' });
    expect(jobStepErrors(1, { ...f, address: 'Тверская, 18' }).address).toMatch(/метку/);
    expect(Object.keys(jobStepErrors(2, f))).toEqual(['desc', 'type']);
    expect(jobStepErrors(3, f)).toMatchObject({ pay: 'Укажите ставку — без неё заказ не смотрят.', date: 'Выберите дату выхода.' });
    expect(jobStepErrors(3, { ...f, pay: '100', dateISO: '2030-01-01', regular: true }).repeat).toMatch(/график/);
    expect(Object.keys(jobStepErrors(4, f))).toEqual(['access', 'tools']);
    expect(Object.keys(jobAllErrors(f))).toHaveLength(7);
  });

  it('людей в смене: 1–12 или «сколько угодно» (99)', () => {
    const f = { ...emptyJobForm(), desc: 'x', type: 'snow' };
    expect(jobStepErrors(2, { ...f, crew: '12' })).toEqual({});
    expect(jobStepErrors(2, { ...f, crew: '99' })).toEqual({});
    expect(jobStepErrors(2, { ...f, crew: '13' }).crew).toBeTruthy();
    expect(jobStepErrors(2, { ...f, crew: '0' }).crew).toBeTruthy();
  });
});

describe('геокодер', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('разбирает ответ Nominatim в короткий адрес и район', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { lat: '55.765', lon: '37.605', display_name: '18, Тверская улица, Тверской, Москва, Центральный федеральный округ, 125009, Россия', address: { house_number: '18', road: 'Тверская улица', city: 'Москва', state: 'Москва', country_code: 'ru' } },
      { lat: '50.45', lon: '30.52', display_name: 'Хрещатик, Київ', address: { road: 'Хрещатик', city: 'Киев', state: 'Киев', country_code: 'ua' } },
      { lat: '55.765', lon: '37.605', display_name: 'дубль', address: { house_number: '18', road: 'Тверская улица', city: 'Москва' } }
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { geoSearch } = await import('@/server/geo');
    const hits = await geoSearch('Тверская 18');
    expect(hits).toEqual([{ lat: 55.765, lng: 37.605, label: 'Москва, Тверская улица, 18', sub: 'Центральный федеральный округ, 125009', district: 'Москва' }]);
    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get('countrycodes')).toBe('ru,ua');
    // второй одинаковый запрос берётся из кэша
    await geoSearch('Тверская 18');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('сбой геокодера — понятная ошибка вместо падения', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    const { geoReverse } = await import('@/server/geo');
    await expect(geoReverse(55.7, 37.6)).rejects.toThrow(/Геокодер недоступен/);
  });
});
