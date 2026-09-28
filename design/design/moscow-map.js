(function () {
  // Вся Россия: процентная сетка растянута на страну целиком (совместимо с данными платформы).
  const LAT_TOP = 71, LAT_BOTTOM = 42, LNG_LEFT = 19, LNG_RIGHT = 180;
  const KM_PER_PCT = 32.2;

  const toLatLng = (x, y) => [
    LAT_TOP + (LAT_BOTTOM - LAT_TOP) * (y / 100),
    LNG_LEFT + (LNG_RIGHT - LNG_LEFT) * (x / 100)
  ];
  const toPercent = (lat, lng) => ({
    x: ((lng - LNG_LEFT) / (LNG_RIGHT - LNG_LEFT)) * 100,
    y: ((lat - LAT_TOP) / (LAT_BOTTOM - LAT_TOP)) * 100
  });

  // Сеть медленная или пропала — не ждём геокодер дольше 5 секунд.
  const TIMEOUT_MS = 5000;
  // Имитация сбоев для прототипа: SeasonMap.sim = 'ok' | 'slow' | 'offline' | 'error' | 'empty'.
  const simulate = async (signal) => {
    const mode = (window.SeasonMap && window.SeasonMap.sim) || 'ok';
    if (mode === 'offline') { await new Promise(r => setTimeout(r, 300)); throw new Error('offline'); }
    if (mode === 'error') { await new Promise(r => setTimeout(r, 600)); throw new Error('geocoder 503'); }
    if (mode === 'empty') { await new Promise(r => setTimeout(r, 400)); return []; }
    if (mode === 'slow') {
      await new Promise((r, rej) => {
        const t = setTimeout(r, TIMEOUT_MS);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
      });
      throw Object.assign(new Error('timeout'), { name: 'AbortError' });
    }
    return null;
  };
  const getJson = async (url, signal) => {
    const simmed = await simulate(signal);
    if (simmed) return simmed;
    if (navigator.onLine === false) throw new Error('offline');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    if (signal) signal.addEventListener('abort', () => ctl.abort(), { once: true });
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: ctl.signal });
      if (!res.ok) throw new Error('geocoder ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  };
  const toHit = (hit) => {
    const lat = parseFloat(hit.lat), lng = parseFloat(hit.lon);
    const p = toPercent(lat, lng);
    const a = hit.address || {};
    const street = a.road || a.pedestrian || a.square || '';
    const city = a.city || a.town || a.village || a.municipality || '';
    const short = street ? (city ? city + ', ' : '') + street + (a.house_number ? ', ' + a.house_number : '') : '';
    return {
      lat, lng,
      x: Math.max(0, Math.min(100, p.x)),
      y: Math.max(0, Math.min(100, p.y)),
      label: short || String(hit.display_name || '').split(',').slice(0, 3).join(',').trim(),
      sub: String(hit.display_name || '').split(',').slice(-3, -1).join(',').trim()
    };
  };

  window.SeasonMap = {
    toLatLng, toPercent, kmPerPercent: KM_PER_PCT,
    // Подсказки по мере ввода: до 5 вариантов, прошлый запрос отменяется новым.
    async suggest(query, signal) {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&accept-language=ru' +
        '&countrycodes=ru&q=' + encodeURIComponent(query);
      const list = await getJson(url, signal);
      const seen = {};
      return (list || []).map(toHit).filter(h => { if (seen[h.label]) return false; seen[h.label] = 1; return true; });
    },
    bbox: { LAT_TOP, LAT_BOTTOM, LNG_LEFT, LNG_RIGHT },
    // Геокодер: Nominatim (OSM). Данные ODbL — коммерческое использование разрешено;
    // в продакшене поднимается свой инстанс Nominatim или Photon (оба open source).
    async geocode(query) {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&accept-language=ru' +
        '&countrycodes=ru&q=' + encodeURIComponent(query);
      const list = await getJson(url);
      if (!list || !list.length) return null;
      const hit = list[0];
      const lat = parseFloat(hit.lat), lng = parseFloat(hit.lon);
      const p = toPercent(lat, lng);
      return {
        lat, lng,
        x: Math.max(0, Math.min(100, p.x)),
        y: Math.max(0, Math.min(100, p.y)),
        label: String(hit.display_name || '').split(',').slice(0, 3).join(',').trim()
      };
    },
    // Обратный геокодинг: клик по карте -> человеческий адрес.
    async reverse(x, y) {
      const ll = toLatLng(x, y);
      const lat = ll[0], lng = ll[1];
      const url = 'https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&accept-language=ru' +
        '&lat=' + lat + '&lon=' + lng;
      const hit = await getJson(url);
      if (!hit || !hit.display_name) return null;
      const a = hit.address || {};
      const street = a.road || a.pedestrian || a.suburb || a.neighbourhood || '';
      const house = a.house_number ? ', ' + a.house_number : '';
      const city = a.city || a.town || a.village || a.municipality || a.county || '';
      const label = street
        ? (city && city !== street ? city + ', ' : '') + street + house
        : String(hit.display_name).split(',').slice(0, 3).join(',').trim();
      return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), label: label };
    }
  };

  // Базовая карта: OpenFreeMap (MIT, данные OSM/ODbL) — без ключей, без лимитов,
  // коммерческое использование разрешено, при необходимости хостится самостоятельно.
  const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  const GL_CSS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  const GL_JS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js';

  let glPromise = null;
  const loadGL = () => {
    if (window.maplibregl && window.maplibregl.Map) return Promise.resolve(window.maplibregl);
    if (glPromise) return glPromise;
    glPromise = new Promise((res, rej) => {
      if (!document.querySelector('link[data-maplibre]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = GL_CSS;
        link.setAttribute('data-maplibre', '');
        document.head.appendChild(link);
      }
      let s = document.querySelector('script[data-maplibre]');
      if (!s) {
        s = document.createElement('script');
        s.src = GL_JS;
        s.setAttribute('data-maplibre', '');
        document.head.appendChild(s);
      }
      s.addEventListener('load', () => res(window.maplibregl));
      s.addEventListener('error', rej);
      if (window.maplibregl && window.maplibregl.Map) res(window.maplibregl);
    });
    return glPromise;
  };

  const A = (v, fb) => 'var(' + v + ',' + fb + ')';
  const ACCENT = A('--color-accent', '#5980a6');
  const DEEP = A('--color-accent-900', '#2f4a63');
  const PAPER = A('--color-neutral-100', '#fff');
  const INK = A('--color-text', '#1d1f20');
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  // Геодезический круг для радиуса поиска (метры → полигон).
  const circlePoly = (lat, lng, km, steps) => {
    const R = 6371, d = km / R, la = lat * Math.PI / 180, lo = lng * Math.PI / 180, ring = [];
    for (let i = 0; i <= steps; i++) {
      const b = (i / steps) * 2 * Math.PI;
      const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
      const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
      ring.push([lo2 * 180 / Math.PI, la2 * 180 / Math.PI]);
    }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
  };
  const EMPTY_FC = { type: 'FeatureCollection', features: [] };

  const kmBetween = (la1, lo1, la2, lo2) => {
    const R = 6371, r = Math.PI / 180;
    const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  };

  class SeasonRealMap extends HTMLElement {
    static get observedAttributes() { return ['pins', 'draft', 'mode', 'highlight', 'radius', 'anchor', 'objects', 'home', 'zoom', 'chrome', 'fitpad']; }

    connectedCallback() {
      if (this._host) return;
      this.style.cssText = 'position:absolute;inset:0;display:block;overflow:hidden;background:' + A('--color-bg', '#f2f2f3');
      this._host = document.createElement('div');
      this._host.style.cssText = 'position:absolute;inset:0';
      this.appendChild(this._host);
      this._overlay = document.createElement('div');
      this._overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5';
      this.appendChild(this._overlay);
      this._skin();
      this._boot();
    }

    disconnectedCallback() {
      if (this._ro) this._ro.disconnect();
      window.removeEventListener('season:flyto', this._fly);
      clearInterval(this._flyPaint);
      if (this._map) { this._map.remove(); this._map = null; }
      this._host = null;
    }

    attributeChangedCallback(name) {
      if (name === 'mode') {
        const emp = this.getAttribute('mode') === 'employer';
        if (this._host) this._host.style.cursor = emp ? 'crosshair' : '';
      }
      if (name === 'radius' || name === 'anchor') this._drawRadius();
      if (name === 'pins' && this._map && !this._touched) this._fitData();
      this._paint();
    }

    // Чертёжный вид: квадратные контролы, стальные рамки.
    _skin() {
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
        '.maplibregl-ctrl-attrib,.maplibregl-ctrl-attrib-inner{display:none!important}',
        '.maplibregl-ctrl-scale{border-radius:0;border:1px solid ' + ACCENT + ';border-top:0;color:' + INK +
          ';background:color-mix(in srgb,' + PAPER + ' 82%,transparent);font-size:10px}'
      ].join('');
      document.head.appendChild(st);
    }

    async _boot() {
      const gl = await loadGL();
      if (!this._host) return;
      this._gl = gl;
      this._map = new gl.Map({
        container: this._host,
        style: STYLE_URL,
        center: [60, 57],
        zoom: 3,
        minZoom: 0,
        maxZoom: 17,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: false
      });
      this._map.touchZoomRotate.disableRotation();
      if (this.getAttribute('chrome') !== 'off') {
        this._map.addControl(new gl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-left');
        this._map.addControl(new gl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      }

      // Не ждём события 'load': в встроенном превью rAF может не тикать и оно не наступает.
      const start = () => {
        if (!this._map || this._ready) return;
        this._ready = true;
        this._ruLabels();
        this._drawRadius();
        this._fitData();
        this._paint();
      };
      this._map.on('styledata', () => { this._ruLabels(); this._drawRadius(); start(); });
      this._map.on('load', start);
      setTimeout(start, 900);
      this._paint();

      this._map.on('move', () => this._paint());
      this._map.on('zoom', () => this._paint());
      this._map.on('moveend', () => this._paint());
      this._map.on('resize', () => this._paint());

      this._map.on('click', (ev) => {
        const p = toPercent(ev.lngLat.lat, ev.lngLat.lng);
        window.dispatchEvent(new CustomEvent('season:mapclick', {
          detail: {
            x: Math.max(0, Math.min(100, p.x)),
            y: Math.max(0, Math.min(100, p.y)),
            lat: ev.lngLat.lat, lng: ev.lngLat.lng
          }
        }));
      });

      // Автоподгонка кадра работает, пока пользователь сам не тронул карту.
      ['wheel', 'pointerdown', 'dblclick'].forEach(t =>
        this._host.addEventListener(t, () => { this._touched = true; }, { passive: true }));

      this._fly = (e) => {
        if (!this._map) return;
        this._touched = true;
        const ll = toLatLng(e.detail.x, e.detail.y);
        const zoom = Math.max(this._map.getZoom(), e.detail.zoom || 8);
        this._map.easeTo({ center: [ll[1], ll[0]], zoom, duration: 620, easing: (t) => t * (2 - t) });
        clearInterval(this._flyPaint);
        const tick = () => { this._map && (this._map.triggerRepaint(), this._paint()); };
        this._flyPaint = setInterval(tick, 40);
        setTimeout(() => { clearInterval(this._flyPaint); tick(); }, 700);
        tick();
      };
      window.addEventListener('season:flyto', this._fly);

      this._ro = new ResizeObserver(() => {
        if (!this._map) return;
        this._map.resize();
        if (this._ready && !this._touched) this._fitData();
      });
      this._ro.observe(this);

      // Страховка от сред, где rAF и 'styledata' не тикают: короткий ограниченный опрос.
      let tries = 0;
      const settle = setInterval(() => {
        if (!this._map || ++tries > 24) { clearInterval(settle); return; }
        this._map.resize();
        if (!this._touched) this._fitData();
        this._ruLabels();
        this._paint();
        if (this._ruDone && tries > 3) clearInterval(settle);
      }, 250);
    }

    // Открываемся на городе соискателя: метки в радиусе HOME_KM от него.
    // Без пола зума — fitBounds сам выбирает масштаб, и он всегда честно соблюдён.
    _fitData() {
      if (!this._map || !this._gl) return;
      const fixed = parseFloat(this.getAttribute('zoom'));
      if (isFinite(fixed)) {
        const h = this._parse('home') || { lat: 55.751, lng: 37.618 };
        this._map.jumpTo({ center: [h.lng, h.lat], zoom: fixed });
        this._map.triggerRepaint();
        return;
      }
      const pins = this._parse('pins') || [];
      if (!pins.length) {
        this._map.fitBounds([[LNG_LEFT, LAT_BOTTOM], [LNG_RIGHT, LAT_TOP]], { padding: 12, animate: false });
        this._map.triggerRepaint();
        return;
      }
      const home = this._parse('home') || { lat: 55.751, lng: 37.618 };
      const all = pins.map(p => toLatLng(p.x, p.y));
      const dist = all.map(ll => kmBetween(ll[0], ll[1], home.lat, home.lng));
      // Растим радиус от города соискателя, пока в кадр не попадёт хотя бы MIN_SHOWN предложений.
      const MIN_SHOWN = 8;
      const RINGS = [400, 700, 1000, 1500, 2500];
      let use = null;
      for (let i = 0; i < RINGS.length; i++) {
        const set = all.filter((ll, k) => dist[k] <= RINGS[i]);
        if (set.length >= Math.min(MIN_SHOWN, all.length)) { use = set; break; }
      }
      if (!use) use = all;
      const b = new this._gl.LngLatBounds();
      const padAttr = this._parse('fitpad');
      const pad = padAttr || 44;
      if (use.length >= 2) {
        use.forEach(ll => b.extend([ll[1], ll[0]]));
        this._map.fitBounds(b, { padding: pad, maxZoom: 10, animate: false });
      } else {
        this._map.jumpTo({ center: [home.lng, home.lat], zoom: 8 });
      }
      this._map.triggerRepaint();
    }

    // Развод плашек по фактическим прямоугольникам: пересекающуюся поднимаем и удлиняем ножку.
    _deoverlap() {
      const grow = (r, m) => ({ left: r.left - m, right: r.right + m, top: r.top - m, bottom: r.bottom + m });
      const all = Array.from(this._overlay.querySelectorAll('[data-kind="pin"]'));
      const els = all.filter(el => el.children.length >= 3 && el.dataset.stack !== '1');
      const stacked = all.filter(el => el.dataset.stack === '1');
      let clusters = Array.from(this._overlay.querySelectorAll('[data-kind="cluster"]'));
      const host = this._host.getBoundingClientRect();
      // Подписанные кластеры шире прежних квадратов — разводим их между собой по реальным размерам.
      const placedC = [], placedEl = [];
      const plW = (k) => { const m10 = k % 10, m100 = k % 100; return m10 === 1 && m100 !== 11 ? '\u0437\u0430\u043a\u0430\u0437' : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? '\u0437\u0430\u043a\u0430\u0437\u0430' : '\u0437\u0430\u043a\u0430\u0437\u043e\u0432'); };
      const clampIn = (c) => {
        const r = c.getBoundingClientRect();
        let dx = 0, dy = 0;
        if (r.right > host.right - 4) dx = host.right - 4 - r.right;
        if (r.left + dx < host.left + 4) dx = host.left + 4 - r.left;
        if (r.bottom > host.bottom - 4) dy = host.bottom - 4 - r.bottom;
        if (r.top + dy < host.top + 4) dy = host.top + 4 - r.top;
        if (dx) c.style.left = ((parseFloat(c.style.left) || 0) + dx) + 'px';
        if (dy) c.style.top = ((parseFloat(c.style.top) || 0) + dy) + 'px';
      };
      const hitIdx = (r) => placedC.findIndex(q => !(r.right < q.left || q.right < r.left || r.bottom < q.top || q.bottom < r.top));
      // Точка базы и её подпись — неподвижные препятствия в той же разводке; больше никто кластеры не двигает.
      const fixedZ = [];
      const dot0 = this._overlay.querySelector('[data-kind="base"]');
      if (dot0) {
        const dotRect = dot0.getBoundingClientRect();
        fixedZ.push(grow(dotRect, 3));
        const lbl0 = this._overlay.querySelector('[data-kind="baselabel"]');
        if (lbl0) {
          const lr = lbl0.getBoundingClientRect();
          fixedZ.push(grow(lr, 2));
          fixedZ.push(grow({ left: dotRect.left - 13 - lr.width, right: dotRect.left - 13, top: lr.top, bottom: lr.bottom }, 2));
        }
      }
      const hitFixed = (r) => fixedZ.some(q => !(r.right < q.left || q.right < r.left || r.bottom < q.top || q.bottom < r.top));
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
          // Места нет — вливаем в ту группу, с которой сталкиваемся.
          c.style.left = l0 + 'px'; c.style.top = t0 + 'px'; clampIn(c);
          const hi = hitIdx(grow(c.getBoundingClientRect(), 3));
          const host2 = hi >= 0 ? placedEl[hi] : null;
          const i = hi;
          if (host2) {
            const n = (+host2.dataset.n || 0) + (+c.dataset.n || 0), u = (+host2.dataset.u || 0) + (+c.dataset.u || 0);
            host2.dataset.n = n; host2.dataset.u = u;
            host2.dataset.id = host2.dataset.id + '|' + c.dataset.id;
            const cnt = host2.querySelector('[data-role="n"]'), wd = host2.querySelector('[data-role="w"]'), ur = host2.querySelector('[data-role="u"]');
            if (cnt) cnt.textContent = n;
            if (wd) wd.textContent = plW(n);
            if (u) {
              const txt = u + ' \u0441\u0440\u043e\u0447\u043d' + (u === 1 ? '\u044b\u0439' : '\u044b\u0445');
              if (ur) ur.textContent = txt;
              else host2.insertAdjacentHTML('beforeend', '<span data-role="u" style="padding:3px 9px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;background:' + PAPER + ';color:' + DEEP + '">' + txt + '</span>');
            }
            host2.title = n + ' \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0439' + (u ? ', \u0441\u0440\u043e\u0447\u043d\u044b\u0445 ' + u : '');
            c.remove();
            placedC[i] = host2.getBoundingClientRect();
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
          this._overlay.insertBefore(line, c);
          const dot = document.createElement('div');
          dot.setAttribute('data-kind', 'clusterstem');
          dot.style.cssText = 'position:absolute;left:' + l0 + 'px;top:' + t0 + 'px;width:5px;height:5px;transform:translate(-50%,-50%);background:' + DEEP + ';pointer-events:none';
          this._overlay.insertBefore(dot, c);
        }
      });
      clusters = clusters.filter(c => c.isConnected);
      const boxes = clusters.concat(all.filter(el => el.children.length === 0)).concat(stacked)
        .concat(Array.from(this._overlay.querySelectorAll('[data-kind="stackmore"]')))
        .map(el => el.getBoundingClientRect());
      const hits = (r) => boxes.some(q => !(r.right < q.left || q.right < r.left || r.bottom < q.top || q.bottom < r.top));
      // Точка базы и её подпись жёстко связаны и не двигаются: рисуются поверх остальных
      // с белым ореолом, а для плашек заказов служат препятствием.
      const baseDot = this._overlay.querySelector('[data-kind="base"]');
      if (baseDot) boxes.push(baseDot.getBoundingClientRect());
      const baseEl = this._overlay.querySelector('[data-kind="baselabel"]');
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
        const stem = el.children[el.children.length - 2];
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

    _parse(attr) {
      try { return JSON.parse(this.getAttribute(attr) || 'null'); } catch (e) { return null; }
    }

    _pt(x, y) {
      if (!this._map) return null;
      const ll = toLatLng(x, y);
      const p = this._map.project([ll[1], ll[0]]);
      return [p.x, p.y];
    }

    // Только русские подписи: name:ru с откатом на локальное название.
    _ruLabels() {
      if (!this._map || this._ruDone) return;
      let style = null;
      try { style = this._map.getStyle(); } catch (e) { return; }
      if (!style || !style.layers) return;
      const nm = ['coalesce', ['get', 'name:ru'], ['get', 'name:latin'], ['get', 'name']];
      const BORDER = /bound|admin|border|disput/i;
      const GEOPOL = /country|continent|state|region|province|disput/i;
      let set = 0;
      style.layers.forEach(l => {
        // Границы и названия стран/регионов не показываем вовсе.
        if (BORDER.test(l.id) || (l.type === 'symbol' && GEOPOL.test(l.id))) {
          try { this._map.setLayoutProperty(l.id, 'visibility', 'none'); set++; } catch (e) { /* слой ещё не готов */ }
          return;
        }
        if (l.type !== 'symbol' || !l.layout || l.layout['text-field'] === undefined) return;
        try { this._map.setLayoutProperty(l.id, 'text-field', nm); set++; } catch (e) { /* слой ещё не готов */ }
      });
      if (!set) return;
      this._ruDone = true;
      this._map.triggerRepaint();
    }

    _ensureRadiusLayers() {
      if (!this._map) return false;
      const st = this._map.getStyle && this._map.getStyle();
      if (!st || !st.layers || !st.layers.length) return false;
      if (this._map.getSource('season-radius')) return true;
      try {
        this._map.addSource('season-radius', { type: 'geojson', data: EMPTY_FC });
        this._map.addLayer({
          id: 'season-radius-fill', type: 'fill', source: 'season-radius',
          paint: { 'fill-color': '#5980a6', 'fill-opacity': 0.09 }
        });
        this._map.addLayer({
          id: 'season-radius-line', type: 'line', source: 'season-radius',
          paint: { 'line-color': '#5980a6', 'line-width': 1, 'line-dasharray': [4, 3] }
        });
        return true;
      } catch (e) { return false; }
    }

    _drawRadius() {
      if (!this._ensureRadiusLayers()) return;
      const src = this._map.getSource('season-radius');
      if (!src) return;
      const anchor = this._parse('anchor');
      const km = parseFloat(this.getAttribute('radius') || '0');
      if (!anchor || !(km > 0)) { src.setData(EMPTY_FC); return; }
      const ll = toLatLng(anchor.x, anchor.y);
      src.setData({ type: 'FeatureCollection', features: [circlePoly(ll[0], ll[1], km, 96)] });
      this._map.triggerRepaint();
    }

    _centroid(g) {
      const x = g.reduce((a, p) => a + p.x, 0) / g.length;
      const y = g.reduce((a, p) => a + p.y, 0) / g.length;
      return this._pt(x, y);
    }

    // Группы меток, попавших в одну и ту же точку на экране (один адрес).
    _coincident(pins) {
      const cells = {}, order = [];
      pins.forEach(p => {
        const pt = this._pt(p.x, p.y);
        if (!pt) return;
        const key = Math.round(pt[0] / 6) + ':' + Math.round(pt[1] / 6);
        if (!cells[key]) { cells[key] = []; order.push(key); }
        cells[key].push(p);
      });
      return order.map(k => cells[k]);
    }

    _cluster(pins) {
      const CELL = 104, cells = {};
      pins.forEach(p => {
        const pt = this._pt(p.x, p.y);
        if (!pt) return;
        const key = Math.round(pt[0] / CELL) + ':' + Math.round(pt[1] / CELL);
        (cells[key] = cells[key] || []).push(p);
      });
      const groups = Object.keys(cells).map(k => cells[k]);
      // Один проход по ИСХОДНЫМ центроидам: сливаем только перекрывающиеся соседние группы,
      // без транзитивного сцепления всей страны в один чип.
      const cens = groups.map(g => this._centroid(g));
      const taken = groups.map(() => false);
      const out = [];
      for (let i = 0; i < groups.length; i++) {
        if (taken[i]) continue;
        taken[i] = true;
        let acc = groups[i];
        if (cens[i]) {
          for (let j = i + 1; j < groups.length; j++) {
            if (taken[j] || !cens[j]) continue;
            const dx = Math.abs(cens[i][0] - cens[j][0]), dy = Math.abs(cens[i][1] - cens[j][1]);
            // Одиночная пилюля широкая — её надо разводить и с чипом кластера.
            const solo = groups[i].length === 1 || groups[j].length === 1;
            const hit = solo ? (dx < 96 && dy < 40) : Math.hypot(dx, dy) < 46;
            if (hit) { acc = acc.concat(groups[j]); taken[j] = true; }
          }
        }
        out.push(acc);
      }
      return out;
    }

    _paint() {
      if (!this._overlay || !this._map) return;
      const html = [];
      const at = (pt, w, h, css, inner, title, id, kind) =>
        '<div data-id="' + esc(id) + '" data-kind="' + kind + '" title="' + esc(title) + '" style="position:absolute;left:' +
        (pt[0] - w / 2) + 'px;top:' + (pt[1] - h / 2) + 'px;' + css + '">' + inner + '</div>';

      (this._parse('objects') || []).forEach(o => {
        const pt = this._pt(o.x, o.y);
        if (pt) html.push('<div style="position:absolute;left:' + (pt[0] - 7) + 'px;top:' + (pt[1] - 7) +
          'px;width:14px;height:14px;box-sizing:border-box;border:1px solid ' + DEEP + ';background:' + PAPER +
          ';transform:rotate(45deg)"></div>');
      });

      const pins = this._parse('pins') || [];
      const hot = String(this.getAttribute('highlight') || '');
      const near = this._map.getZoom() >= 7;
      const groups = near ? this._coincident(pins) : this._cluster(pins);
      const dense = pins.length > 14 && !near;

      // Одна точка — несколько заказов: плашки веером над общим якорем, каждая читается и кликается.
      const renderPin = (p, stackIdx, stackN) => {
          const pt = this._pt(p.x, p.y);
          if (!pt) return;
          const isHot = String(p.id) === hot;
          if (dense && !isHot && !p.active && !p.urgent) {
            html.push('<div data-id="' + esc(p.id) + '" data-kind="pin" title="' + esc(p.title) + '" style="position:absolute;left:' +
              pt[0] + 'px;top:' + pt[1] + 'px;transform:translate(-50%,-50%) rotate(45deg);width:11px;height:11px;box-sizing:border-box;' +
              'pointer-events:auto;cursor:pointer;background:' + PAPER + ';border:1.5px solid ' + ACCENT +
              ';box-shadow:0 2px 6px rgba(31,45,58,.22)"></div>');
            return;
          }
          // \u041a\u0440\u044e\u0447\u043e\u043a \u043d\u0430 \u043a\u0430\u0440\u0442\u0435 \u2014 \u0441\u0442\u0430\u0432\u043a\u0430 \u0438 \u0442\u0438\u043f \u0440\u0430\u0431\u043e\u0442\u044b, \u0430 \u043d\u0435 \u043d\u043e\u043c\u0435\u0440.
          const solid = p.active || p.urgent;
          const rate = esc(p.rate || p.num || '');
          const kind = esc(p.kind || '');
          const ink = solid ? '#fff' : INK;
          const edge = solid ? DEEP : ACCENT;
          // Плашки не должны налезать — разводим после отрисовки, по фактическим размерам (_deoverlap).
          const stem = 11 + stackIdx * 48;
          html.push('<div data-id="' + esc(p.id) + '" data-kind="pin"' + (stackN > 1 ? ' data-stack="1"' : '') + ' title="' + esc(p.title) + '" style="position:absolute;left:' +
            pt[0] + 'px;top:' + pt[1] + 'px;transform:translate(-50%,-100%) scale(' + (isHot ? 1.08 : 1) + ');transform-origin:50% 100%;' +
            'pointer-events:auto;cursor:pointer;display:flex;flex-direction:column;align-items:center;white-space:nowrap">' +
              '<span style="display:flex;align-items:stretch;box-sizing:border-box;background:' + (solid ? ACCENT : PAPER) +
                ';border:1px solid ' + edge + ';box-shadow:' + (isHot ? '0 8px 20px rgba(31,45,58,.32)' : '0 3px 10px rgba(31,45,58,.18)') + '">' +
                (p.urgent ? '<span style="width:4px;background:' + (solid ? '#fff' : ACCENT) + '"></span>' : '') +
                '<span style="display:flex;flex-direction:column;gap:1px;padding:5px 10px">' +
                  '<span style="font-family:var(--font-heading,sans-serif);font-size:15px;line-height:1;letter-spacing:.01em;color:' + ink + '">' + rate + '</span>' +
                  (kind ? '<span style="font-family:var(--font-heading,sans-serif);font-size:11px;line-height:1.1;letter-spacing:.14em;text-transform:uppercase;color:' +
                    (solid ? 'rgba(255,255,255,.85)' : '#555b60') + '">' + kind + '</span>' : '') +
                '</span>' +
              '</span>' +
              '<span style="width:1px;height:' + stem + 'px;background:' + edge + '"></span>' +
              '<span style="width:7px;height:7px;margin-top:-4px;transform:rotate(45deg);background:' + (solid ? ACCENT : PAPER) + ';border:1px solid ' + edge + '"></span>' +
            '</div>');
      };

      groups.forEach(group => {
        if (near || group.length === 1) {
          if (group.length === 1) { renderPin(group[0], 0, 1); return; }
          // Веер не должен уходить за верх карты: сколько влезло — показываем, остальные прячем в «+N».
          const anchor = this._pt(group[0].x, group[0].y);
          if (!anchor) return;
          const hostH = this._host.getBoundingClientRect().height || 0;
          // Якорь вне кадра — веер строить негде и не надо.
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
              ';border:1px solid ' + DEEP + ';box-shadow:0 3px 10px rgba(31,45,58,.22)">\u0435\u0449\u0451 ' + restN + ' \u0437\u0434\u0435\u0441\u044c</div>');
          }
          return;
        }
        const cx = group.reduce((a, p) => a + p.x, 0) / group.length;
        const cy = group.reduce((a, p) => a + p.y, 0) / group.length;
        const pt = this._centroid(group);
        if (!pt) return;
        const n = group.length;
        const urgentN = group.filter(p => p.urgent).length;
        const plural = (k, a, b, c) => { const m10 = k % 10, m100 = k % 100; return m10 === 1 && m100 !== 11 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c); };
        const word = plural(n, '\u0437\u0430\u043a\u0430\u0437', '\u0437\u0430\u043a\u0430\u0437\u0430', '\u0437\u0430\u043a\u0430\u0437\u043e\u0432');
        const big = n >= 15 ? 19 : n >= 5 ? 17 : 15;
        html.push('<div data-id="c:' + cx + ':' + cy + '" data-kind="cluster" data-n="' + n + '" data-u="' + urgentN + '" title="' + esc(n + ' \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0439' + (urgentN ? ', \u0441\u0440\u043e\u0447\u043d\u044b\u0445 ' + urgentN : '')) +
          '" style="position:absolute;left:' + pt[0] + 'px;top:' + pt[1] + 'px;transform:translate(-50%,-50%);' +
          'display:flex;flex-direction:column;align-items:stretch;box-sizing:border-box;pointer-events:auto;cursor:pointer;white-space:nowrap;' +
          'font-family:var(--font-heading,sans-serif);line-height:1;color:#fff;background:' + ACCENT + ';border:1px solid ' + DEEP + ';box-shadow:0 4px 14px rgba(31,45,58,.26)">' +
          '<span style="display:flex;align-items:baseline;gap:5px;padding:6px 9px"><span data-role="n" style="font-size:' + big + 'px">' + n + '</span>' +
          '<span data-role="w" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.88)">' + word + '</span></span>' +
          (urgentN ? '<span data-role="u" style="padding:3px 9px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;background:' + PAPER + ';color:' + DEEP + '">' +
            urgentN + ' \u0441\u0440\u043e\u0447\u043d' + (urgentN === 1 ? '\u044b\u0439' : '\u044b\u0445') + '</span>' : '') + '</div>');
      });

      // Точка базирования исполнителя.
      const base = this._parse('anchor');
      if (base && this.getAttribute('mode') !== 'employer') {
        const bp = this._pt(base.x, base.y);
        if (bp) {
          html.push('<div data-kind="base" title="\u041c\u043e\u044f \u0431\u0430\u0437\u0430" style="position:absolute;left:' + bp[0] + 'px;top:' + bp[1] +
            'px;transform:translate(-50%,-50%);width:15px;height:15px;box-sizing:border-box;border-radius:50%;pointer-events:none;z-index:5;background:' + PAPER +
            ';border:3px solid ' + DEEP + ';box-shadow:0 0 0 3px ' + PAPER + ',0 2px 8px rgba(31,45,58,.4)"></div>');
          html.push('<div data-kind="baselabel" style="position:absolute;left:' + (bp[0] + 13) + 'px;top:' + bp[1] +
            'px;transform:translateY(-50%);pointer-events:none;z-index:5;font-family:var(--font-heading,sans-serif);font-size:11px;letter-spacing:.16em;' +
            'text-transform:uppercase;padding:2px 7px;white-space:nowrap;border:1px solid ' + PAPER + ';background:' + DEEP + ';color:#fff">\u043c\u043e\u044f \u0431\u0430\u0437\u0430</div>');
        }
      }

      const d = this._parse('draft');
      if (d) {
        const pt = this._pt(d.x, d.y);
        if (pt) html.push(at(pt, 34, 34,
          'width:34px;height:34px;display:grid;place-items:center;box-sizing:border-box;font-family:var(--font-heading,sans-serif);' +
          'font-size:17px;background:' + PAPER + ';color:' + INK + ';border:1px dashed ' + ACCENT,
          '+', 'новая метка', '', 'draft'));
      }

      this._overlay.innerHTML = html.join('');
      this._deoverlap();
      this._overlay.querySelectorAll('[data-kind="pin"]').forEach(el => {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          window.dispatchEvent(new CustomEvent('season:pinclick', { detail: { id: isNaN(+el.dataset.id) ? el.dataset.id : +el.dataset.id } }));
        });
      });
      this._overlay.querySelectorAll('[data-kind="stackmore"]').forEach(el => {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const ids = String(el.dataset.ids || '').split(',').filter(Boolean).map(v => isNaN(+v) ? v : +v);
          window.dispatchEvent(new CustomEvent('season:stackclick', { detail: { ids } }));
        });
      });
      this._overlay.querySelectorAll('[data-kind="cluster"]').forEach(el => {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const pts = el.dataset.id.split('|').map(s => s.split(':'));
          const cx = pts.reduce((a, p) => a + (+p[1]), 0) / pts.length, cy = pts.reduce((a, p) => a + (+p[2]), 0) / pts.length;
          window.dispatchEvent(new CustomEvent('season:flyto', { detail: { x: +cx, y: +cy, zoom: Math.min(this._map.getZoom() + 3, 12) } }));
        });
      });
    }
  }

  if (!window.customElements.get('moscow-map')) window.customElements.define('moscow-map', SeasonRealMap);
})();
