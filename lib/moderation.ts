// Модерация текста: запрещённые слова во всех текстовых полях.
// Один модуль и для клиента (попап «Так написать нельзя»), и для сервера (обязательная повторная проверка).
// Алгоритм перенесён из прототипа: normBad() / badWordIn() / BAD_WORDS / HARD_ROOTS.

export type BadCategory = 'нецензурная лексика' | 'оскорбление' | 'признак мошенничества';

// Стоп-слова: корни после нормализации (латиница-двойники, цифры, ё→е, звёздочки).
export const BAD_WORDS: { cat: BadCategory; re: RegExp }[] = [
  { cat: 'нецензурная лексика', re: /(?<![а-я])(на|по|от|ни|до|за)?ху[йеяи]/ },
  { cat: 'нецензурная лексика', re: /пизд/ },
  { cat: 'нецензурная лексика', re: /(?<![а-я])(вы|за|у|по|на|от|до|об|раз|разъ|съ|въ|подъ)?еб(а|у|л|н|и|е|о|ы)/ },
  { cat: 'нецензурная лексика', re: /бляд|(?<![а-я])блят|(?<![а-я])бля(?![а-я])/ },
  { cat: 'нецензурная лексика', re: /(?<![а-я])(залуп|дроч|шлюх|гандон|гондон|долбо[её]б|долба[её]б)/ },
  { cat: 'оскорбление', re: /(?<![а-я])(мудак|мудил|пидор|пидар|пидр|педик|дебил|идиот|сук(а|и|у|е|ой)(?![а-я])|урод(?![а-я])|уроды|уродин)/ },
  { cat: 'признак мошенничества', re: /без документов|оплата вперед|залог за (форм|спецодежд|инвентар|пропуск)/ }
];

// Корни, которые ловим и внутри слова — для склеенных ников (snowhuy, суперсука).
// Исключения против ложных срабатываний: застрахуйте, оскорблять, употреблять.
export const HARD_ROOTS = /(?<!стра)(?<!ст)ху[йяе](?!т)|пизд|бляд|(?<![реу])блят|сука(?![а-я])|сучк|пидор|пидар|долб[ао][её]б|мудак|мудил|заеб|уеб[аок]|ебан[уыа]/;

const VISUAL: Record<string, string> = {
  a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в',
  '0': 'о', '3': 'з', '6': 'б', '@': 'а'
};
const MULTI: [string, string][] = [
  ['shch', 'щ'], ['sch', 'щ'], ['yo', 'е'], ['jo', 'е'], ['zh', 'ж'], ['kh', 'х'], ['ch', 'ч'], ['sh', 'ш'],
  ['ts', 'ц'], ['yu', 'ю'], ['ju', 'ю'], ['ya', 'я'], ['ja', 'я'], ['ye', 'е']
];
const PHONETIC: Record<string, string> = {
  a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и', j: 'й', y: 'й', k: 'к', l: 'л', m: 'м',
  n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', f: 'ф', h: 'х', x: 'х', c: 'к', q: 'к', w: 'в',
  '0': 'о', '1': 'и', '3': 'з', '6': 'б', '@': 'а'
};

/** Четыре варианта текста: «похожие буквы» и фонетический транслит, каждый — склеенный и разорванный по * . _ - */
export function normBad(text: unknown): string[] {
  const low = String(text ?? '').toLowerCase().replace(/ё/g, 'е');
  const v1 = low.replace(/[aeopcxykmthb036@]/g, ch => VISUAL[ch] || ch);
  let v2 = low;
  for (const [k, r] of MULTI) v2 = v2.split(k).join(r);
  v2 = v2.replace(/[a-z0-9@]/g, ch => PHONETIC[ch] || ch);
  const glue = (t: string) => t.replace(/х\*+й/g, 'хуй').replace(/(?<=[а-я])[*._\-]+(?=[а-я])/g, '');
  const split = (t: string) => t.replace(/х\*+й/g, 'хуй').replace(/[*._\-]+/g, ' ');
  return [glue(v1), glue(v2), split(v1), split(v2)];
}

/** Категория нарушения или null, если текст чистый. */
export function badWordIn(text: unknown): BadCategory | null {
  if (text == null || text === '') return null;
  const vs = normBad(text);
  const hit = BAD_WORDS.find(w => vs.some(t => w.re.test(t)));
  if (hit) return hit.cat;
  if (vs.some(t => HARD_ROOTS.test(t))) return 'нецензурная лексика';
  return null;
}

/** Какие слова (1–3 подряд) дали срабатывание — чтобы показать место в попапе. */
export function badSpan(text: unknown): { before: string; hit: string; after: string } {
  const s = String(text ?? '');
  const parts = s.split(/(\s+)/);
  const idx = parts.map((_, i) => i).filter(i => parts[i].trim());
  for (let n = 1; n <= 3; n++) {
    for (let k = 0; k + n <= idx.length; k++) {
      const from = idx[k], to = idx[k + n - 1];
      if (badWordIn(parts.slice(from, to + 1).join(''))) {
        return { before: parts.slice(0, from).join(''), hit: parts.slice(from, to + 1).join(''), after: parts.slice(to + 1).join('') };
      }
    }
  }
  return { before: '', hit: s, after: '' };
}

/** Мат и оскорбления маскируются: с••••а. */
export function maskBad(word: string, cat: BadCategory): string {
  if (!/лексика|оскорбл/.test(cat)) return word;
  return word.replace(/[^\s]+/g, x => x.length <= 2 ? x.charAt(0) + '•' : x.charAt(0) + '•'.repeat(x.length - 2) + x.charAt(x.length - 1));
}

export const BAD_WHY: Record<BadCategory, string> = {
  'нецензурная лексика': 'Мат запрещён во всех полях: в заказах, чате, профиле, отзывах и никнеймах — в том числе латиницей и транслитом.',
  'оскорбление': 'Оскорбления в адрес людей запрещены правилами платформы.',
  'признак мошенничества': 'Такие формулировки часто используют мошенники — их нельзя публиковать.'
};

export type ModerationHit = { field: string; label: string; category: BadCategory };

/**
 * Проверяет набор полей. Ключ — машинное имя поля, label — человекочитаемое («Где» в попапе).
 * Значения-массивы проверяются поэлементно.
 */
export function findBadField(fields: { field: string; label: string; value: unknown }[]): ModerationHit | null {
  for (const f of fields) {
    const values = Array.isArray(f.value) ? f.value : [f.value];
    for (const v of values) {
      if (typeof v !== 'string') continue;
      const cat = badWordIn(v);
      if (cat) return { field: f.field, label: f.label, category: cat };
    }
  }
  return null;
}
