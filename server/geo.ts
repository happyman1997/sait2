// Геокодер: Nominatim-совместимый API (в продакшене — свой Nominatim/Photon; публичный OSM — только для разработки).
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

async function getJson(url: string): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': config.geocoderUserAgent(), 'Accept-Language': 'ru' }, signal: ctl.signal });
    if (!res.ok) throw new AppError(502, 'Геокодер недоступен — поставьте метку кликом по карте.');
    const value = await res.json();
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(url, { at: Date.now(), value });
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

export async function geoSearch(q: string, limit = 5): Promise<GeoHit[]> {
  const u = new URL('/search', config.geocoderUrl());
  u.searchParams.set('format', 'json');
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('accept-language', 'ru');
  u.searchParams.set('countrycodes', 'ru');
  u.searchParams.set('q', q);
  const list = (await getJson(u.toString())) as NominatimHit[];
  const seen = new Set<string>();
  return (Array.isArray(list) ? list : []).map(toHit).filter(h => Number.isFinite(h.lat) && !seen.has(h.label) && seen.add(h.label));
}

export async function geoReverse(lat: number, lng: number): Promise<GeoHit | null> {
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
