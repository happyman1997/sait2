// Геокодер: в продакшене — DaData (российский сервис адресов ФИАС/ГАР, бесплатно до 10 000 запросов в сутки;
// ключ — DADATA_API_KEY). Без ключа — Nominatim-совместимый API по GEOCODER_URL (публичный OSM — только для разработки).
// Запросы идут с сервера: сервису уходят только адрес или координаты — без IP, cookie и данных пользователя.
import { config } from './config';
import { AppError } from './errors';

export type GeoHit = { lat: number; lng: number; label: string; sub: string; district: string };

type NominatimHit = {
  lat: string; lon: string; display_name?: string;
  address?: Record<string, string>;
};

const TIMEOUT_MS = 5000;
const cache = new Map<string, { at: number; value: unknown }>();
const CACHE_MS = 24 * 3600_000;
const CACHE_MAX = 2000;

async function getJson(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<unknown> {
  const key = url + ' ' + (init.body || '');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method || 'GET', body: init.body, signal: ctl.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': config.geocoderUserAgent(), 'Accept-Language': 'ru', ...init.headers }
    });
    if (!res.ok) {
      // Причину — в журнал: неверный ключ (401/403) или исчерпан суточный лимит видны только здесь.
      console.error(`[geo] ${new URL(url).host} ответил ${res.status}`);
      throw new AppError(502, 'Геокодер недоступен — поставьте метку кликом по карте.');
    }
    const value = await res.json();
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    if (e instanceof AppError) throw e;
    const aborted = (e as Error).name === 'AbortError';
    throw new AppError(504, aborted ? 'Геокодер не ответил за 5 секунд — поставьте метку кликом по карте.' : 'Геокодер недоступен — поставьте метку кликом по карте.');
  } finally {
    clearTimeout(t);
  }
}

function toHit(h: NominatimHit): GeoHit {
  const a = h.address || {};
  const street = a.road || a.pedestrian || a.square || a.suburb || a.neighbourhood || '';
  const city = a.city || a.town || a.village || a.municipality || a.county || '';
  const house = a.house_number ? ', ' + a.house_number : '';
  const short = street ? (city && city !== street ? city + ', ' : '') + street + house : '';
  const name = String(h.display_name || '');
  return {
    lat: parseFloat(h.lat),
    lng: parseFloat(h.lon),
    label: short || name.split(',').slice(0, 3).join(',').trim(),
    sub: name.split(',').slice(-3, -1).join(',').trim(),
    district: city || a.state || ''
  };
}

// Зона работы сайта: Россия, а также Республика Крым, Севастополь, ДНР, ЛНР, Запорожская и Херсонская области.
// В данных OpenStreetMap адреса этих регионов отнесены к коду страны ua, поэтому ищем по ru и ua, а результаты
// с кодом ua оставляем только из этих регионов (по названию региона или города на русском).
const EXTRA_REGIONS = /Крым|Севастопол|Донецк|Луганск|Запорож|Херсон/i;

export function inZone(a: Record<string, string> | undefined): boolean {
  if (!a) return false;
  // Код страны отдаёт Nominatim; если его нет (другой совместимый геокодер) — по названию страны, иначе не отсеиваем.
  const code = a.country_code || (a.country === 'Россия' ? 'ru' : a.country === 'Украина' ? 'ua' : a.country ? 'other' : '');
  if (code === 'ru' || code === '') return true;
  if (code !== 'ua') return false;
  return EXTRA_REGIONS.test([a.state, a.region, a.province, a.city].filter(Boolean).join(' '));
}

// ───────────────────────── DaData ─────────────────────────

const DADATA = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/';

type DadataSuggestion = { value?: string; data?: Record<string, string | null | undefined> | null };

/** Подсказка DaData → точка: «Москва, ул Тверская, д 18», ниже — регион и район. Без координат — не годится. */
export function fromDadata(s: DadataSuggestion): GeoHit | null {
  const d = s.data || {};
  const lat = parseFloat(d.geo_lat || ''), lng = parseFloat(d.geo_lon || '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Город и посёлок внутри него (поселения Москвы); вне города — посёлок или село.
  const place = [d.city, d.settlement_with_type].filter(Boolean) as string[];
  if (!place.length) place.push((d.area_with_type || d.region_with_type || '') as string);
  const house = d.house ? [d.house_type, d.house, d.block_type, d.block].filter(Boolean).join(' ') : '';
  const label = [...place, d.street_with_type, house].filter(Boolean).join(', ') || String(s.value || '');
  const sub = [d.region !== d.city ? d.region_with_type : '', d.area_with_type].filter(x => x && !place.includes(x)).join(', ');
  return { lat, lng, label, sub, district: (d.city || d.settlement || d.region || '') as string };
}

async function dadata(method: 'suggest/address' | 'geolocate/address', body: Record<string, unknown>): Promise<GeoHit[]> {
  const r = (await getJson(DADATA + method, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Token ' + config.dadataKey() }
  })) as { suggestions?: DadataSuggestion[] };
  const seen = new Set<string>();
  return (Array.isArray(r?.suggestions) ? r.suggestions : []).map(fromDadata)
    .filter((h): h is GeoHit => !!h && !seen.has(h.label) && !!seen.add(h.label));
}

// ───────────────────────── Поиск и обратный поиск ─────────────────────────

const OFF = 'Поиск адреса пока не подключён — поставьте метку кликом по карте.';

export async function geoSearch(q: string, limit = 5): Promise<GeoHit[]> {
  if (config.dadataKey()) return (await dadata('suggest/address', { query: q, count: Math.min(20, limit * 2) })).slice(0, limit);
  if (!config.geocoderUrl()) throw new AppError(503, OFF);
  const u = new URL('/search', config.geocoderUrl());
  u.searchParams.set('format', 'json');
  // С запасом: часть ответов отсеется по зоне.
  u.searchParams.set('limit', String(limit * 3));
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('accept-language', 'ru');
  u.searchParams.set('countrycodes', 'ru,ua');
  u.searchParams.set('q', q);
  const list = (await getJson(u.toString())) as NominatimHit[];
  const seen = new Set<string>();
  return (Array.isArray(list) ? list : []).filter(h => inZone(h.address)).map(toHit)
    .filter(h => Number.isFinite(h.lat) && !seen.has(h.label) && seen.add(h.label)).slice(0, limit);
}

export async function geoReverse(lat: number, lng: number): Promise<GeoHit | null> {
  // Ближайший дом в радиусе 300 м; в поле или в лесу — ничего: метка остаётся, адрес вписывают сами.
  if (config.dadataKey()) return (await dadata('geolocate/address', { lat, lon: lng, count: 1, radius_meters: 300 }))[0] ?? null;
  if (!config.geocoderUrl()) throw new AppError(503, OFF);
  const u = new URL('/reverse', config.geocoderUrl());
  u.searchParams.set('format', 'json');
  u.searchParams.set('zoom', '18');
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('accept-language', 'ru');
  u.searchParams.set('lat', lat.toFixed(6));
  u.searchParams.set('lon', lng.toFixed(6));
  const h = (await getJson(u.toString())) as NominatimHit & { error?: string };
  if (!h || h.error || !h.display_name) return null;
  return toHit(h);
}
