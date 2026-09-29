'use client';

// Рекламный блок с маркировкой: «Реклама», рекламодатель, erid (38-ФЗ ст. 18.1). Показ засчитывается, когда блок виден.
// В рабочем режиме реклама не показывается.
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { css } from '@/lib/css';
import { useLive } from './Live';

type Ad = { id: string; advertiser: string; title: string; line: string; cta: string; erid: string };

const seen = new Set<string>(); // один показ на загрузку страницы

export function AdSlot({ place, extra = '' }: { place: 'feed' | 'profile'; extra?: string }) {
  const { workMode, me } = useLive();
  const [ad, setAd] = useState<Ad | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const role = me?.role ?? '';

  useEffect(() => {
    let stop = false;
    api<{ ads: Ad[] }>('/api/ads?place=' + place).then(r => { if (!stop) setAd(r.ads[0] ?? null); }).catch(() => {});
    return () => { stop = true; };
  }, [place, role]);

  useEffect(() => {
    const el = ref.current;
    if (!ad || !el || seen.has(ad.id) || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => {
      if (!es.some(e => e.isIntersecting) || seen.has(ad.id)) return;
      seen.add(ad.id);
      io.disconnect();
      api('/api/ads/view', { ids: [ad.id] }).catch(() => {});
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [ad]);

  if (!ad || workMode) return null;
  return (
    <div ref={ref} aria-label="Реклама" style={css('border: 1px solid var(--color-accent); padding: 11px 13px; background: color-mix(in srgb, var(--color-accent) 7%, transparent); ' + extra)}>
      <div style={css('display: flex; justify-content: space-between; gap: 10px; align-items: baseline; flex-wrap: wrap')}>
        <span style={css('font-family: var(--font-heading); font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: var(--color-accent-900)')}>Реклама</span>
        <span style={css('font-size: 11.5px; color: color-mix(in srgb, var(--color-text) 62%, transparent)')}>{'erid: ' + ad.erid}</span>
      </div>
      <div style={css('font-family: var(--font-heading); font-size: 17px; line-height: 1.05; text-transform: uppercase; letter-spacing: .02em; margin-top: 4px')}>{ad.title}</div>
      {ad.line && <div style={css('font-size: 12.5px; line-height: 1.4; margin-top: 4px; color: color-mix(in srgb, var(--color-text) 78%, transparent)')}>{ad.line}</div>}
      <div style={css('display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 9px')}>
        <a className="btn btn-secondary" href={'/api/ads/' + ad.id + '/go'} target="_blank" rel="noopener sponsored"
          style={css('height: 32px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; padding: 0 12px; display: inline-flex; align-items: center; text-decoration: none')}>{ad.cta}</a>
        <span style={css('font-size: 11.5px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>{ad.advertiser}</span>
      </div>
    </div>
  );
}
