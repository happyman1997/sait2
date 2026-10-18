import { describe, expect, it } from 'vitest';
import { cleanDeep, cleanText, PERSON_NAME } from '@/lib/text';

const ch = (...codes: number[]) => String.fromCharCode(...codes);
const ZWSP = ch(0x200b), RLO = ch(0x202e), SHY = ch(0xad), ACUTE = ch(0x301), GRAVE = ch(0x300);

describe('очистка текста', () => {
  it('убирает невидимые и управляющие знаки', () => {
    expect(cleanText('хо' + ZWSP + 'рошо' + SHY)).toBe('хорошо');
    expect(cleanText(RLO + 'Иван')).toBe('Иван');
    expect(cleanText('строка' + ch(7) + ch(0))).toBe('строка');
  });

  it('«Zalgo»: не больше одного диакритического знака на букву', () => {
    const zalgo = 'т' + ACUTE + GRAVE + ACUTE + GRAVE + 'екст';
    expect(cleanText(zalgo)).toBe('т' + ACUTE + 'екст');
    expect(cleanText('Пётр Йошкин')).toBe('Пётр Йошкин');
  });

  it('повтор знака — не длиннее 10, цифры не трогает', () => {
    expect(cleanText('!'.repeat(50))).toBe('!'.repeat(10));
    expect(cleanText('а'.repeat(30))).toBe('а'.repeat(10));
    expect(cleanText('100000000000000')).toBe('100000000000000');
  });

  it('переводы строк: не больше двух подряд; полноширинные буквы — обычные', () => {
    expect(cleanText('раз\n\n\n\n\nдва')).toBe('раз\n\nдва');
    expect(cleanText(ch(0xff48, 0xff55, 0xff59))).toBe('huy');
  });

  it('пароли и коды не трогает', () => {
    const body = cleanDeep({ name: 'Иван' + ZWSP, password: 'pa' + ZWSP + 'ss', code: '12' + ZWSP, job: { desc: ['a' + RLO] } });
    expect(body).toEqual({ name: 'Иван', password: 'pa' + ZWSP + 'ss', code: '12' + ZWSP, job: { desc: ['a'] } });
  });
});

describe('имя человека', () => {
  it.each(['Иван Петров', 'Анна-Мария Д’Арк', "O'Brien", 'Данияр С.', 'Иван'])('можно: %s', n => expect(PERSON_NAME.test(n)).toBe(true));
  it.each(['Иван 2', 'Иван 😎', 'Иван ✌', '★Иван★', '-Иван', 'Иван_Петров', 'Иван=Петров', 'Иван/Петров'])('нельзя: %s', n => expect(PERSON_NAME.test(n)).toBe(false));
});
