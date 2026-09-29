// Карта заказов: MapLibre GL + тайлы OpenFreeMap (данные © OpenStreetMap, ODbL).
// Перенос design/design/moscow-map.js: метки-плашки HTML-оверлеем, группировка на мелком масштабе,
// веер плашек на одном адресе, точка базы, круг радиуса. Координаты — сразу lat/lng вместо процентной сетки.
import type { LngLatBounds, Map as GLMap } from 'maplibre-gl';

export type Pin = { id: number; lat: number; lng: number; urgent: boolean; rate: string; kind: string; active: boolean; title: string };
export type LatLng = { lat: number; lng: number };

export type MapCallbacks = {
  onMapClick?: (p: LatLng) => void;
  onPinClick?: (id: number) => void;
  onStackClick?: (ids: number[]) => void;
};

export const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
// Россия целиком — кадр по умолчанию, когда меток нет.
const RU_BOUNDS: [[number, number], [number, number]] = [[19, 42], [180, 71]];

const A = (v: string, fb: string) => 'var(' + v + ',' + fb + ')';
const ACCENT = A('--color-accent', '#5980a6');
const DEEP = A('--color-accent-900', '#2f4a63');
const PAPER = A('--color-neutral-100', '#fff');
const INK = A('--color-text', '#1d1f20');
const esc = (s: unknown) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const plural = (k: number, a: string, b: string, c: string) => {
  const m10 = k % 10, m100 = k % 100;
  return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c;
};

// Геодезический круг радиуса (км → полигон).
const circlePoly = (lat: number, lng: number, km: number, steps: number) => {
  const R = 6371, d = km / R, la = lat * Math.PI / 180, lo = lng * Math.PI / 180, ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const b = (i / steps) * 2 * Math.PI;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    ring.push([lo2 * 180 / Math.PI, la2 * 180 / Math.PI]);
  }
  return { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [ring] }, properties: {} };
};
const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] as ReturnType<typeof circlePoly>[] };

export const kmBetween = (la1: number, lo1: number, la2: number, lo2: number) => {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
};

function injectSkin() {
  if (document.getElementById('season-map-skin')) return;
  const st = document.createElement('style');
  st.id = 'season-map-skin';
  st.textContent = [
    '.maplibregl-map{font-family:var(--font-body,sans-serif)}',
    '.maplibregl-ctrl-group{border-radius:0!important;border:1px solid ' + ACCENT + ';box-shadow:none;background:' + PAPER + '}',
    '.maplibregl-ctrl-group button{border-radius:0!important;width:30px;height:30px;background:' + PAPER + '}',
    '.maplibregl-ctrl-group button+button{border-top:1px solid ' + ACCENT + '}',
    '.maplibregl-ctrl-group button:hover{background:color-mix(in srgb,' + ACCENT + ' 14%,' + PAPER + ')}',
    '.maplibregl-ctrl-group button:focus-visible{outline:2px solid ' + ACCENT + ';outline-offset:2px;box-shadow:none}',
    '.maplibregl-ctrl-attrib{display:none!important}',
    '.maplibregl-ctrl-scale{border-radius:0;border:1px solid ' + ACCENT + ';border-top:0;color:' + INK +
      ';background:color-mix(in srgb,' + PAPER + ' 82%,transparent);font-size:10px}'
  ].join('');
  document.head.appendChild(st);
}

export class SeasonMapView {
  private root: HTMLElement;
  private host: HTMLDivElement;
  private overlay: HTMLDivElement;
  private map: GLMap | null = null;
  private gl: typeof import('maplibre-gl') | null = null;
  private ready = false;
  private touched = false;
  private ruDone = false;
  private ro: ResizeObserver | null = null;
  private flyPaint: ReturnType<typeof setInterval> | undefined;
  private settle: ReturnType<typeof setInterval> | undefined;
  private destroyed = false;

  pins: Pin[] = [];
  draft: LatLng | null = null;
  mode: 'employer' | 'view' = 'view';
  highlight: number | null = null;
  anchor: LatLng | null = null;
  radiusKm = 0;

