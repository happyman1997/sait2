'use client';

// Рекламный блок с маркировкой: «Реклама», рекламодатель, erid (38-ФЗ ст. 18.1). Показ засчитывается, когда блок виден.
// В рабочем режиме реклама не показывается.
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { css } from '@/lib/css';
import { useLive } from './Live';
import sty from './AdSlot.module.css';

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
      <div className={sty.cebf0f9b}>
        <span className={'fh ' + sty.ce000444}>Реклама</span>
        <span className={sty.c4e38bd9}>{'erid: ' + ad.erid}</span>
      </div>
      <div className={'fh ' + sty.ce5110ac}>{ad.title}</div>
      {ad.line && <div className={sty.c262f3c9}>{ad.line}</div>}
      <div className={sty.ce83fbc7}>
        <a className={'btn btn-secondary ' + sty.c0f0fc35} href={'/api/ads/' + ad.id + '/go'} target="_blank" rel="noopener sponsored">{ad.cta}</a>
        <span className={sty.ceb20a7e}>{ad.advertiser}</span>
      </div>
    </div>
  );
}
