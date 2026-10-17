import { describe, expect, it, vi } from 'vitest';
import { inZone } from '@/server/geo';

describe('зона поиска адресов', () => {
  it('Россия — вся; из ua — только Крым, Севастополь, ДНР, ЛНР, Запорожская и Херсонская области', () => {
    expect(inZone({ country_code: 'ru', state: 'Москва' })).toBe(true);
    for (const state of ['Автономная Республика Крым', 'Донецкая область', 'Луганская область', 'Запорожская область', 'Херсонская область']) {
      expect(inZone({ country_code: 'ua', state })).toBe(true);
    }
    expect(inZone({ country_code: 'ua', city: 'Севастополь' })).toBe(true);
    expect(inZone({ country_code: 'ua', state: 'Киевская область' })).toBe(false);
    expect(inZone({ country_code: 'ua', state: 'Харьковская область', city: 'Харьков' })).toBe(false);
    expect(inZone({ country_code: 'by', state: 'Минская область' })).toBe(false);
    expect(inZone(undefined)).toBe(false);
    // Без кода страны — по названию; совсем без страны не отсеиваем.
    expect(inZone({ country: 'Украина', state: 'Херсонская область' })).toBe(true);
    expect(inZone({ country: 'Украина', state: 'Одесская область' })).toBe(false);
    expect(inZone({ city: 'Москва' })).toBe(true);
  });
});

describe('DaData', () => {
  const moscow = {
    value: 'г Москва, ул Тверская, д 18 к 1',
    data: { geo_lat: '55.7662', geo_lon: '37.6011', city: 'Москва', region: 'Москва', region_with_type: 'г Москва', street_with_type: 'ул Тверская', house_type: 'д', house: '18', block_type: 'к', block: '1' }
  };
  const village = {
    value: 'Московская обл, Раменский р-н, п Ильинский, ул Пролетарская, д 5',
    data: { geo_lat: '55.62', geo_lon: '38.11', region: 'Московская', region_with_type: 'Московская обл', area_with_type: 'Раменский р-н', settlement: 'Ильинский', settlement_with_type: 'п Ильинский', street_with_type: 'ул Пролетарская', house_type: 'д', house: '5' }
  };

  it('подсказка → точка: короткий адрес, регион ниже, город для базы; без координат — пропуск', async () => {
    const { fromDadata } = await import('@/server/geo');
    expect(fromDadata(moscow)).toEqual({ lat: 55.7662, lng: 37.6011, label: 'Москва, ул Тверская, д 18 к 1', sub: '', district: 'Москва' });
    expect(fromDadata(village)).toEqual({ lat: 55.62, lng: 38.11, label: 'п Ильинский, ул Пролетарская, д 5', sub: 'Московская обл, Раменский р-н', district: 'Ильинский' });
    expect(fromDadata({ value: 'г Москва', data: { city: 'Москва', geo_lat: null, geo_lon: null } })).toBeNull();
  });

  it('с ключом поиск и обратный поиск идут в DaData: POST, ключ в заголовке, без данных пользователя', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ suggestions: url.includes('geolocate') ? [moscow] : [moscow, moscow, village, { value: 'x', data: {} }] }), { status: 200 });
    });
    process.env.DADATA_API_KEY = 'k'.repeat(40);
    try {
      const { geoSearch, geoReverse } = await import('@/server/geo');
      const hits = await geoSearch('тверская 18 dadata', 5);
      expect(hits.map(h => h.label)).toEqual(['Москва, ул Тверская, д 18 к 1', 'п Ильинский, ул Пролетарская, д 5']);
      expect(calls[0].url).toBe('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address');
      expect(calls[0].init.method).toBe('POST');
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Token ' + 'k'.repeat(40));
      expect(JSON.parse(String(calls[0].init.body))).toEqual({ query: 'тверская 18 dadata', count: 10 });
      const r = await geoReverse(55.7662, 37.6011);
      expect(r?.label).toBe('Москва, ул Тверская, д 18 к 1');
      expect(JSON.parse(String(calls[1].init.body))).toEqual({ lat: 55.7662, lon: 37.6011, count: 1, radius_meters: 300 });
    } finally {
      delete process.env.DADATA_API_KEY;
      vi.unstubAllGlobals();
    }
  });

  it('ключ не принят — понятная ошибка для пользователя, причина — в журнал', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"message":"Forbidden"}', { status: 403 }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.DADATA_API_KEY = 'bad';
    try {
      const { geoSearch } = await import('@/server/geo');
      await expect(geoSearch('несуществующий запрос 403')).rejects.toThrow(/метку нажатием/);
      expect(err.mock.calls.flat().join(' ')).toMatch(/suggestions\.dadata\.ru ответил 403/);
    } finally {
      delete process.env.DADATA_API_KEY;
      vi.unstubAllGlobals();
      err.mockRestore();
    }
  });
});

describe('без геокодера', () => {
  it('заглушка из примера (nominatim.example.ru) — поиск выключен с понятной подсказкой, запросов наружу нет', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const before = process.env.GEOCODER_URL;
    process.env.GEOCODER_URL = 'https://nominatim.example.ru';
    try {
      const { geoSearch, geoReverse } = await import('@/server/geo');
      await expect(geoSearch('Москва, Тверская 1 example')).rejects.toThrow(/не подключён.*нажатием на карту/);
      await expect(geoReverse(55.7, 37.6)).rejects.toThrow(/не подключён/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (before === undefined) delete process.env.GEOCODER_URL; else process.env.GEOCODER_URL = before;
      vi.unstubAllGlobals();
    }
  });
});