  constructor(root: HTMLElement, private cb: MapCallbacks) {
    this.root = root;
    root.style.cssText = 'position:absolute;inset:0;display:block;overflow:hidden;background:' + A('--color-bg', '#f2f2f3');
    this.host = document.createElement('div');
    this.host.style.cssText = 'position:absolute;inset:0';
    root.appendChild(this.host);
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5';
    root.appendChild(this.overlay);
    injectSkin();
    this.boot();
  }

  setCallbacks(cb: MapCallbacks) { this.cb = cb; }

  update(p: { pins?: Pin[]; draft?: LatLng | null; mode?: 'employer' | 'view'; highlight?: number | null; anchor?: LatLng | null; radiusKm?: number }) {
    const pinsChanged = p.pins !== undefined && p.pins !== this.pins;
    if (p.pins !== undefined) this.pins = p.pins;
    if (p.draft !== undefined) this.draft = p.draft;
    if (p.highlight !== undefined) this.highlight = p.highlight;
    if (p.mode !== undefined) {
      this.mode = p.mode;
      this.host.style.cursor = p.mode === 'employer' ? 'crosshair' : '';
    }
    const radiusChanged = (p.anchor !== undefined && JSON.stringify(p.anchor) !== JSON.stringify(this.anchor)) || (p.radiusKm !== undefined && p.radiusKm !== this.radiusKm);
    if (p.anchor !== undefined) this.anchor = p.anchor;
    if (p.radiusKm !== undefined) this.radiusKm = p.radiusKm;
    if (radiusChanged) this.drawRadius();
    if (pinsChanged && this.map && !this.touched) this.fitData();
    this.paint();
  }

  flyTo(lat: number, lng: number, zoom = 8) {
    if (!this.map) return;
    this.touched = true;
    const z = Math.max(this.map.getZoom(), zoom);
    this.map.easeTo({ center: [lng, lat], zoom: z, duration: 620, easing: (t) => t * (2 - t) });
    clearInterval(this.flyPaint);
    const tick = () => { if (this.map) { this.map.triggerRepaint(); this.paint(); } };
    this.flyPaint = setInterval(tick, 40);
    setTimeout(() => { clearInterval(this.flyPaint); tick(); }, 700);
    tick();
  }

  destroy() {
    this.destroyed = true;
    this.ro?.disconnect();
    clearInterval(this.flyPaint);
    clearInterval(this.settle);
    this.map?.remove();
    this.map = null;
    this.root.innerHTML = '';
  }

