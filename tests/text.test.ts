import { describe, expect, it } from 'vitest';
import { cleanDeep, cleanText, MAX_STRING, PERSON_NAME } from '@/lib/text';

const ch = (...codes: number[]) => String.fromCharCode(...codes);
const ZWSP = ch(0x200b), RLO = ch(0x202e), SHY = ch(0xad), ACUTE = ch(0x301), GRAVE = ch(0x300), NBSP = ch(0xa0);
const ms = (f: () => unknown) => { const t0 = performance.now(); f(); return performance.now() - t0; };

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

  it('пробелы в конце строк убирает', () => {
    expect(cleanText('раз  ' + NBSP + '\nдва')).toBe('раз\nдва');
  });

  it('«__proto__» из JSON не подменяет прототип', () => {
    const body = cleanDeep(JSON.parse('{"__proto__": {"role": "admin"}, "name": "Иван"}')) as Record<string, unknown>;
    expect(body.role).toBeUndefined();
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
  });

  it('пропуск на объект («passWhom») — обычный текст, его чистим', () => {
    expect(cleanDeep({ passWhom: 'Иван' + ZWSP })).toEqual({ passWhom: 'Иван' });
  });

  it('строки длиннее ' + MAX_STRING + ' знаков обрезает до проверок', () => {
    expect((cleanDeep({ desc: 'абвгд'.repeat(50000) }) as { desc: string }).desc.length).toBe(MAX_STRING);
  });

  // Выражения, которые на особой строке думают за квадрат, подвешивают сервер одним запросом.
  it.each([
    ['пробел и неразрывный пробел', (' ' + NBSP).repeat(125000)],
    ['пробелы без перевода строки', ' '.repeat(250000)],
    ['диакритика', 'a' + ACUTE.repeat(250000)],
    ['буква с диакритикой', ('a' + ACUTE).repeat(125000)],
    ['переводы строк', ' \n'.repeat(125000)],
    ['почти повтор', 'aaaaaaaaab'.repeat(25000)]
  ])('быстро на тяжёлой строке: %s', (_, s) => {
    expect(ms(() => cleanText(s))).toBeLessThan(200);
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
