// Яндекс Метрика — только с согласия посетителя (окно о статистике, components/Analytics.tsx). Номер счётчика —
// из настроек сервера (YANDEX_METRIKA_ID); без него нет ни счётчика, ни окна. Вебвизор и карта кликов выключены:
// в Яндекс уходят адрес страницы без служебных параметров, источник перехода и цели — ключевые действия ниже.

export const STATS_KEY = 'arena.stats';
export const STATS_EVENT = 'arena:stats';
export const TAG_URL = 'https://mc.yandex.ru/metrika/tag.js';
const LANDING_KEY = 'arena.landing';

/** Цели — их же создают в Метрике: «Цели» → «JavaScript-событие» с таким идентификатором (DEPLOY.md, раздел 14). */
export type Goal = 'signup_freelancer' | 'signup_employer' | 'job_created' | 'apply' | 'hire' | 'app_installed';
export type StatsChoice = 'yes' | 'no' | null;

type Ym = ((...a: unknown[]) => void) & { a?: unknown[]; l?: number };
declare global { interface Window { ym?: Ym } }

let counter = 0; // номер запущенного счётчика; 0 — не запущен
let memChoice: StatsChoice = null; // приватный режим без localStorage — решение живёт до перезагрузки

export function statsChoice(): StatsChoice {
  try {
    const v = localStorage.getItem(STATS_KEY);
    return v === 'yes' || v === 'no' ? v : memChoice;
  } catch { return memChoice; }
}

export function setStatsChoice(v: 'yes' | 'no') {
  memChoice = v;
  try { localStorage.setItem(STATS_KEY, v); } catch { /* приватный режим */ }
  window.dispatchEvent(new Event(STATS_EVENT));
}

// В адресе для Метрики — только метки рекламы и номер открытого заказа. Остальные параметры служебные (билет входа
// через Яндекс ID, режим формы) и в статистику не уходят.
const KEEP = /^(utm_[a-z]+|yclid|ysclid|job)$/;
export function cleanUrl(href: string): string {
  try {
    const u = new URL(href);
    for (const k of [...new Set(u.searchParams.keys())]) if (!KEEP.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.toString();
  } catch { return ''; }
}

/** Откуда пришли: чужой сайт — как есть, свой — без служебных параметров. */
export function cleanReferrer(ref: string, origin: string): string {
  try { return new URL(ref).origin === origin ? cleanUrl(ref) : ref; } catch { return ''; }
}

/** Цель Метрики — ключевое действие посетителя. Без согласия или без счётчика — ничего. */
export function goal(name: Goal) {
  if (counter && window.ym) window.ym(counter, 'reachGoal', name);
}

/** Просмотр страницы (сайт одностраничный: переходы внутри него Метрика сама не видит). */
export function hit(url: string, referer?: string) {
  if (counter && window.ym) window.ym(counter, 'hit', url, { title: document.title, ...(referer ? { referer } : {}) });
}

/** Первая страница визита и откуда на неё пришли — до решения посетителя: метки рекламы есть только в её адресе.
 *  Хранится в этой вкладке и никуда не уходит, пока статистику не разрешили. */
export function rememberLanding() {
  try {
    if (!sessionStorage.getItem(LANDING_KEY)) {
      sessionStorage.setItem(LANDING_KEY, JSON.stringify({ url: cleanUrl(location.href), ref: cleanReferrer(document.referrer, location.origin), sent: false }));
    }
  } catch { /* приватный режим */ }
}

/** Подключает счётчик (один раз) и отправляет первые просмотры; возвращает адрес текущей страницы. */
export function startMetrika(id: number): string {
  const here = cleanUrl(location.href);
  if (counter) return here;
  counter = id;
  // Очередь вызовов до загрузки tag.js — как в коде счётчика из Метрики.
  if (!window.ym) {
    const ym: Ym = function () { (ym.a = ym.a || []).push(arguments); } as Ym; // eslint-disable-line prefer-rest-params
    ym.l = Date.now();
    window.ym = ym;
  }
  const s = document.createElement('script');
  s.async = true;
  s.src = TAG_URL;
  document.head.appendChild(s);
  // defer — просмотры отправляем сами: с очищенным адресом и с переходами внутри сайта.
  window.ym(id, 'init', { defer: true, clickmap: false, trackLinks: true, accurateTrackBounce: true, webvisor: false, trackHash: false });

  let land: { url: string; ref: string; sent: boolean } | null = null;
  try { land = JSON.parse(sessionStorage.getItem(LANDING_KEY) || 'null'); } catch { /* нет хранилища */ }
  if (land && !land.sent) {
    // Разрешили не на первой странице — сначала она (с метками рекламы), потом текущая.
    hit(land.url, land.ref);
    try { sessionStorage.setItem(LANDING_KEY, JSON.stringify({ ...land, sent: true })); } catch { /* нет хранилища */ }
    if (here !== land.url) hit(here, land.url);
  } else {
    hit(here, cleanReferrer(document.referrer, location.origin));
  }
  return here;
}

/** Отзыв согласия: стираем cookie и записи Метрики в браузере. Сам счётчик перестаёт работать после перезагрузки. */
export function forgetMetrika() {
  const host = location.hostname;
  const domains = ['', host, '.' + host, '.' + host.split('.').slice(-2).join('.')];
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (!name.startsWith('_ym')) continue;
    for (const d of domains) document.cookie = name + '=; Max-Age=0; path=/' + (d ? '; domain=' + d : '');
  }
  for (const store of [localStorage, sessionStorage]) {
    try { for (const k of Object.keys(store)) if (k.startsWith('_ym')) store.removeItem(k); } catch { /* нет хранилища */ }
  }
  return counter !== 0;
}