  private async boot() {
    const gl = await import('maplibre-gl');
    if (this.destroyed) return;
    this.gl = gl;
    const map = new gl.Map({
      container: this.host,
      style: STYLE_URL,
      center: [60, 57],
      zoom: 3,
      minZoom: 0,
      maxZoom: 17,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false
    });
    this.map = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new gl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-left');
    map.addControl(new gl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    // Тайлы недоступны (нет сети) — карта остаётся рабочей: метки рисуются оверлеем по проекции.
    map.on('error', () => {});

    const start = () => {
      if (!this.map || this.ready) return;
      this.ready = true;
      this.ruLabels();
      this.drawRadius();
      this.fitData();
      this.paint();
    };
    map.on('styledata', () => { this.ruLabels(); this.drawRadius(); start(); });
    map.on('load', start);
    setTimeout(start, 900);
    this.paint();
    ['move', 'zoom', 'moveend', 'resize'].forEach(ev => map.on(ev, () => this.paint()));

    map.on('click', (ev) => this.cb.onMapClick?.({ lat: ev.lngLat.lat, lng: ev.lngLat.lng }));
    // Автоподгонка кадра работает, пока пользователь сам не тронул карту.
    ['wheel', 'pointerdown', 'dblclick'].forEach(t => this.host.addEventListener(t, () => { this.touched = true; }, { passive: true }));

    this.ro = new ResizeObserver(() => {
      if (!this.map) return;
      this.map.resize();
      if (this.ready && !this.touched) this.fitData();
    });
    this.ro.observe(this.root);

    let tries = 0;
    this.settle = setInterval(() => {
      if (!this.map || ++tries > 24) { clearInterval(this.settle); return; }
      this.map.resize();
      if (!this.touched) this.fitData();
      this.ruLabels();
      this.paint();
      if (this.ruDone && tries > 3) clearInterval(this.settle);
    }, 250);
  }

  // Кадр вокруг базы: растим радиус, пока в кадр не попадёт хотя бы MIN_SHOWN заказов.
  private fitData() {
    if (!this.map || !this.gl) return;
    const pins = this.pins;
    const home = this.anchor || { lat: 55.751, lng: 37.618 };
    if (!pins.length) {
      if (this.anchor) this.map.jumpTo({ center: [home.lng, home.lat], zoom: 9 });
      else this.map.fitBounds(RU_BOUNDS, { padding: 12, animate: false });
      this.map.triggerRepaint();
      return;
    }
    const dist = pins.map(p => kmBetween(p.lat, p.lng, home.lat, home.lng));
    const MIN_SHOWN = 8;
    const RINGS = [400, 700, 1000, 1500, 2500];
    let use: Pin[] | null = null;
    for (const ring of RINGS) {
      const set = pins.filter((_, k) => dist[k] <= ring);
      if (set.length >= Math.min(MIN_SHOWN, pins.length)) { use = set; break; }
    }
    if (!use) use = pins;
    if (use.length >= 2) {
      const b: LngLatBounds = new this.gl.LngLatBounds();
      use.forEach(p => b.extend([p.lng, p.lat]));
      this.map.fitBounds(b, { padding: 44, maxZoom: 10, animate: false });
    } else {
      this.map.jumpTo({ center: [use[0].lng, use[0].lat], zoom: 10 });
    }
    this.map.triggerRepaint();
  }

  // Только русские подписи; границы и названия стран/регионов скрыты.
  private ruLabels() {
    if (!this.map || this.ruDone) return;
    let style;
    try { style = this.map.getStyle(); } catch { return; }
    if (!style || !style.layers) return;
    const nm = ['coalesce', ['get', 'name:ru'], ['get', 'name:latin'], ['get', 'name']];
    const BORDER = /bound|admin|border|disput/i;
    const GEOPOL = /country|continent|state|region|province|disput/i;
    let set = 0;
    style.layers.forEach((l) => {
      const layout = (l as { layout?: Record<string, unknown> }).layout;
      if (BORDER.test(l.id) || (l.type === 'symbol' && GEOPOL.test(l.id))) {
        try { this.map!.setLayoutProperty(l.id, 'visibility', 'none'); set++; } catch { /* слой не готов */ }
        return;
      }
      if (l.type !== 'symbol' || !layout || layout['text-field'] === undefined) return;
      try { this.map!.setLayoutProperty(l.id, 'text-field', nm); set++; } catch { /* слой не готов */ }
    });
    if (!set) return;
    this.ruDone = true;
    this.map.triggerRepaint();
  }

  private ensureRadiusLayers() {
    const map = this.map;
    if (!map) return false;
    let st;
    try { st = map.getStyle(); } catch { return false; }
    if (!st || !st.layers || !st.layers.length) return false;
    if (map.getSource('season-radius')) return true;
    try {
      map.addSource('season-radius', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({ id: 'season-radius-fill', type: 'fill', source: 'season-radius', paint: { 'fill-color': '#5980a6', 'fill-opacity': 0.09 } });
      map.addLayer({ id: 'season-radius-line', type: 'line', source: 'season-radius', paint: { 'line-color': '#5980a6', 'line-width': 1, 'line-dasharray': [4, 3] } });
      return true;
    } catch { return false; }
  }

  private drawRadius() {
    if (!this.ensureRadiusLayers()) return;
    const src = this.map!.getSource('season-radius') as import('maplibre-gl').GeoJSONSource | undefined;
    if (!src) return;
    if (!this.anchor || !(this.radiusKm > 0)) { src.setData(EMPTY_FC); return; }
    src.setData({ type: 'FeatureCollection', features: [circlePoly(this.anchor.lat, this.anchor.lng, this.radiusKm, 96)] });
    this.map!.triggerRepaint();
  }

  private pt(lat: number, lng: number): [number, number] | null {
    if (!this.map) return null;
    const p = this.map.project([lng, lat]);
    return [p.x, p.y];
  }

  private centroidLL(g: Pin[]): LatLng {
    return { lat: g.reduce((a, p) => a + p.lat, 0) / g.length, lng: g.reduce((a, p) => a + p.lng, 0) / g.length };
  }

  // Метки в одной точке экрана (один адрес).
  private coincident(pins: Pin[]) {
    const cells: Record<string, Pin[]> = {}, order: string[] = [];
    pins.forEach(p => {
      const pt = this.pt(p.lat, p.lng);
      if (!pt) return;
      const key = Math.round(pt[0] / 6) + ':' + Math.round(pt[1] / 6);
      if (!cells[key]) { cells[key] = []; order.push(key); }
      cells[key].push(p);
    });
    return order.map(k => cells[k]);
  }

  private cluster(pins: Pin[]) {
    const CELL = 104, cells: Record<string, Pin[]> = {};
    pins.forEach(p => {
      const pt = this.pt(p.lat, p.lng);
      if (!pt) return;
      const key = Math.round(pt[0] / CELL) + ':' + Math.round(pt[1] / CELL);
      (cells[key] = cells[key] || []).push(p);
    });
    const groups = Object.keys(cells).map(k => cells[k]);
    // Один проход по исходным центроидам: сливаем только перекрывающиеся соседние группы.
    const cens = groups.map(g => { const c = this.centroidLL(g); return this.pt(c.lat, c.lng); });
    const taken = groups.map(() => false);
    const out: Pin[][] = [];
    for (let i = 0; i < groups.length; i++) {
      if (taken[i]) continue;
      taken[i] = true;
      let acc = groups[i];
      const ci = cens[i];
      if (ci) {
        for (let j = i + 1; j < groups.length; j++) {
          const cj = cens[j];
          if (taken[j] || !cj) continue;
          const dx = Math.abs(ci[0] - cj[0]), dy = Math.abs(ci[1] - cj[1]);
          const solo = groups[i].length === 1 || groups[j].length === 1;
          const hit = solo ? (dx < 96 && dy < 40) : Math.hypot(dx, dy) < 46;
          if (hit) { acc = acc.concat(groups[j]); taken[j] = true; }
        }
      }
      out.push(acc);
    }
    return out;
  }

  private paint() {
    if (!this.overlay || !this.map) return;
    const html: string[] = [];
    const pins = this.pins;
    const hot = this.highlight == null ? '' : String(this.highlight);
    const near = this.map.getZoom() >= 7;
    const groups = near ? this.coincident(pins) : this.cluster(pins);
    const dense = pins.length > 14 && !near;

    const renderPin = (p: Pin, stackIdx: number, stackN: number) => {
      const pt = this.pt(p.lat, p.lng);
      if (!pt) return;
      const isHot = String(p.id) === hot;
      if (dense && !isHot && !p.active && !p.urgent) {
        html.push('<div data-id="' + esc(p.id) + '" data-kind="pin" title="' + esc(p.title) + '" style="position:absolute;left:' +
          pt[0] + 'px;top:' + pt[1] + 'px;transform:translate(-50%,-50%) rotate(45deg);width:11px;height:11px;box-sizing:border-box;' +
          'pointer-events:auto;cursor:pointer;background:' + PAPER + ';border:1.5px solid ' + ACCENT +
          ';box-shadow:0 2px 6px rgba(31,45,58,.22)"></div>');
        return;
      }
      // Плашка — ставка и тип работы, а не номер.
      const solid = p.active || p.urgent;
      const ink = solid ? '#fff' : INK;
      const edge = solid ? DEEP : ACCENT;
      const stem = 11 + stackIdx * 48;
      html.push('<div data-id="' + esc(p.id) + '" data-kind="pin"' + (stackN > 1 ? ' data-stack="1"' : '') + ' title="' + esc(p.title) + '" style="position:absolute;left:' +
        pt[0] + 'px;top:' + pt[1] + 'px;transform:translate(-50%,-100%) scale(' + (isHot ? 1.08 : 1) + ');transform-origin:50% 100%;' +
        'pointer-events:auto;cursor:pointer;display:flex;flex-direction:column;align-items:center;white-space:nowrap">' +
          '<span style="display:flex;align-items:stretch;box-sizing:border-box;background:' + (solid ? ACCENT : PAPER) +
            ';border:1px solid ' + edge + ';box-shadow:' + (isHot ? '0 8px 20px rgba(31,45,58,.32)' : '0 3px 10px rgba(31,45,58,.18)') + '">' +
            (p.urgent ? '<span style="width:4px;background:' + (solid ? '#fff' : ACCENT) + '"></span>' : '') +
            '<span style="display:flex;flex-direction:column;gap:1px;padding:5px 10px">' +
              '<span style="font-family:var(--font-heading,sans-serif);font-weight:600;font-size:15px;line-height:1;letter-spacing:.01em;color:' + ink + '">' + esc(p.rate) + '</span>' +
              (p.kind ? '<span style="font-family:var(--font-heading,sans-serif);font-weight:600;font-size:11px;line-height:1.1;letter-spacing:.14em;text-transform:uppercase;color:' +
                (solid ? 'rgba(255,255,255,.85)' : '#555b60') + '">' + esc(p.kind) + '</span>' : '') +
            '</span>' +
          '</span>' +
          '<span style="width:1px;height:' + stem + 'px;background:' + edge + '"></span>' +
          '<span style="width:7px;height:7px;margin-top:-4px;transform:rotate(45deg);background:' + (solid ? ACCENT : PAPER) + ';border:1px solid ' + edge + '"></span>' +
        '</div>');
    };

    groups.forEach(group => {
      if (near || group.length === 1) {
        if (group.length === 1) { renderPin(group[0], 0, 1); return; }
        // Веер не уходит за верх карты: сколько влезло — показываем, остальное — «ещё N здесь».
        const anchor = this.pt(group[0].lat, group[0].lng);
        if (!anchor) return;
        const hostH = this.host.getBoundingClientRect().height || 0;
        if (anchor[1] < 0 || (hostH && anchor[1] > hostH)) return;
        const room = Math.max(1, Math.floor((Math.min(anchor[1], hostH || anchor[1]) - 16) / 48));
        const cap = Math.max(1, Math.min(4, room));
        const shown = group.slice(0, cap);
        const restN = group.length - shown.length;
        shown.forEach((p, i) => renderPin(p, shown.length - 1 - i, shown.length));
        if (restN > 0) {
          const rest = group.slice(shown.length);
          html.push('<div data-ids="' + esc(rest.map(r => r.id).join(',')) + '" data-kind="stackmore" title="' +
            esc('Ещё ' + restN + ' на этом адресе') + '" style="position:absolute;left:' + (anchor[0] + 14) + 'px;top:' + anchor[1] +
            'px;transform:translate(0,-50%);pointer-events:auto;cursor:pointer;padding:3px 7px;box-sizing:border-box;' +
            'font-family:var(--font-heading,sans-serif);font-size:12.5px;line-height:1;letter-spacing:.06em;color:#fff;background:' + ACCENT +
            ';border:1px solid ' + DEEP + ';box-shadow:0 3px 10px rgba(31,45,58,.22)">ещё ' + restN + ' здесь</div>');
        }
        return;
      }
      const c = this.centroidLL(group);
      const pt = this.pt(c.lat, c.lng);
      if (!pt) return;
      const n = group.length;
      const urgentN = group.filter(p => p.urgent).length;
      const big = n >= 15 ? 19 : n >= 5 ? 17 : 15;
      html.push('<div data-id="c:' + c.lat + ':' + c.lng + '" data-kind="cluster" data-n="' + n + '" data-u="' + urgentN + '" title="' +
        esc(n + ' предложений' + (urgentN ? ', срочных ' + urgentN : '')) +
        '" style="position:absolute;left:' + pt[0] + 'px;top:' + pt[1] + 'px;transform:translate(-50%,-50%);' +
        'display:flex;flex-direction:column;align-items:stretch;box-sizing:border-box;pointer-events:auto;cursor:pointer;white-space:nowrap;' +
        'font-family:var(--font-heading,sans-serif);font-weight:600;line-height:1;color:#fff;background:' + ACCENT + ';border:1px solid ' + DEEP + ';box-shadow:0 4px 14px rgba(31,45,58,.26)">' +
        '<span style="display:flex;align-items:baseline;gap:5px;padding:6px 9px"><span data-role="n" style="font-size:' + big + 'px">' + n + '</span>' +
        '<span data-role="w" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.88)">' + plural(n, 'заказ', 'заказа', 'заказов') + '</span></span>' +
        (urgentN ? '<span data-role="u" style="padding:3px 9px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;background:' + PAPER + ';color:' + DEEP + '">' +
          urgentN + ' срочн' + (urgentN === 1 ? 'ый' : 'ых') + '</span>' : '') + '</div>');
    });

    // Точка базирования исполнителя.
    if (this.anchor && this.mode !== 'employer') {
      const bp = this.pt(this.anchor.lat, this.anchor.lng);
      if (bp) {
        html.push('<div data-kind="base" title="Моя база" style="position:absolute;left:' + bp[0] + 'px;top:' + bp[1] +
          'px;transform:translate(-50%,-50%);width:15px;height:15px;box-sizing:border-box;border-radius:50%;pointer-events:none;z-index:5;background:' + PAPER +
          ';border:3px solid ' + DEEP + ';box-shadow:0 0 0 3px ' + PAPER + ',0 2px 8px rgba(31,45,58,.4)"></div>');
        html.push('<div data-kind="baselabel" style="position:absolute;left:' + (bp[0] + 13) + 'px;top:' + bp[1] +
          'px;transform:translateY(-50%);pointer-events:none;z-index:5;font-family:var(--font-heading,sans-serif);font-weight:600;font-size:11px;letter-spacing:.16em;' +
          'text-transform:uppercase;padding:2px 7px;white-space:nowrap;border:1px solid ' + PAPER + ';background:' + DEEP + ';color:#fff">моя база</div>');
      }
    }

    if (this.draft) {
      const pt = this.pt(this.draft.lat, this.draft.lng);
      if (pt) html.push('<div data-kind="draft" title="новая метка" style="position:absolute;left:' + (pt[0] - 17) + 'px;top:' + (pt[1] - 17) +
        'px;width:34px;height:34px;display:grid;place-items:center;box-sizing:border-box;font-family:var(--font-heading,sans-serif);' +
        'font-size:17px;background:' + PAPER + ';color:' + INK + ';border:1px dashed ' + ACCENT + '">+</div>');
    }

    this.overlay.innerHTML = html.join('');
    this.deoverlap();
    this.overlay.querySelectorAll<HTMLElement>('[data-kind="pin"]').forEach(el => {
      el.addEventListener('click', (ev) => { ev.stopPropagation(); this.cb.onPinClick?.(+el.dataset.id!); });
    });
    this.overlay.querySelectorAll<HTMLElement>('[data-kind="stackmore"]').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.cb.onStackClick?.(String(el.dataset.ids || '').split(',').filter(Boolean).map(Number));
      });
    });
    this.overlay.querySelectorAll<HTMLElement>('[data-kind="cluster"]').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const pts = el.dataset.id!.split('|').map(s => s.split(':'));
        const lat = pts.reduce((a, p) => a + +p[1], 0) / pts.length, lng = pts.reduce((a, p) => a + +p[2], 0) / pts.length;
        this.flyTo(lat, lng, Math.min((this.map?.getZoom() || 3) + 3, 12));
      });
    });
  }

  // Развод плашек по фактическим прямоугольникам (перенесено из прототипа без изменений логики).
  private deoverlap() {
    type R = { left: number; right: number; top: number; bottom: number; width?: number };
    const grow = (r: R, m: number): R => ({ left: r.left - m, right: r.right + m, top: r.top - m, bottom: r.bottom + m });
    const all = Array.from(this.overlay.querySelectorAll<HTMLElement>('[data-kind="pin"]'));
    const els = all.filter(el => el.children.length >= 3 && el.dataset.stack !== '1');
    const stacked = all.filter(el => el.dataset.stack === '1');
    let clusters = Array.from(this.overlay.querySelectorAll<HTMLElement>('[data-kind="cluster"]'));
    const host = this.host.getBoundingClientRect();
    const placedC: R[] = [], placedEl: HTMLElement[] = [];
    const clampIn = (c: HTMLElement) => {
      const r = c.getBoundingClientRect();
      let dx = 0, dy = 0;
      if (r.right > host.right - 4) dx = host.right - 4 - r.right;
      if (r.left + dx < host.left + 4) dx = host.left + 4 - r.left;
      if (r.bottom > host.bottom - 4) dy = host.bottom - 4 - r.bottom;
      if (r.top + dy < host.top + 4) dy = host.top + 4 - r.top;
      if (dx) c.style.left = ((parseFloat(c.style.left) || 0) + dx) + 'px';
      if (dy) c.style.top = ((parseFloat(c.style.top) || 0) + dy) + 'px';
    };
    const overlaps = (r: R, q: R) => !(r.right < q.left || q.right < r.left || r.bottom < q.top || q.bottom < r.top);
    const hitIdx = (r: R) => placedC.findIndex(q => overlaps(r, q));
    const fixedZ: R[] = [];
    const dot0 = this.overlay.querySelector('[data-kind="base"]');
    if (dot0) {
      const dotRect = dot0.getBoundingClientRect();
      fixedZ.push(grow(dotRect, 3));
      const lbl0 = this.overlay.querySelector('[data-kind="baselabel"]');
      if (lbl0) {
        const lr = lbl0.getBoundingClientRect();
        fixedZ.push(grow(lr, 2));
        fixedZ.push(grow({ left: dotRect.left - 13 - lr.width, right: dotRect.left - 13, top: lr.top, bottom: lr.bottom }, 2));
      }
    }
    const hitFixed = (r: R) => fixedZ.some(q => overlaps(r, q));
    clusters.forEach(c => {
      const l0 = parseFloat(c.style.left) || 0, t0 = parseFloat(c.style.top) || 0;
      const r0 = c.getBoundingClientRect();
      const sx = r0.width + 6, sy = r0.height + 6;
      const tries = [[0, 0], [0, -sy], [0, sy], [sx, 0], [-sx, 0], [sx, -sy], [-sx, -sy], [sx, sy], [-sx, sy], [0, -2 * sy], [0, 2 * sy], [2 * sx, 0], [-2 * sx, 0]];
      let okC = false;
      for (const [dx, dy] of tries) {
        c.style.left = (l0 + dx) + 'px'; c.style.top = (t0 + dy) + 'px';
        clampIn(c);
        if (hitIdx(grow(c.getBoundingClientRect(), 3)) < 0 && !hitFixed(grow(c.getBoundingClientRect(), 3))) { okC = true; break; }
      }
      if (!okC) {
        // Места нет — вливаем в группу, с которой сталкиваемся.
        c.style.left = l0 + 'px'; c.style.top = t0 + 'px'; clampIn(c);
        const hi = hitIdx(grow(c.getBoundingClientRect(), 3));
        const host2 = hi >= 0 ? placedEl[hi] : null;
        if (host2) {
          const n = (+host2.dataset.n! || 0) + (+c.dataset.n! || 0), u = (+host2.dataset.u! || 0) + (+c.dataset.u! || 0);
          host2.dataset.n = String(n); host2.dataset.u = String(u);
          host2.dataset.id = host2.dataset.id + '|' + c.dataset.id;
          const cnt = host2.querySelector('[data-role="n"]'), wd = host2.querySelector('[data-role="w"]'), ur = host2.querySelector('[data-role="u"]');
          if (cnt) cnt.textContent = String(n);
          if (wd) wd.textContent = plural(n, 'заказ', 'заказа', 'заказов');
          if (u) {
            const txt = u + ' срочн' + (u === 1 ? 'ый' : 'ых');
            if (ur) ur.textContent = txt;
            else host2.insertAdjacentHTML('beforeend', '<span data-role="u" style="padding:3px 9px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;background:' + PAPER + ';color:' + DEEP + '">' + txt + '</span>');
          }
          host2.title = n + ' предложений' + (u ? ', срочных ' + u : '');
          c.remove();
          placedC[hi] = host2.getBoundingClientRect();
          return;
        }
      }
      placedC.push(c.getBoundingClientRect()); placedEl.push(c);
      const nl = parseFloat(c.style.left) || 0, nt = parseFloat(c.style.top) || 0;
      const len = Math.hypot(nl - l0, nt - t0);
      if (len > 4) {
        // Сдвинутая плашка держит ножку к своей настоящей точке.
        const line = document.createElement('div');
        line.setAttribute('data-kind', 'clusterstem');
        line.style.cssText = 'position:absolute;left:' + l0 + 'px;top:' + t0 + 'px;width:' + len + 'px;height:1px;background:' + DEEP +
          ';transform-origin:0 0;transform:rotate(' + Math.atan2(nt - t0, nl - l0) + 'rad);pointer-events:none';
        this.overlay.insertBefore(line, c);
        const dot = document.createElement('div');
        dot.setAttribute('data-kind', 'clusterstem');
        dot.style.cssText = 'position:absolute;left:' + l0 + 'px;top:' + t0 + 'px;width:5px;height:5px;transform:translate(-50%,-50%);background:' + DEEP + ';pointer-events:none';
        this.overlay.insertBefore(dot, c);
      }
    });
    clusters = clusters.filter(c => c.isConnected);
    const boxes: R[] = clusters.concat(all.filter(el => el.children.length === 0)).concat(stacked)
      .concat(Array.from(this.overlay.querySelectorAll<HTMLElement>('[data-kind="stackmore"]')))
      .map(el => el.getBoundingClientRect());
    const hits = (r: R) => boxes.some(q => overlaps(r, q));
    const baseDot = this.overlay.querySelector<HTMLElement>('[data-kind="base"]');
    if (baseDot) boxes.push(baseDot.getBoundingClientRect());
    const baseEl = this.overlay.querySelector<HTMLElement>('[data-kind="baselabel"]');
    if (baseEl) {
      // Подпись остаётся у точки: если справа занято — перебрасываем её влево.
      if (hits(grow(baseEl.getBoundingClientRect(), 2)) && baseDot) {
        const w = baseEl.getBoundingClientRect().width;
        const dotLeft = parseFloat(baseDot.style.left) || 0;
        baseEl.style.left = (dotLeft - 13 - w) + 'px';
      }
      boxes.push(baseEl.getBoundingClientRect());
    }
    els.forEach(el => {
      const left0 = parseFloat(el.style.left) || 0;
      const top0 = parseFloat(el.style.top) || 0;
      const stem = el.children[el.children.length - 2] as HTMLElement;
      const stem0 = parseFloat(stem.style.height) || 11;
      let lift = 0, ok = false;
      for (let i = 0; i < 7; i++) {
        let r = el.getBoundingClientRect();
        let dx = 0;
        if (r.right > host.right - 6) dx = host.right - 6 - r.right;
        if (r.left + dx < host.left + 6) dx = host.left + 6 - r.left;
        if (dx) { el.style.left = ((parseFloat(el.style.left) || 0) + dx) + 'px'; r = el.getBoundingClientRect(); }
        if (!hits(grow(r, 2))) { ok = true; break; }
        if (r.top - 18 < host.top + 4) break;
        lift += 18;
        el.style.top = (top0 - lift) + 'px';
        stem.style.height = (stem0 + lift) + 'px';
      }
      if (!ok) {
        // Места нет — сворачиваем плашку в точку на её настоящей координате.
        el.style.left = left0 + 'px';
        el.style.top = top0 + 'px';
        el.style.transform = 'translate(-50%, -50%)';
        el.innerHTML = '<span style="display:block;width:11px;height:11px;transform:rotate(45deg);box-sizing:border-box;background:' +
          PAPER + ';border:1.5px solid ' + ACCENT + ';box-shadow:0 2px 6px rgba(31,45,58,.22)"></span>';
      }
      boxes.push(el.getBoundingClientRect());
    });
  }
}
