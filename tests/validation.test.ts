import { describe, expect, it } from 'vitest';
import { GEAR, GEAR_FOR, JOB_TYPE_IDS, NO_GEAR } from '@/lib/catalog';
import { contactsMessage, contactsMissing, EMAIL_RE, LOGIN_RE, loginBase, parseIdentifier, sanitizeSignup, unreachableEmail } from '@/lib/validation';

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

describe('почта, на которую письма не уходят', () => {
  it.each(['ivan@proton.me', 'Ivan@ProtonMail.com', 'ivan@protonmail.ch', 'ivan@pm.me'])('Proton: %s', e => {
    expect(unreachableEmail(e)).toBe(true);
    expect(contactsMissing({ name: 'Иван Петров', email: e, login: 'ivan_p', password: 'Test-pass-123', city: 'Москва' })).toEqual(['email']);
    expect(contactsMessage('email', e)).toMatch(/Proton/);
  });

  it.each(['ivan@gmail.com', 'ivan@mail.ru', 'ivan@proton.me.example.com', 'pm.me@gmail.com'])('остальные — можно: %s', e => {
    expect(unreachableEmail(e)).toBe(false);
  });
});

describe('логин из имени', () => {
  it('имя и первая буква фамилии латиницей; коротко — с приставкой user', () => {
    expect(loginBase('Данияр Сапаров')).toBe('daniyar_s');
    expect(loginBase('  Айгуль   Тлеубаева ')).toBe('aygul_t');
    expect(loginBase('Щукин-Ёлкин Пётр')).toBe('schukinelkin_p');
    expect(loginBase('Константин Константинопольский')).toBe('konstantin_k');
    expect(loginBase('Ян')).toBe('yan');
    expect(loginBase('Ли')).toBe('user_li');
    expect(loginBase('John Smith')).toBe('john_s');
    for (const n of ['Данияр Сапаров', 'Ян', 'Константин Константинопольский', 'О Ли']) expect(loginBase(n) + '99').toMatch(LOGIN_RE);
  });

  it('логин в анкете необязателен, но вписанный — по правилам', () => {
    const c = { name: 'Иван Петров', email: 'ivan@mail.ru', password: 'Test-pass-123', city: 'Москва' };
    expect(contactsMissing(c)).toEqual([]);
    expect(contactsMissing({ ...c, login: 'да' })).toEqual(['login']);
  });
});
