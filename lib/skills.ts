// Навыки исполнителя, вписанные своими словами: подсказки из видов работ площадки и узнавание синонимов
// («дворник» → «Уличная уборка», «грузчик» → «Погрузка и разгрузка»). Вид работ из каталога ставит человека
// выше в оповещениях о сменах этого вида (server/jobs.ts → notifyNearby); остальное остаётся своим навыком.
// Общий модуль для клиента (поле навыков) и сервера (разбор анкеты).
import { JOB_TYPES } from './catalog';

/** Как ещё называют вид работ — то, что люди пишут сами. */
export const SYNONYMS: Record<string, string[]> = {
  snow: ['снег', 'чистка снега', 'расчистка снега', 'снегоуборка', 'убрать снег', 'чистить снег', 'кидать снег', 'уборка снега во дворе'],
  ice: ['наледь', 'лед', 'колка льда', 'скалывание льда', 'сколка льда', 'сбить лед'],
  roof: ['крыша', 'кровля', 'снег с крыши', 'чистка крыши', 'сосульки', 'сбить сосульки', 'промальп', 'высотные работы'],
  salt: ['реагент', 'подсыпка', 'посыпка', 'посыпать песком', 'песок'],
  thaw: ['ливневка', 'водосток', 'водостоки', 'прочистка ливневки'],
  green: ['посадка', 'посадка деревьев', 'посадка цветов', 'рассада', 'клумбы', 'цветники', 'ландшафт'],
  spring: ['субботник', 'весенняя уборка'],
  facade: ['мойка окон', 'мытье окон', 'окна', 'фасад', 'мойка фасада', 'витрины'],
  grass: ['покос', 'косить', 'косить траву', 'кошение', 'стрижка газона', 'сенокос', 'трава'],
  trim: ['стрижка кустов', 'обрезка', 'обрезка деревьев', 'кусты', 'живая изгородь', 'кронирование', 'спил', 'спил деревьев', 'валка деревьев', 'арборист'],
  water: ['полив', 'поливать', 'полив сада'],
  paint: ['покраска', 'маляр', 'малярные работы', 'покраска забора', 'красить забор'],
  dacha: ['участок', 'дача', 'огород', 'садовник', 'сад', 'перекопка', 'вскопать', 'копать грядки'],
  leaves: ['листва', 'листья', 'сгребать листья'],
  harvest: ['урожай', 'сбор ягод', 'сбор яблок', 'копать картошку'],
  winterize: ['укрытие растений', 'утепление', 'подготовка сада к зиме'],
  street: ['дворник', 'уборка улиц', 'уборка территории', 'уборщик территории', 'подметать', 'уборка двора'],
  trash: ['мусор', 'вывоз мусора', 'вынос мусора', 'хлам', 'вывоз хлама', 'расхламление', 'уборка подвала'],
  load: ['грузчик', 'погрузка', 'разгрузка', 'переезд', 'такелаж', 'перенос мебели', 'разнорабочий']
};

/** Знаки по краям вписанного: «Грузчик!», «(покос)». */
const EDGE = ' .,;:!?«»"\'()-';

/** Для сравнения: регистр, ё/е, лишние пробелы и знаки по краям не важны. Без регулярных выражений по краям — за линейное время. */
export function normSkill(s: string): string {
  const t = s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  let a = 0, b = t.length;
  while (a < b && EDGE.includes(t[a])) a++;
  while (b > a && EDGE.includes(t[b - 1])) b--;
  return t.slice(a, b);
}

const NAMES: { id: string; label: string; names: string[] }[] = JOB_TYPES.map(t => ({
  id: t.id, label: t.label, names: [normSkill(t.label), ...(SYNONYMS[t.id] || []).map(normSkill)]
}));

/** Вид работ, если вписанное — его название или синоним целиком («Покос», «грузчик»); иначе null. */
export function matchSkill(text: string): string | null {
  const q = normSkill(text);
  if (!q) return null;
  return NAMES.find(n => n.names.includes(q))?.id ?? null;
}

/** Подсказки по вписанному: сначала по началу названия, потом по началу синонима или любого слова. */
export function searchSkills(query: string, exclude: string[] = [], limit = 6): { id: string; label: string }[] {
  const q = normSkill(query);
  if (q.length < 2) return [];
  const words = (s: string) => s.split(/[\s-]+/);
  const hits: [number, { id: string; label: string }][] = [];
  for (const n of NAMES) {
    if (exclude.includes(n.id)) continue;
    const rank = n.names[0].startsWith(q) ? 0
      : n.names.some(x => x.startsWith(q)) ? 1
      : n.names.some(x => words(x).some(w => w.startsWith(q))) ? 2 : -1;
    if (rank >= 0) hits.push([rank, { id: n.id, label: n.label }]);
  }
  return hits.sort((a, b) => a[0] - b[0]).slice(0, limit).map(h => h[1]);
}

/**
 * Вписанное через запятую — на виды работ и свои навыки: «грузчик, колка дров» → ['load'] и ['колка дров'].
 * Повторы и уже отмеченное пропускаются.
 */
export function parseSkills(text: string, have: { skills: string[]; customSkills: string[] }): { skills: string[]; customSkills: string[] } {
  const skills = [...have.skills], customSkills = [...have.customSkills];
  for (const part of text.split(/[,;\n]+/)) {
    const v = part.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!v) continue;
    const id = matchSkill(v);
    if (id) { if (!skills.includes(id)) skills.push(id); continue; }
    if (!customSkills.some(c => normSkill(c) === normSkill(v))) customSkills.push(v);
  }
  return { skills, customSkills };
}

/** Свои навыки, совпавшие с видом работ целиком, — в виды работ (сервер: анкета могла прийти текстом). */
export function liftSkills(skills: string[], customSkills: string[]): { skills: string[]; customSkills: string[] } {
  const out = { skills: [...skills], customSkills: [] as string[] };
  for (const c of customSkills) {
    const id = matchSkill(c);
    if (!id) out.customSkills.push(c);
    else if (!out.skills.includes(id)) out.skills.push(id);
  }
  return out;
}
