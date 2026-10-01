'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import './map-skin.css';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { SeasonMapView, type LatLng, type MapCallbacks, type Pin } from './mapView';

export type SeasonMapHandle = { flyTo: (lat: number, lng: number, zoom?: number) => void };

type Props = MapCallbacks & {
  pins: Pin[];
  draft: LatLng | null;
  mode: 'employer' | 'view';
  highlight: number | null;
  anchor: LatLng | null;
  radiusKm: number;
};

export const SeasonMap = forwardRef<SeasonMapHandle, Props>(function SeasonMap(props, ref) {
  const el = useRef<HTMLDivElement>(null);
  const view = useRef<SeasonMapView | null>(null);
  const { pins, draft, mode, highlight, anchor, radiusKm, onMapClick, onPinClick, onStackClick } = props;

  useEffect(() => {
    const v = new SeasonMapView(el.current!, {});
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, []);

  useEffect(() => { view.current?.setCallbacks({ onMapClick, onPinClick, onStackClick }); }, [onMapClick, onPinClick, onStackClick]);
  useEffect(() => { view.current?.update({ pins, draft, mode, highlight, anchor, radiusKm }); }, [pins, draft, mode, highlight, anchor, radiusKm]);

  useImperativeHandle(ref, () => ({ flyTo: (lat, lng, zoom) => view.current?.flyTo(lat, lng, zoom) }), []);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={el} />
      {/* Атрибуция обязательна: данные © OpenStreetMap (ODbL), тайлы OpenFreeMap. */}
      <div style={{ position: 'absolute', right: 0, bottom: 0, zIndex: 6, padding: '2px 6px', fontSize: 10.5, lineHeight: 1.4, background: 'color-mix(in srgb, var(--color-neutral-100) 82%, transparent)', color: 'color-mix(in srgb, var(--color-text) 70%, transparent)' }}>
        <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">участники OpenStreetMap</a>
      </div>
    </div>
  );
});
