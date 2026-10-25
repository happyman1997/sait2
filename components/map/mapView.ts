// Карта заказов: MapLibre GL + тайлы OpenFreeMap или свой PMTiles (данные © OpenStreetMap, ODbL).
// Перенос design/design/moscow-map.js: метки-плашки HTML-оверлеем, группировка на мелком масштабе,
// веер плашек на одном адресе, точка базы, круг радиуса. Координаты — сразу lat/lng вместо процентной сетки.
import type { ExpressionSpecification, LngLatBounds, Map as GLMap } from 'maplibre-gl';
import { SELF_HOSTED_MAP, STYLE_URL } from './style';

/** n — не заказ, а сводка с сервера: столько заказов на этом участке (плотная карта, /api/jobs/area). */
export type Pin = { id: number; lat: number; lng: number; urgent: boolean; rate: string; kind: string; active: boolean; title: string; n?: number };
export type LatLng = { lat: number; lng: number };
/** Видимая часть карты — границы кадра и масштаб. */
export type MapViewport = { w: number; s: number; e: number; n: number; zoom: number };

export type MapCallbacks = {
  onMapClick?: (p: LatLng) => void;
  onPinClick?: (id: number) => void;
  onStackClick?: (ids: number[]) => void;
  /** Карту отпустили (или выставили кадр) — для догрузки заказов кадра. */
  onView?: (v: MapViewport) => void;
};

// Россия целиком — кадр по умолчанию, когда меток нет.
const RU_BOUNDS: [[number, number], [number, number]] = [[19, 42], [180, 71]];

const A = (v: string, fb: string) => 'var(' + v + ',' + fb + ')';
const ACCENT = A('--color-accent', '#5980a6');
const DEEP = A('--color-accent-900', '#2f4a63');
const PAPER = A('--color-neutral-100', '#fff');
const INK = A('--color-text', '#1d1f20');
// Открытый сейчас заказ — тёмная плашка: отличается и от обычных, и от срочных.
const NIGHT = A('--ink', '#22282e');
const esc = (s: unknown) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const plural = (k: number, a: string, b: string, c: string) => {
  const m10 = k % 10, m100 = k % 100;
  return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c;
};

const countText = (n: number) => (n > 999 ? '999+' : String(n));
/** Группа из одного настоящего заказа (не сводки участка) — рисуется плашкой. */
const isSingle = (g: Pin[]) => g.length === 1 && !g[0].n;
// Срочные в группе — только в подсказке: красные цифры на каждом кружке читались как непрочитанные уведомления.
const clusterTitle = (n: number, u: number) => n + ' ' + plural(n, 'заказ', 'заказа', 'заказов') + ' рядом' + (u ? ', срочных ' + u : '') + ' — нажмите, чтобы приблизить';

/** Группа заказов — кружок с числом на её месте; размер — по числу заказов. */
function clusterHtml(pt: [number, number], c: LatLng, n: number, u: number, ids: number[], agg: boolean) {
  const d = n >= 100 ? 50 : n >= 20 ? 44 : n >= 5 ? 38 : 34;
  return '<div data-id="c:' + c.lat + ':' + c.lng + '" data-kind="cluster"' + (agg ? ' data-agg="1"' : '') + ' data-n="' + n + '" data-u="' + u + '" data-ids="' + ids.join(',') + '" title="' +
    esc(clusterTitle(n, u)) + '" style="position:absolute;left:' + pt[0] + 'px;top:' + pt[1] + 'px;transform:translate(-50%,-50%);z-index:4;width:' + d + 'px;height:' + d +
    'px;box-sizing:border-box;border-radius:50%;display:grid;place-items:center;pointer-events:auto;cursor:pointer;font-family:var(--font-heading,sans-serif);' +
    'font-weight:700;font-size:' + (n >= 100 ? 15 : 16) + 'px;line-height:1;color:#fff;background:' + ACCENT + ';border:2px solid ' + PAPER +
    ';box-shadow:0 0 0 1px ' + DEEP + ',0 4px 12px rgba(31,45,58,.28)"><span data-role="n">' + countText(n) + '</span></div>';
}

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

export class SeasonMapView {
  private root: HTMLElement;
  private host: HTMLDivElement;
  private overlay: HTMLDivElement;
  private map: GLMap | null = null;
  private gl: typeof import('maplibre-gl') | null = null;
  private ready = false;
  private touched = false;
  /** Перелёт к метке, запрошенный до готовности карты (открыли ссылку /?job=N) — выполняется при старте. */
  private pendingFly: { lat: number; lng: number; zoom: number } | null = null;
  private ruDone = false;
  private ro: ResizeObserver | null = null;
  private flyPaint: ReturnType<typeof setInterval> | undefined;
  private settle: ReturnType<typeof setInterval> | undefined;
  private destroyed = false;
  private raf = 0;
  /** Плашки, на которых сейчас лежит палец: перерисовка не должна выкидывать их из страницы (см. keepTouched). */
  private held = new Set<Node>();

