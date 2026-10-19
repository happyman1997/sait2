import { describe, expect, it } from 'vitest';
import { GEAR, GEAR_FOR, JOB_TYPE_IDS, NO_GEAR } from '@/lib/catalog';
import { EMAIL_RE, parseIdentifier, sanitizeSignup } from '@/lib/validation';

describe('почта', () => {
  it.each(['ivan@mail.ru', 'ivan.petrov+work@yandex.ru', 'a@xn--80a1acny.xn--p1ai', 'a_b@sub.domain.co.uk'])('подходит: %s', e => {
    expect(EMAIL_RE.test(e)).toBe(true);
  });

  it.each(['ivan', 'ivan@mail', 'ivan@mail..ru', 'ivan@.mail.ru', 'ivan@mail.ru.', 'iv an@mail.ru', 'a@b@c.ru'])('не подходит: %s', e => {
    expect(EMAIL_RE.test(e)).toBe(false);
  });

  // Прежнее выражение на такой строке думало секундами — запрос на вход без аккаунта подвешивал сервер.
  it('длинная строка «a@a.a.a.…» проверяется мгновенно', () => {
    const s = 'a@' + 'a.'.repeat(100000) + '@';
    const t0 = performance.now();
    expect(EMAIL_RE.test(s)).toBe(false);
    expect(parseIdentifier(s).kind).toBe('invalid');
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('инвентарь', () => {
  it('«Ничего нет» вместе с отмеченным инвентарём не сохраняется', () => {
    const s = sanitizeSignup({ role: 'freelancer', freelancer: { gear: ['Лопата и скребок', NO_GEAR] } });
    expect(s.freelancer?.gear).toEqual(['Лопата и скребок']);
    expect(sanitizeSignup({ role: 'freelancer', freelancer: { gear: [NO_GEAR] } }).freelancer?.gear).toEqual([NO_GEAR]);
  });

  it('подсказки инвентаря к навыкам — только из каталога', () => {
    for (const [skill, gear] of Object.entries(GEAR_FOR)) {
      expect(JOB_TYPE_IDS).toContain(skill);
      for (const g of gear) expect(GEAR).toContain(g);
    }
  });
});
