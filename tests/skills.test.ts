import { describe, expect, it } from 'vitest';
import { JOB_TYPES } from '@/lib/catalog';
import { liftSkills, matchSkill, normSkill, parseSkills, searchSkills, SYNONYMS } from '@/lib/skills';
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
      .toEqual({ skills: ['load', 'grass'], customSkills: ['колка дров'] });
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
