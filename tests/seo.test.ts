import { describe, expect, it } from 'vitest';
import { cityPhrase, inCity, ldJson, slugify, WORK_INFO, WORK_PAGES, workBySlug } from '@/lib/seo';

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
