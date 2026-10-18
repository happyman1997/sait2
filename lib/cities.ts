// Города России для подсказок в поле «Город»: поиск по первым буквам, однозначное название, координаты.
// Сам список — lib/cities.json (≈90 КБ): браузер грузит его отдельным файлом при первом фокусе на поле,
// сервер — статически (lib/city-point.ts). Здесь — только функции над списком, без самого списка.

/** Название, регион («Московская обл.», для Москвы и Петербурга — пусто), широта, долгота, население. */
export type City = [name: string, region: string, lat: number, lng: number, population: number];

/** Для сравнения: регистр, ё/е, дефисы и лишние пробелы не важны; «г.», «город» в начале — тоже. */
export function normCity(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[-‐–—]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(г\.?|город)\s+/, '');
}

const dupes = new WeakMap<City[], Set<string>>();
/** Названия, которые встречаются в разных регионах (Белогорск, Донецк…). */
function dupeNames(list: City[]): Set<string> {
  let d = dupes.get(list);
  if (!d) {
    const seen = new Set<string>();
    d = new Set();
    for (const c of list) { const n = normCity(c[0]); if (seen.has(n)) d.add(n); else seen.add(n); }
    dupes.set(list, d);
  }
  return d;
}

/** Что записать в поле: название, а если такое есть в нескольких регионах — с регионом: «Белогорск (Респ. Крым)». */
export function cityValue(c: City, list: City[]): string {
  return dupeNames(list).has(normCity(c[0])) && c[1] ? c[0] + ' (' + c[1] + ')' : c[0];
}

/** Подсказки по введённому: сначала точное совпадение и начало названия, потом начало любого слова; крупные — выше. */
export function searchCities(list: City[], query: string, limit = 8): City[] {
  // Регион в скобках не ищем: «Белогорск (Респ. Крым)» → «белогорск».
  const q = normCity(query.split('(')[0]);
  if (!q) return [];
  const hits: [number, City][] = [];
  for (const c of list) {
    const n = normCity(c[0]);
    const rank = n === q ? 0 : n.startsWith(q) ? 1 : n.split(' ').some(w => w.startsWith(q)) ? 2 : -1;
    if (rank >= 0) hits.push([rank, c]);
  }
  return hits.sort((a, b) => a[0] - b[0] || b[1][4] - a[1][4]).slice(0, limit).map(h => h[1]);
}

/** Город по записанному значению («Химки», «химки», «Белогорск (Респ. Крым)»); из одноимённых — самый крупный. */
export function findCity(list: City[], value: string): City | null {
  // «Название (Регион)» — без регулярного выражения: на длинной строке пробелов оно перебирало бы за квадрат.
  const v = value.trim();
  const open = v.indexOf('(');
  const m = open >= 0 && v.endsWith(')') && v.length - open > 2 ? [v, v.slice(0, open), v.slice(open + 1, -1)] : null;
  const name = normCity(m ? m[1] : value);
  if (!name) return null;
  let best: City | null = null;
  for (const c of list) {
    if (normCity(c[0]) !== name) continue;
    if (m && normCity(c[1]) === normCity(m[2])) return c;
    if (!best || c[4] > best[4]) best = c;
  }
  return best;
}
