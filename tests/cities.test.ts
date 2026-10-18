import { describe, expect, it } from 'vitest';
import data from '@/lib/cities.json';
import { cityValue, findCity, normCity, searchCities, type City } from '@/lib/cities';
import { cityPoint } from '@/lib/city-point';

const list = data.cities as City[];
const names = (q: string) => searchCities(list, q).map(c => c[0]);

describe('подсказки городов', () => {
  it('по первым буквам, крупные выше', () => {
    expect(names('хим')[0]).toBe('Химки');
    expect(names('моск')[0]).toBe('Москва');
    expect(names('Санкт')[0]).toBe('Санкт-Петербург');
    expect(searchCities(list, 'н').length).toBe(8);
  });

  it('регистр, ё, дефис и «г.» не мешают', () => {
    expect(normCity('Г. Королёв')).toBe('королев');
    expect(names('королев')[0]).toBe('Королёв');
    expect(names('ростов на')[0]).toBe('Ростов-на-Дону');
    expect(names('ПЕТЕРБ')).toContain('Санкт-Петербург');
  });

  it('по началу любого слова', () => {
    expect(names('новгород')).toEqual(expect.arrayContaining(['Нижний Новгород', 'Великий Новгород']));
  });

  it('одноимённые города — с регионом', () => {
    const crimea = list.find(c => c[0] === 'Белогорск' && c[1] === 'Респ. Крым')!;
    expect(cityValue(crimea, list)).toBe('Белогорск (Респ. Крым)');
    expect(cityValue(list.find(c => c[0] === 'Химки')!, list)).toBe('Химки');
    expect(findCity(list, 'Белогорск (Респ. Крым)')).toBe(crimea);
    expect(findCity(list, 'белогорск')?.[1]).toBe('Амурская обл.');
  });

  it('координаты базы — для любого города из списка', () => {
    expect(cityPoint('Москва')).not.toBeNull();
    expect(cityPoint('звенигород')).not.toBeNull();
    expect(cityPoint('Посёлок Заречный-12')).toBeNull();
    expect(cityPoint('')).toBeNull();
  });
});

describe('города: длинный ввод', () => {
  it('скобки без региона и мусор — без зависаний', () => {
    expect(findCity(list, 'Химки ()')).toBeNull();
    const t0 = performance.now();
    searchCities(list, 'х' + ' '.repeat(50000) + '!');
    findCity(list, ' '.repeat(50000) + 'x');
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
