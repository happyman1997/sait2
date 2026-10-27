'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import './map-skin.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { SELF_HOSTED_MAP } from './style';
import { SeasonMapView, type LatLng, type MapCallbacks, type Pin } from './mapView';

export type SeasonMapHandle = { flyTo: (lat: number, lng: number, zoom?: number) => void };

type Props = MapCallbacks & {
  pins: Pin[];
  /** Точки для первого кадра (заказы от базы); без них — по меткам. */
  fit?: LatLng[];
  draft: LatLng | null;
  mode: 'employer' | 'view';
  highlight: number | null;
  anchor: LatLng | null;
  radiusKm: number;
};

export const SeasonMap = forwardRef<SeasonMapHandle, Props>(function SeasonMap(props, ref) {
  const el = useRef<HTMLDivElement>(null);
  const view = useRef<SeasonMapView | null>(null);
  const { pins, fit, draft, mode, highlight, anchor, radiusKm, onMapClick, onPinClick, onStackClick, onView } = props;

  useEffect(() => {
    const v = new SeasonMapView(el.current!, {});
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, []);

  useEffect(() => { view.current?.setCallbacks({ onMapClick, onPinClick, onStackClick, onView }); }, [onMapClick, onPinClick, onStackClick, onView]);
  useEffect(() => { view.current?.update({ pins, fit, draft, mode, highlight, anchor, radiusKm }); }, [pins, fit, draft, mode, highlight, anchor, radiusKm]);

  useImperativeHandle(ref, () => ({ flyTo: (lat, lng, zoom) => view.current?.flyTo(lat, lng, zoom) }), []);

  // Источники карты видны, когда она появилась, затем сворачиваются в «i» — через 5 с или при первом касании карты
  // (так разрешают правила атрибуции OpenStreetMap); «i» раскрывает их снова.
  const [credits, setCredits] = useState(true);
  useEffect(() => {
    const node = el.current!;
    const fold = () => setCredits(false);
    const t = setTimeout(fold, 5000);
    node.addEventListener('pointerdown', fold, { once: true });
    node.addEventListener('wheel', fold, { once: true, passive: true });
    return () => { clearTimeout(t); node.removeEventListener('pointerdown', fold); node.removeEventListener('wheel', fold); };
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={el} />
      {/* Атрибуция обязательна: данные © OpenStreetMap (ODbL); схема тайлов — OpenMapTiles, хостинг — OpenFreeMap или свой. */}
      <div data-attrib="" style={{ position: 'absolute', right: 0, bottom: 0, zIndex: 6, display: 'flex', alignItems: 'center', gap: 4, padding: credits ? '2px 4px 2px 6px' : 4, fontSize: 10.5, lineHeight: 1.4, background: credits ? 'color-mix(in srgb, var(--color-neutral-100) 82%, transparent)' : 'none', color: 'color-mix(in srgb, var(--color-text) 70%, transparent)' }}>
        {credits && <span>
          {SELF_HOSTED_MAP
            ? <a href="https://openmaptiles.org" target="_blank" rel="noreferrer">© OpenMapTiles</a>
            : <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>} · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">участники OpenStreetMap</a>
        </span>}
        <button type="button" className="tap" aria-label={credits ? 'Скрыть источники карты' : 'Источники карты'} aria-expanded={credits} onClick={() => setCredits(v => !v)}
          style={{ width: 20, height: 20, padding: 0, border: 0, borderRadius: '50%', cursor: 'pointer', font: 'italic 600 12px/20px Georgia, serif', color: 'inherit', background: 'color-mix(in srgb, var(--color-neutral-100) 82%, transparent)', boxShadow: '0 0 0 1px var(--color-divider)' }}>i</button>
      </div>
    </div>
  );
});
