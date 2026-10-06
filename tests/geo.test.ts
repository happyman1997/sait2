import { describe, expect, it } from 'vitest';
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
