import { describe, expect, it } from 'vitest';
import { JOB_TYPES } from '@/lib/catalog';
import { liftSkills, matchSkill, normSkill, parseSkills, rankTypes, searchSkills, SYNONYMS } from '@/lib/skills';
import { sanitizeSignup } from '@/lib/validation';

const ids = (q: string, exclude: string[] = []) => searchSkills(q, exclude).map(h => h.id);

describe('навыки своими словами', () => {
  it('название и синоним целиком — вид работ', () => {
    expect(matchSkill('Уборка снега')).toBe('snow');
    expect(matchSkill(' Грузчик ')).toBe('load');
    expect(matchSkill('покос')).toBe('grass');
    expect(matchSkill('дворник')).toBe('street');
    expect(matchSkill('Колка дров')).toBeNull();
    expect(matchSkill('')).toBeNull();
  });

  it('у каждого названия и синонима — один вид работ', () => {
    expect(Object.keys(SYNONYMS).every(id => JOB_TYPES.some(t => t.id === id))).toBe(true);
    const seen = new Map<string, string>();
    for (const t of JOB_TYPES) {
      for (const q of [t.label, ...(SYNONYMS[t.id] || [])]) {
        const id = matchSkill(q);
        expect(id, q).toBe(t.id);
        expect(seen.get(normSkill(q)), q).toBeUndefined();
        seen.set(normSkill(q), t.id);
      }
    }
  });

  it('подсказки по началу слова и синонимам', () => {
    expect(ids('снег')[0]).toBe('snow');
    expect(ids('двор')).toContain('street');
    expect(ids('груз')).toEqual(['load']);
    expect(ids('уб')).toEqual(expect.arrayContaining(['snow', 'leaves', 'street']));
    expect(ids('снег', ['snow'])).not.toContain('snow');
    expect(ids('с')).toEqual([]);
  });

  it('через запятую — несколько; своё остаётся своим, повторы пропускаются', () => {
    expect(parseSkills('грузчик, колка дров; покос, Грузчик', { skills: [], customSkills: [] }))
      .toEqual({ skills: ['load', 'grass'], customSkills: ['Колка дров'] });
    expect(parseSkills('колка дров', { skills: ['load'], customSkills: ['Колка дров'] }))
      .toEqual({ skills: ['load'], customSkills: ['Колка дров'] });
  });

  it('сервер: свой навык, совпавший с видом работ, становится видом работ', () => {
    expect(liftSkills(['snow'], ['грузчик', 'колка дров'])).toEqual({ skills: ['snow', 'load'], customSkills: ['колка дров'] });
    const s = sanitizeSignup({ role: 'freelancer', freelancer: { skills: [], customSkills: ['Дворник', 'вывоз снега на прицепе'] } });
    expect(s.freelancer?.skills).toEqual(['street']);
    expect(s.freelancer?.customSkills).toEqual(['вывоз снега на прицепе']);
  });
});

describe('rankTypes — поиск видов работ (фильтр карты, «Какая работа?» на главной)', () => {
  const types = [
    { id: 'snow', label: 'Уборка снега', custom: false, count: 3 },
    { id: 'load', label: 'Погрузка и разгрузка', custom: false, count: 0 },
    { id: 'street', label: 'Уличная уборка', custom: false, count: 7 },
    { id: 'grass', label: 'Покос травы', custom: false, count: 1 },
    { id: 'c_firewood', label: 'Колка дров', custom: true, count: 2 },
    { id: 'c_pool', label: 'Чистка бассейна', custom: true, count: 1 }
  ];
  const ids = (q: string, exclude: string[] = []) => rankTypes(types, q, exclude).map(t => t.id);

  it('как работу называют: «грузчик», «дворник», «снег»', () => {
    expect(ids('грузчик')).toEqual(['load']);
    expect(ids('дворник')).toEqual(['street']);
    expect(ids('снег')[0]).toBe('snow');
  });
  it('свои виды работодателей — по названию, с любого слова и с середины слова от трёх букв', () => {
    expect(ids('колка')).toEqual(['c_firewood']);
    expect(ids('дров')).toEqual(['c_firewood']);
    expect(ids('бассейн')).toEqual(['c_pool']);
    expect(ids('ассейн')).toEqual(['c_pool']);
    // Другое окончание: «дрова» — «Колка дров», «бассейны» — «Чистка бассейна».
    expect(ids('дрова')).toEqual(['c_firewood']);
    expect(ids('бассейны')).toEqual(['c_pool']);
  });
  it('совпавшие началом — выше, при равенстве — где больше заказов', () => {
    // «уб»: «Уборка снега» — началом названия; «Уличная уборка» — началом второго слова.
    expect(ids('уб')).toEqual(['snow', 'street']);
    expect(ids('уборка')).toEqual(['snow', 'street']);
  });
  it('пустой запрос — самые частые по заказам; выбранные не предлагаются; регистр и ё не важны', () => {
    expect(ids('')).toEqual(['street', 'snow', 'c_firewood', 'grass', 'c_pool', 'load']);
    expect(ids('', ['street', 'snow'])[0]).toBe('c_firewood');
    expect(ids('ГРУЗЧИК')).toEqual(['load']);
    expect(ids('Покос')).toEqual(['grass']);
  });
  it('незнакомое — пусто', () => {
    expect(ids('вязание')).toEqual([]);
    expect(ids('ок')).toEqual([]);
  });
});
