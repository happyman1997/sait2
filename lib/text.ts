// Очистка присланного текста от «ломающих» символов: невидимые и управляющие знаки, разворот текста справа налево,
// наслоения диакритики («Zalgo»), символы из частной области Юникода, длинные повторы одного знака.
// Сервер чистит так все строки из JSON-запросов (server/http.ts → readJson), кроме паролей и кодов.

/** Невидимые и управляющие направлением знаки: нулевой ширины, мягкий перенос, bidi, заполнители, теги, селекторы вариантов. */
export const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB]|\uDB40[\uDC00-\uDD7F]/g;

/** Полноширинные латиница, цифры и знаки (ＡＢＣ１２３) — в обычные. */
const fullwidth = (s: string) => s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ');

/**
 * Чистый текст: без невидимых и управляющих символов, без «частных» и неназначенных знаков Юникода, не больше
 * одного диакритического знака на букву, повтор одного символа — не длиннее 10 подряд. Переводы строк остаются
 * (не больше двух подряд), табуляция — пробел.
 */
export function cleanText(s: string): string {
  let t = fullwidth(s.normalize('NFC'))
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE, '')
    // Управляющие (кроме перевода строки), частная область, неназначенные, одиночные суррогаты.
    .replace(/[\p{Cc}\p{Co}\p{Cn}\p{Cs}]/gu, ch => (ch === '\n' ? ch : ''))
    // Диакритика: после буквы — не больше одного знака (й, ё уже собраны NFC; «Zalgo» — десятки знаков).
    .replace(/(\p{M})\p{M}+/gu, '$1');
  // Повтор одного знака (в том числе эмодзи): не длиннее 10. Цифры не трогаем — это суммы и номера.
  t = t.replace(/([^\p{M}\p{N}]\p{M}?)\1{10,}/gu, (m, unit: string) => unit.repeat(10));
  return t.replace(/[ \u00A0]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

/** Ключи, значения которых не трогаем: пароли, коды, токены — они должны дойти ровно такими, как введены. */
const RAW_KEY = /pass|code|token|ticket|secret|nonce|signature/i;

/** Чистит все строки в разобранном JSON (объекты и массивы — рекурсивно). */
export function cleanDeep<T>(v: T, key = ''): T {
  if (typeof v === 'string') return (RAW_KEY.test(key) ? v : cleanText(v)) as T;
  if (Array.isArray(v)) return v.map(x => cleanDeep(x, key)) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = cleanDeep(x, k);
    return out as T;
  }
  return v;
}

/** Имя человека: буквы любого алфавита, пробел, дефис, апостроф, точка; с буквы. */
export const PERSON_NAME = /^\p{L}[\p{L}\p{M} .'’-]*$/u;
