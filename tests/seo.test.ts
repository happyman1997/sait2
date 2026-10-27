import { describe, expect, it } from 'vitest';
import { cityPhrase, inCity, ldJson, seasonOf, slugify, WORK_INFO, WORK_PAGES, WORK_SEASONS, workById, workBySlug } from '@/lib/seo';

describe('страницы для поисковиков', () => {
  it('адрес страницы — транслитом', () => {
    expect(slugify('Уборка снега')).toBe('uborka-snega');
    expect(slugify('Вывоз мусора и хлама')).toBe('vyvoz-musora-i-hlama');
    expect(slugify('Стрижка кустов и деревьев')).toBe('strizhka-kustov-i-derevev');
    expect(slugify('Нижний Новгород')).toBe('nizhniy-novgorod');
    expect(slugify('Санкт-Петербург')).toBe('sankt-peterburg');
  });

  it('у каждого вида работ — свой адрес и свой текст', () => {
    expect(new Set(WORK_PAGES.map(w => w.slug)).size).toBe(WORK_PAGES.length);
    for (const w of WORK_PAGES) {
      expect(WORK_INFO[w.id]?.about.length).toBeGreaterThan(80);
      expect(workBySlug(w.slug)?.id).toBe(w.id);
    }
    expect(workBySlug('net-takogo')).toBeNull();
  });

  it('город — в предложном падеже, а где правило не подходит — без склонения', () => {
    expect(inCity('Москва')).toBe('в Москве');
    expect(inCity('Казань')).toBe('в Казани');
    expect(inCity('Химки')).toBe('в Химках');
    expect(inCity('Люберцы')).toBe('в Люберцах');
    expect(inCity('Красногорск')).toBe('в Красногорске');
    expect(inCity('Ярославль')).toBe('в Ярославле');
    expect(inCity('Сочи')).toBe('в Сочи');
    expect(inCity('Нижний Новгород')).toBe('в Нижнем Новгороде');
    expect(inCity('Одинцово')).toBeNull();
    expect(cityPhrase('Подработка', 'Одинцово')).toBe('Подработка — Одинцово');
    expect(cityPhrase('Подработка', 'Москва')).toBe('Подработка в Москве');
  });

  it('разметка schema.org не закрывает тег script текстом заказа', () => {
    const s = ldJson({ description: 'Вынести хлам </script><script>alert(1)</script>' });
    expect(s).not.toContain('</script>');
    expect(JSON.parse(s).description).toContain('</script>');
  });
});

describe('страница для заказчиков: сезон', () => {
  it('сезон по месяцу; в последний месяц сезона — и следующий («скоро»)', () => {
    expect(seasonOf('2026-10-27')).toEqual({ now: 'Осень', soon: 'Зима' });
    expect(seasonOf('2026-11-05')).toEqual({ now: 'Зима', soon: null });
    expect(seasonOf('2027-01-15')).toEqual({ now: 'Зима', soon: null });
    expect(seasonOf('2027-03-10')).toEqual({ now: 'Зима', soon: 'Весна' });
    expect(seasonOf('2027-05-20')).toEqual({ now: 'Весна', soon: 'Лето' });
    expect(seasonOf('2027-07-01')).toEqual({ now: 'Лето', soon: null });
    expect(seasonOf('2027-08-31')).toEqual({ now: 'Лето', soon: 'Осень' });
  });

  it('в сезонах — только виды работ из каталога, без повторов', () => {
    const ids = WORK_SEASONS.flatMap(s => s[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(workById(id), id).not.toBeNull();
  });
});