  pins: Pin[] = [];
  fitPts: LatLng[] | null = null;
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
    // contain — сдвиг метки пересчитывает раскладку только этого слоя, а не всей страницы. Слой не обрезан по своему
    // краю (обрезает сама карта): пока карту тянут, слой едет целиком, и метки из запаса за краем кадра уже видны.
    this.overlay.style.cssText = 'position:absolute;inset:0;contain:layout size style;pointer-events:none;z-index:5';
    root.appendChild(this.overlay);
    // Один обработчик на слой меток вместо обработчика на каждую плашку при каждой перерисовке.
    this.overlay.addEventListener('click', (ev) => this.onOverlayClick(ev));
    this.overlay.addEventListener('touchstart', (ev) => { for (const t of Array.from(ev.changedTouches)) this.held.add(t.target as Node); }, { passive: true });
    const release = (ev: TouchEvent) => {
      if (ev.touches.length) return;
      this.held.clear();
      this.overlay.querySelectorAll('[data-ghost]').forEach(g => g.remove());
    };
    this.overlay.addEventListener('touchend', release, { passive: true });
    this.overlay.addEventListener('touchcancel', release, { passive: true });
    this.boot();
  }

  private onOverlayClick(ev: MouseEvent) {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-kind]');
    if (!el || !this.overlay.contains(el)) return;
    const kind = el.dataset.kind;
    if (kind === 'pin') { ev.stopPropagation(); this.cb.onPinClick?.(+el.dataset.id!); }
    else if (kind === 'stackmore') {
      ev.stopPropagation();
      this.cb.onStackClick?.(String(el.dataset.ids || '').split(',').filter(Boolean).map(Number));
    } else if (kind === 'cluster') {
      ev.stopPropagation();
      const z = this.map?.getZoom() || 3;
      // Ближе уже некуда (заказы в соседних домах) — список этих заказов, как у нескольких на одном адресе.
      if (z >= 16 && !el.dataset.agg) { this.cb.onStackClick?.(String(el.dataset.ids || '').split(',').filter(Boolean).map(Number)); return; }
      const pts = el.dataset.id!.split('|').map(s => s.split(':'));
      const lat = pts.reduce((a, p) => a + +p[1], 0) / pts.length, lng = pts.reduce((a, p) => a + +p[2], 0) / pts.length;
      this.flyTo(lat, lng, Math.min(z + (z < 9 ? 3 : 2), 17));
    }
  }

  /** Перерисовка оверлея не чаще раза за кадр: move/zoom/resize приходят пачками. */
  private schedulePaint() {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  /** Где была карта при последней полной перерисовке (точка левого верхнего угла и масштаб). */
  private shot: { lng: number; lat: number; zoom: number } | null = null;

  // Карту тянут, масштаб тот же — сдвигаем слой меток целиком, без перерисовки: полная перерисовка плотной карты
  // на каждом кадре заметно тормозила. Метки нарисованы с запасом за краем кадра, поэтому перерисовываем,
  // только когда сдвинули далеко или отпустили карту (moveend).
  private onMove() {
    const map = this.map, s = this.shot;
    if (!map || this.raf || this.destroyed) return;
    if (s && Math.abs(map.getZoom() - s.zoom) < 1e-9) {
      const p = map.project([s.lng, s.lat]);
      if (Math.hypot(p.x, p.y) < 120) { this.overlay.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)'; return; }
    }
    this.schedulePaint();
  }

  setCallbacks(cb: MapCallbacks) { this.cb = cb; this.emitView(); }

  private emitView() {
    if (!this.map || !this.ready || !this.cb.onView) return;
    const b = this.map.getBounds();
    this.cb.onView({ w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth(), zoom: this.map.getZoom() });
  }

  /**
   * fit — точки, по которым выставляется первый кадр (заказы от базы). Без него — по меткам; но догруженное
   * в кадр (сводка участков) кадр не двигает: иначе карта подстраивалась бы под ответ и тут же просила новый.
   */
  update(p: { pins?: Pin[]; fit?: LatLng[]; draft?: LatLng | null; mode?: 'employer' | 'view'; highlight?: number | null; anchor?: LatLng | null; radiusKm?: number }) {
    const pinsChanged = p.fit !== undefined ? p.fit !== this.fitPts : p.pins !== undefined && p.pins !== this.pins;
    if (p.fit !== undefined) this.fitPts = p.fit;
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
    this.schedulePaint();
  }

  flyTo(lat: number, lng: number, zoom = 8) {
    this.touched = true;
    if (!this.map || !this.ready) { this.pendingFly = { lat, lng, zoom }; return; }
    const z = Math.max(this.map.getZoom(), zoom);
    // Точка чуть ниже центра: плашка метки растёт вверх и на низкой карте телефона иначе упирается в край.
    const dy = Math.round(Math.min(36, this.host.clientHeight * 0.2));
    this.map.easeTo({ center: [lng, lat], zoom: z, offset: [0, dy], duration: 620, easing: (t) => t * (2 - t) });
    clearInterval(this.flyPaint);
    const tick = () => { if (this.map) { this.map.triggerRepaint(); this.paint(); } };
    this.flyPaint = setInterval(tick, 40);
    setTimeout(() => { clearInterval(this.flyPaint); tick(); }, 700);
    tick();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
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
    // Воркер отдаётся статикой той же версии (scripts/copy-maplibre-worker.mjs).
    gl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
    if (SELF_HOSTED_MAP) {
      // Тайлы из файла .pmtiles читаются кусками (Range-запросы) — сервер тайлов не нужен.
      const { Protocol } = await import('pmtiles');
      if (this.destroyed) return;
      const proto = new Protocol();
      gl.addProtocol('pmtiles', proto.tile);
    }
    this.gl = gl;
    const map = new gl.Map({
      container: this.host,
      // Относительный адрес стиля — от своего сайта.
      style: new URL(STYLE_URL, window.location.href).href,
      center: [60, 57],
      zoom: 3,
      minZoom: 0,
      maxZoom: 17,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false,
      // Подсказки кнопок и единицы на линейке — по-русски (по умолчанию «Zoom in», «500 m»).
      locale: {
        'Map.Title': 'Карта', 'Marker.Title': 'Метка', 'Popup.Close': 'Закрыть',
        'NavigationControl.ZoomIn': 'Приблизить', 'NavigationControl.ZoomOut': 'Отдалить', 'NavigationControl.ResetBearing': 'Вернуть север наверх',
        'ScaleControl.Meters': 'м', 'ScaleControl.Kilometers': 'км'
      }
    });
    this.map = map;
    // Слой меток — внутри карты: колесо, перетаскивание и щипок, начатые на кружке или плашке, двигают карту
    // (отдельным слоем поверх неё над плотным городом карту было не приблизить и не сдвинуть). Нажатие на метку
    // по-прежнему открывает заказ: обработчик слоя гасит всплытие, до «клика по карте» оно не доходит.
    map.getCanvasContainer().appendChild(this.overlay);
    map.touchZoomRotate.disableRotation();
    map.addControl(new gl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-left');
    map.addControl(new gl.ScaleControl({ unit: 'metric' }), 'top-right');
    // Тайлы недоступны (нет сети) — карта остаётся рабочей: метки рисуются оверлеем по проекции.
    map.on('error', () => {});

    const start = () => {
      if (!this.map || this.ready) return;
      this.ready = true;
      this.ruLabels();
      this.drawRadius();
      const fly = this.pendingFly;
      this.pendingFly = null;
      if (fly) this.flyTo(fly.lat, fly.lng, fly.zoom);
      else this.fitData();
      this.paint();
      this.emitView();
    };
    map.on('styledata', () => { this.ruLabels(); this.drawRadius(); start(); });
    map.on('load', start);
    setTimeout(start, 900);
    this.paint();
    map.on('move', () => this.onMove());
    (['zoom', 'resize'] as const).forEach(ev => map.on(ev, () => this.schedulePaint()));
    map.on('moveend', () => { this.paint(); this.emitView(); });

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
      // resize() останавливает текущий жест — без нужды не зовём: иначе в первые секунды карта не тянулась пальцем.
      const cv = this.map.getCanvas();
      if (cv.clientWidth !== this.host.clientWidth || cv.clientHeight !== this.host.clientHeight) this.map.resize();
      if (!this.touched) this.fitData();
      this.ruLabels();
      this.paint();
      if (this.ruDone && tries > 3) clearInterval(this.settle);
    }, 250);
  }

  // Кадр вокруг базы: растим радиус, пока в кадр не попадёт хотя бы MIN_SHOWN заказов.
  private fitData() {
    if (!this.map || !this.gl) return;
    const pins: LatLng[] = this.fitPts ?? this.pins.filter(p => !p.n);
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
    let use: LatLng[] | null = null;
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
    const nm: ExpressionSpecification = ['coalesce', ['get', 'name:ru'], ['get', 'name:latin'], ['get', 'name']];
    const BORDER = /bound|admin|border|disput/i;
    const GEOPOL = /country|continent|state|region|province|disput/i;
    let set = 0;
    style.layers.forEach((l) => {
      const layout = (l as { layout?: Record<string, unknown> }).layout;
      // По названию слоя и по данным: слой границ (boundary) и подписи стран/регионов (place класса country/state…).
      const src = (l as { 'source-layer'?: string })['source-layer'];
      const filter = JSON.stringify((l as { filter?: unknown }).filter ?? '');
      const geoLabel = src === 'place' && /"(country|continent|state|province)"/.test(filter);
      if (BORDER.test(l.id) || src === 'boundary' || geoLabel || (l.type === 'symbol' && GEOPOL.test(l.id))) {
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
    // Сводка участка весит столько, сколько в ней заказов.
    const w = g.reduce((a, p) => a + (p.n || 1), 0);
    return { lat: g.reduce((a, p) => a + p.lat * (p.n || 1), 0) / w, lng: g.reduce((a, p) => a + p.lng * (p.n || 1), 0) / w };
  }

  /** Группы по сетке экрана: CELL — сторона ячейки в пикселях. */
  private cluster(pins: Pin[], CELL = 104) {
    const cells: Record<string, Pin[]> = {};
    // Сетка привязана к самой карте, а не к экрану: иначе при перетаскивании заказы перескакивают
    // из кружка в кружок и числа на них меняются на ходу.
    const world = 512 * Math.pow(2, this.map?.getZoom() || 0);
    pins.forEach(p => {
      if (!this.pt(p.lat, p.lng)) return;
      const sin = Math.sin(p.lat * Math.PI / 180);
      const wx = (p.lng + 180) / 360 * world, wy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world;
      const key = Math.round(wx / CELL) + ':' + Math.round(wy / CELL);
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
          const solo = isSingle(groups[i]) || isSingle(groups[j]);
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
    // Плашки по одной — с масштаба области; на телефоне — только с масштаба города: на узкой карте плашки соседних
    // заказов налезали друг на друга, поэтому там раньше собираем их в метки «N заказов».
    const narrow = window.matchMedia('(max-width: 719.98px)').matches;
    const zoom = this.map.getZoom();
    const near = zoom >= (narrow ? 11 : 7);
    // Открытый заказ не прячем в группу — он всегда виден своей плашкой.
    const lone = pins.find(p => p.active) || null;
    const others = lone ? pins.filter(p => p !== lone) : pins;
    // Тесно стоящие заказы — в кружок с числом при любом масштабе: в плотном городе иначе сотни плашек налезают
    // друг на друга, а перерисовка каждого кадра при перетаскивании тормозит.
    const groups = this.cluster(others, near ? 84 : 104);
    const spotOf = (p: Pin) => this.pt(p.lat, p.lng);
    // Несколько заказов на одном адресе (точки на экране совпадают) — веер плашек, а не число: приближать некуда.
    const sameSpot = (g: Pin[]) => {
      const a = spotOf(g[0]);
      return !!a && g.every(p => { const b = spotOf(p); return !!b && Math.abs(a[0] - b[0]) < 7 && Math.abs(a[1] - b[1]) < 7; });
    };
    // Метки далеко за краем кадра не создаём — на всю Россию это сотни лишних DOM-узлов на кадр.
    const hostRect = this.host.getBoundingClientRect();
    const M = 160;
    const inView = (pt: [number, number]) => pt[0] > -M && pt[1] > -M && pt[0] < hostRect.width + M && pt[1] < hostRect.height + M;
    // Плашек сразу — не больше, чем читается; лишние одиночные — ромбиками (нажатие откроет карточку).
    // Считаем только видимые: заказы всего города за краем кадра место на экране не занимают.
    const singles = groups.filter(g => { if (!isSingle(g)) return false; const q = spotOf(g[0]); return !!q && inView(q); }).length;
    const dense = near ? singles > (narrow ? 14 : 45) : pins.length > 14;

    const renderPin = (p: Pin, stackIdx: number, stackN: number, fan = -1) => {
      const pt = this.pt(p.lat, p.lng);
      if (!pt || !inView(pt)) return;
      const isHot = String(p.id) === hot;
      if (dense && !isHot && !p.active && !p.urgent) {
        html.push('<div data-id="' + esc(p.id) + '" data-kind="pin" data-dot="1" title="' + esc(p.rate + ' · ' + p.title) + '" style="position:absolute;left:' +
          pt[0] + 'px;top:' + pt[1] + 'px;transform:translate(-50%,-50%) rotate(45deg);width:11px;height:11px;box-sizing:border-box;' +
          'pointer-events:auto;cursor:pointer;background:' + PAPER + ';border:1.5px solid ' + ACCENT +
          ';box-shadow:0 2px 6px rgba(31,45,58,.22)"></div>');
        return;
      }
      // Плашка — ставка и тип работы, а не номер.
      const solid = p.active || p.urgent;
      const ink = solid ? '#fff' : INK;
      const edge = p.active ? NIGHT : solid ? DEEP : ACCENT;
      const fill = p.active ? NIGHT : solid ? ACCENT : PAPER;
      const stem = 11 + stackIdx * 48;
      html.push('<div data-id="' + esc(p.id) + '" data-kind="pin"' + (stackN > 1 ? ' data-stack="1"' : '') + (fan >= 0 ? ' data-g="' + fan + '"' : '') +
        (p.active ? ' data-active="1"' : '') + ' title="' + esc(p.title) + '" style="position:absolute;left:' +
        pt[0] + 'px;top:' + pt[1] + 'px;transform:translate(-50%,-100%) scale(' + (p.active ? 1.12 : isHot ? 1.08 : 1) + ');transform-origin:50% 100%;z-index:' + (p.active ? 6 : 2) + ';' +
        'pointer-events:auto;cursor:pointer;display:flex;flex-direction:column;align-items:center;white-space:nowrap">' +
          '<span style="display:flex;align-items:stretch;box-sizing:border-box;background:' + fill +
            ';border:1px solid ' + edge + ';box-shadow:' + (p.active ? '0 0 0 3px ' + PAPER + ',0 10px 24px rgba(31,45,58,.4)' : isHot ? '0 8px 20px rgba(31,45,58,.32)' : '0 3px 10px rgba(31,45,58,.18)') + '">' +
            (p.urgent ? '<span style="width:4px;background:' + (solid ? '#fff' : ACCENT) + '"></span>' : '') +
            '<span style="display:flex;flex-direction:column;gap:1px;padding:5px 10px">' +
              '<span style="font-family:var(--font-heading,sans-serif);font-weight:600;font-size:15px;line-height:1;letter-spacing:.01em;color:' + ink + '">' + esc(p.rate) + '</span>' +
              (p.kind ? '<span style="font-family:var(--font-heading,sans-serif);font-weight:600;font-size:11px;line-height:1.1;letter-spacing:.14em;text-transform:uppercase;color:' +
                (solid ? 'rgba(255,255,255,.85)' : '#555b60') + '">' + esc(p.kind) + '</span>' : '') +
            '</span>' +
          '</span>' +
          '<span style="width:1px;height:' + stem + 'px;background:' + edge + '"></span>' +
          '<span style="width:7px;height:7px;margin-top:-4px;transform:rotate(45deg);background:' + fill + ';border:1px solid ' + edge + '"></span>' +
        '</div>');
    };

    groups.forEach((group, gi) => {
      const agg = group.some(p => p.n);
      if (isSingle(group)) { renderPin(group[0], 0, 1); return; }
      if (near && !agg && sameSpot(group)) {
        // Веер не уходит за верх карты: сколько влезло — показываем, остальное — «ещё N здесь».
        const anchor = this.pt(group[0].lat, group[0].lng);
        if (!anchor) return;
        const hostH = this.host.getBoundingClientRect().height || 0;
        if (anchor[1] < 0 || (hostH && anchor[1] > hostH)) return;
        const room = Math.max(1, Math.floor((Math.min(anchor[1], hostH || anchor[1]) - 16) / 48));
        const cap = Math.max(1, Math.min(4, room));
        // Открытый заказ — в показанной части веера, а не в «ещё N здесь».
        const ordered = group.some(p => p.active) ? [...group].sort((a, b) => +b.active - +a.active) : group;
        const shown = ordered.slice(0, cap);
        const restN = group.length - shown.length;
        shown.forEach((p, i) => renderPin(p, shown.length - 1 - i, shown.length, gi));
        if (restN > 0) {
          const rest = ordered.slice(shown.length);
          html.push('<div data-ids="' + esc(rest.map(r => r.id).join(',')) + '" data-kind="stackmore" data-g="' + gi + '" title="' +
            esc('Ещё ' + restN + ' на этом адресе') + '" style="position:absolute;left:' + (anchor[0] + 14) + 'px;top:' + anchor[1] +
            'px;transform:translate(0,-50%);pointer-events:auto;cursor:pointer;padding:3px 7px;box-sizing:border-box;' +
            'font-family:var(--font-heading,sans-serif);font-size:12.5px;line-height:1;letter-spacing:.06em;color:#fff;background:' + ACCENT +
            ';border:1px solid ' + DEEP + ';box-shadow:0 3px 10px rgba(31,45,58,.22)">ещё ' + restN + ' здесь</div>');
        }
        return;
      }
      const c = this.centroidLL(group);
      const pt = this.pt(c.lat, c.lng);
      if (!pt || !inView(pt)) return;
      html.push(clusterHtml(pt, c, group.reduce((a, p) => a + (p.n || 1), 0), group.filter(p => p.urgent && !p.n).length, group.filter(p => !p.n).map(p => p.id), agg));
    });

    if (lone) renderPin(lone, 0, 1);

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

    this.overlay.style.transform = '';
    this.overlay.innerHTML = html.join('');
    this.deoverlap();
    this.keepTouched();
    const o = this.map.unproject([0, 0]);
    this.shot = { lng: o.lng, lat: o.lat, zoom: this.map.getZoom() };
  }

  // Палец, опустившийся на плашку, продолжает слать события именно ей. После перерисовки старая плашка
  // оказывается вне страницы, события до карты не доходят — и карта не двигается, если вести пальцем с метки.
  // Поэтому возвращаем такую плашку невидимой, без данных для нажатия, и убираем, когда палец поднят.
  private keepTouched() {
    for (const n of this.held) {
      if (n.isConnected) continue;
      let top: Node = n;
      while (top.parentNode) top = top.parentNode;
      if (!(top instanceof HTMLElement)) continue;
      [top, ...Array.from(top.querySelectorAll<HTMLElement>('*'))].forEach(el => { delete el.dataset.id; delete el.dataset.kind; delete el.dataset.ids; });
      top.dataset.ghost = '1';
      top.style.visibility = 'hidden';
      this.overlay.appendChild(top);
    }
  }

  // Развод плашек по фактическим прямоугольникам (перенесено из прототипа без изменений логики).
  private deoverlap() {
    type R = { left: number; right: number; top: number; bottom: number; width?: number };
    const grow = (r: R, m: number): R => ({ left: r.left - m, right: r.right + m, top: r.top - m, bottom: r.bottom + m });
    const all = Array.from(this.overlay.querySelectorAll<HTMLElement>('[data-kind="pin"]'));
    const els = all.filter(el => el.children.length >= 3 && el.dataset.stack !== '1');
    let clusters = Array.from(this.overlay.querySelectorAll<HTMLElement>('[data-kind="cluster"]'));
    const host = this.host.getBoundingClientRect();
    const placedC: R[] = [], placedEl: HTMLElement[] = [];
    // Прямоугольник кружка считаем по его стилю, а не меряем: замеров на кадр были сотни, и каждый после сдвига
    // заставлял браузер заново раскладывать слой.
    const cr = (c: HTMLElement): R => {
      const x = host.left + (parseFloat(c.style.left) || 0), y = host.top + (parseFloat(c.style.top) || 0), h = (parseFloat(c.style.width) || 0) / 2;
      return { left: x - h, right: x + h, top: y - h, bottom: y + h };
    };
    // Плашки меряем один раз, пока в слой ничего не писали (одна раскладка на кадр), дальше считаем сами.
    const known = new Map<HTMLElement, R>();
    const scaleOf = new Map<HTMLElement, number>();
    all.forEach(el => { const b = el.getBoundingClientRect(); known.set(el, b); scaleOf.set(el, el.offsetHeight ? b.height / el.offsetHeight : 1); });
    const rectOf = (el: HTMLElement): R => el.dataset.kind === 'cluster' ? cr(el) : known.get(el) || el.getBoundingClientRect();
    const clampIn = (c: HTMLElement) => {
      const r = cr(c);
      let dx = 0, dy = 0;
      if (r.right > host.right - 4) dx = host.right - 4 - r.right;
      if (r.left + dx < host.left + 4) dx = host.left + 4 - r.left;
      if (r.bottom > host.bottom - 4) dy = host.bottom - 4 - r.bottom;
      if (r.top + dy < host.top + 4) dy = host.top + 4 - r.top;
      if (dx) c.style.left = ((parseFloat(c.style.left) || 0) + dx) + 'px';
      if (dy) c.style.top = ((parseFloat(c.style.top) || 0) + dy) + 'px';
    };
    const overlaps = (r: R, q: R) => !(r.right < q.left || q.right < r.left || r.bottom < q.top || q.bottom < r.top);
    const overlapArea = (r: R, q: R) => Math.max(0, Math.min(r.right, q.right) - Math.max(r.left, q.left)) * Math.max(0, Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top));
    const hitIdx = (r: R) => placedC.findIndex(q => overlaps(r, q));
    // Кнопки масштаба, линейка и подпись карты лежат поверх меток — метки обходят и их.
    // Подпись карты (data-attrib) — соседний с картой элемент в SeasonMap.
    const ctrls = Array.from((this.root.parentElement || this.root).querySelectorAll<HTMLElement>('.maplibregl-ctrl, [data-attrib]'))
      .map(el => el.getBoundingClientRect()).filter(r => r.width > 0).map(r => grow(r, 2));
    // Что лежит поверх карты снаружи (строка поиска и фильтры на телефоне — data-map-cover): метка под ними не видна и
    // не нажимается (палец попадает в строку поиска) — такие не рисуем, они появятся, если сдвинуть карту.
    // Проверяем уже после сдвигов: кружок у края карты прижимается внутрь и может уехать как раз под строку поиска.
    // Кнопки масштаба и подпись карты — так же: кружок под ними выглядел обрезанным, а сдвинутый висел на линии.
    const covers = Array.from(document.querySelectorAll<HTMLElement>('[data-map-cover]'))
      .map(el => el.getBoundingClientRect() as R).filter(r => r.right > r.left).concat(ctrls);
    const covered = (el: HTMLElement) => {
      const r = rectOf(el), area = (r.right - r.left) * (r.bottom - r.top);
      return covers.some(q => overlapArea(r, q) > area * 0.3);
    };
    all.filter(el => el.isConnected && !el.dataset.active && covered(el)).forEach(el => el.remove());
    // Группы «N заказов» обходят и плашку открытого заказа — иначе она их закрывает.
    const act0 = this.overlay.querySelector<HTMLElement>('[data-active="1"]');
    const actZ = act0 && clusters.length ? grow(act0.getBoundingClientRect(), 6) : null;
    // Группы обходят только открытый заказ; «моя база» уступает им место (кружок ляжет поверх, а не отъедет с линией).
    const ctrlZ = actZ ? [actZ] : [];
    const hitCtrl = (r: R) => ctrlZ.some(q => overlaps(r, q));
    // Кружок, налезающий на уже поставленный, — сливаем в него (сумма заказов), а не отодвигаем с ножкой:
    // в плотном городе сдвинутые группы с линиями превращались в путаницу.
    const mergeInto = (host2: HTMLElement, c: HTMLElement, hi: number) => {
      const n = (+host2.dataset.n! || 0) + (+c.dataset.n! || 0), u = (+host2.dataset.u! || 0) + (+c.dataset.u! || 0);
      host2.dataset.n = String(n); host2.dataset.u = String(u);
      host2.dataset.id = host2.dataset.id + '|' + c.dataset.id;
      host2.dataset.ids = [host2.dataset.ids, c.dataset.ids].filter(Boolean).join(',');
      if (c.dataset.agg) host2.dataset.agg = '1';
      const cnt = host2.querySelector('[data-role="n"]');
      if (cnt) cnt.textContent = countText(n);
      host2.title = clusterTitle(n, u);
      c.remove();
      placedC[hi] = cr(host2);
    };
    clusters.forEach(c => {
      clampIn(c);
      if (covered(c)) { c.remove(); return; }
      const l0 = parseFloat(c.style.left) || 0, t0 = parseFloat(c.style.top) || 0;
      const hi0 = hitIdx(grow(cr(c), 3));
      if (hi0 >= 0) { mergeInto(placedEl[hi0], c, hi0); return; }
      const r0 = cr(c);
      if (!hitCtrl(grow(r0, 3))) { placedC.push(r0); placedEl.push(c); return; }
      const sx = r0.right - r0.left + 6, sy = r0.bottom - r0.top + 6;
      // Мешает плашка открытого заказа — ищем рядом свободное место.
      const tries = [[0, 0], [0, -sy], [0, sy], [sx, 0], [-sx, 0], [sx, -sy], [-sx, -sy], [sx, sy], [-sx, sy]];
      if (actZ) tries.push([actZ.right + 4 - r0.left, 0], [actZ.left - 4 - r0.right, 0], [0, actZ.bottom + 4 - r0.top], [0, actZ.top - 4 - r0.bottom]);
      let best = { left: l0, top: t0, cost: Infinity };
      let ok = false;
      for (const [dx, dy] of tries) {
        c.style.left = (l0 + dx) + 'px'; c.style.top = (t0 + dy) + 'px';
        clampIn(c);
        const r = grow(cr(c), 3);
        if (hitIdx(r) < 0 && !hitCtrl(r)) { ok = true; break; }
        const cost = placedC.concat(ctrlZ).reduce((sum, q) => sum + overlapArea(r, q), 0);
        if (cost < best.cost) best = { left: parseFloat(c.style.left) || 0, top: parseFloat(c.style.top) || 0, cost };
      }
      if (!ok) { c.style.left = best.left + 'px'; c.style.top = best.top + 'px'; }
      if (covered(c)) { c.remove(); return; }
      placedC.push(cr(c)); placedEl.push(c);
      const nl = parseFloat(c.style.left) || 0, nt = parseFloat(c.style.top) || 0;
      const len = Math.hypot(nl - l0, nt - t0);
      if (len > 4) {
        // Сдвинутый кружок держит ножку к своей настоящей точке.
        const line = document.createElement('div');
        line.setAttribute('data-kind', 'clusterstem');
        line.style.cssText = 'position:absolute;left:' + l0 + 'px;top:' + t0 + 'px;width:' + len + 'px;height:1px;background:' + DEEP +
          ';transform-origin:0 0;transform:rotate(' + Math.atan2(nt - t0, nl - l0) + 'rad);pointer-events:none';
        this.overlay.insertBefore(line, c);
      }
    });
    clusters = clusters.filter(c => c.isConnected);
    const boxes: R[] = clusters.map(cr).concat(all.filter(el => el.isConnected && el.children.length === 0).map(rectOf), ctrls, covers);
    const hits = (r: R) => boxes.some(q => overlaps(r, q));
    const isActive = (el: HTMLElement) => el.dataset.active === '1';
    const placeSingle = (el: HTMLElement) => {
      if (!el.isConnected) return;
      const left0 = parseFloat(el.style.left) || 0;
      const top0 = parseFloat(el.style.top) || 0;
      const stem = el.children[el.children.length - 2] as HTMLElement;
      const stem0 = parseFloat(stem.style.height) || 11;
      const b = rectOf(el), sc = scaleOf.get(el) || 1;
      // Плашка не выходит за край карты; не помещается — поднимаем её на удлинённой ножке (низ метки остаётся на точке).
      let dx = 0;
      if (b.right > host.right - 6) dx = host.right - 6 - b.right;
      if (b.left + dx < host.left + 6) dx = host.left + 6 - b.left;
      const at = (lift: number): R => ({ left: b.left + dx, right: b.right + dx, top: b.top - lift * sc, bottom: b.bottom });
      let lift = 0, ok = false;
      for (let i = 0; i < 7; i++) {
        const r = at(lift);
        // Верх плашки за краем карты — она обрезана; лучше точка.
        if (r.top < host.top + 2) break;
        if (!hits(grow(r, 2))) { ok = true; break; }
        if (r.top - 18 * sc < host.top + 4) break;
        lift += 18;
      }
      let fin: R;
      if (ok) {
        if (dx) el.style.left = (left0 + dx) + 'px';
        if (lift) stem.style.height = (stem0 + lift) + 'px';
        if (!isActive(el)) el.style.zIndex = '3';
        fin = at(lift);
      } else if (isActive(el)) {
        // Открытый заказ не сворачиваем — остаётся плашкой поверх соседей.
        fin = b;
      } else {
        // Места нет — сворачиваем плашку в точку на её настоящей координате.
        el.style.transform = 'translate(-50%, -50%)';
        // Свёрнутая точка — под плашками, а не поверх их текста. data-dot — крупная зона нажатия на телефоне (map-skin.css).
        el.style.zIndex = '1';
        el.dataset.dot = '1';
        el.innerHTML = '<span style="display:block;width:11px;height:11px;transform:rotate(45deg);box-sizing:border-box;background:' +
          PAPER + ';border:1.5px solid ' + ACCENT + ';box-shadow:0 2px 6px rgba(31,45,58,.22)"></span>';
        const x = host.left + left0, y = host.top + top0;
        fin = { left: x - 5.5, right: x + 5.5, top: y - 5.5, bottom: y + 5.5 };
      }
      known.set(el, fin);
      boxes.push(fin);
    };
    // Открытый заказ ставим первым — остальные уступают ему место.
    els.filter(isActive).forEach(placeSingle);
    // Веер (несколько заказов на одном адресе) не двигается: если он налезает на уже поставленные плашки —
    // сворачиваем его в одну метку «N заказов здесь», по нажатию откроется их список.
    const fans = new Map<string, HTMLElement[]>();
    this.overlay.querySelectorAll<HTMLElement>('[data-g]').forEach(el => fans.set(el.dataset.g!, (fans.get(el.dataset.g!) || []).concat(el)));
    [...fans.values()].sort((a, b) => +b.some(isActive) - +a.some(isActive)).forEach(fan => {
      const rects = fan.map(rectOf);
      const pinEls = fan.filter(el => el.dataset.kind === 'pin');
      if (!pinEls.length || fan.some(isActive) || !rects.some(r => hits(grow(r, 2)))) { boxes.push(...rects); return; }
      const ids = pinEls.map(el => el.dataset.id!).concat(fan.flatMap(el => (el.dataset.ids || '').split(',').filter(Boolean)));
      const badge = document.createElement('div');
      badge.dataset.kind = 'stackmore';
      badge.dataset.ids = ids.join(',');
      badge.title = 'Заказы на этом адресе';
      badge.textContent = ids.length + ' ' + plural(ids.length, 'заказ', 'заказа', 'заказов') + ' здесь';
      badge.style.cssText = 'position:absolute;left:' + pinEls[0].style.left + ';top:' + pinEls[0].style.top + ';transform:translate(-50%,-50%);z-index:4;' +
        'pointer-events:auto;cursor:pointer;padding:5px 9px;box-sizing:border-box;white-space:nowrap;font-family:var(--font-heading,sans-serif);' +
        'font-weight:600;font-size:12.5px;line-height:1;letter-spacing:.06em;color:#fff;background:' + ACCENT + ';border:1px solid ' + DEEP +
        ';box-shadow:0 3px 10px rgba(31,45,58,.22)';
      fan.forEach(el => el.remove());
      this.overlay.appendChild(badge);
      // Метка тоже не ложится на соседей: пробуем чуть ниже, сбоку, выше своей точки.
      const x0 = parseFloat(badge.style.left) || 0, y0 = parseFloat(badge.style.top) || 0;
      const b0 = badge.getBoundingClientRect();
      const bx = b0.width / 2 + 8, by = b0.height + 6;
      const spot = [[0, 0], [0, by], [bx, 0], [-bx, 0], [0, -by], [bx, by], [-bx, by], [0, 2 * by]].find(([dx, dy]) => {
        badge.style.left = (x0 + dx) + 'px'; badge.style.top = (y0 + dy) + 'px';
        return !hits(grow(badge.getBoundingClientRect(), 2));
      });
      if (!spot) { badge.style.left = x0 + 'px'; badge.style.top = y0 + 'px'; }
      // Не уходит за край карты: у правого края надпись «N заказов здесь» обрезалась.
      const bb = badge.getBoundingClientRect();
      let bdx = 0;
      if (bb.right > host.right - 6) bdx = host.right - 6 - bb.right;
      if (bb.left + bdx < host.left + 6) bdx = host.left + 6 - bb.left;
      if (bdx) badge.style.left = ((parseFloat(badge.style.left) || 0) + bdx) + 'px';
      boxes.push(bdx ? { left: bb.left + bdx, right: bb.right + bdx, top: bb.top, bottom: bb.bottom } : bb);
    });
    const baseDot = this.overlay.querySelector<HTMLElement>('[data-kind="base"]');
    if (baseDot) boxes.push(baseDot.getBoundingClientRect());
    const baseEl = this.overlay.querySelector<HTMLElement>('[data-kind="baselabel"]');
    if (baseEl) {
      // Подпись остаётся у точки: если справа занято — перебрасываем её влево.
      if (hits(grow(baseEl.getBoundingClientRect(), 2)) && baseDot) {
        const w = baseEl.getBoundingClientRect().width;
        const dotLeft = parseFloat(baseDot.style.left) || 0;
        baseEl.style.left = (dotLeft - 13 - w) + 'px';
        // И слева занято (плотный город) — подпись убираем, остаётся кольцо базы: иначе она закрывает кружок с числом.
        if (hits(grow(baseEl.getBoundingClientRect(), 2))) baseEl.style.display = 'none';
      }
      if (baseEl.style.display !== 'none') boxes.push(baseEl.getBoundingClientRect());
    }
    els.filter(el => !isActive(el)).forEach(placeSingle);
    // Плашка, которой не нашлось места, сворачивается в точку на своей координате — и та может оказаться под строкой поиска.
    Array.from(this.overlay.querySelectorAll<HTMLElement>('[data-kind="pin"]:not([data-active="1"]), [data-kind="stackmore"]')).filter(covered).forEach(el => el.remove());
  }
}
