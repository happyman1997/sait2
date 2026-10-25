'use client';

// «Моя база» — место, от которого считаются расстояния до заказов и оповещения о сменах рядом. Один блок в профиле и в настройках.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useFlash } from '@/components/Toast';
import sty from './BaseForm.module.css';

/** set — база задана (у посёлка, которого геокодер не нашёл при регистрации, её нет: расстояния — от центра Москвы). */
export function BaseForm({ label, set, free, onDone }: { label: string; set: boolean; free: boolean; onDone?: () => void }) {
  const router = useRouter();
  const flash = useFlash();
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const change = async () => {
    const v = q.trim();
    if (!v) { setErr('Впишите населённый пункт или адрес.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api<{ base: { label: string } }>('/api/me/base', { query: v }, 'PUT');
      setQ('');
      flash('База — ' + r.base.label + '. ' + (free ? 'Расстояния и оповещения считаются от неё.' : 'Расстояния считаются от неё.'));
      router.refresh();
      window.dispatchEvent(new Event('arena:reload'));
      onDone?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Не удалось сменить базу');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className={sty.now}>
        {set
          ? <>Сейчас: <b>{label}</b>. От этого места считаются {free ? 'расстояния до заказов и оповещения о сменах рядом' : 'расстояния на карте'}.</>
          : <><b>Не указана</b> — расстояния считаются от центра Москвы{free ? ', оповещения о сменах рядом не приходят' : ''}. Впишите свой город, посёлок или адрес.</>}
      </div>
      <div className={sty.row}>
        <input className={'input ' + sty.input} value={q} onChange={e => { setQ(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') change(); }}
          aria-label={set ? 'Новая база' : 'Ваша база'} placeholder="город, посёлок или адрес" />
        <button className={'btn btn-secondary ' + sty.btn} onClick={change} disabled={busy}>{busy ? 'Ищем…' : set ? 'Сменить' : 'Сохранить'}</button>
      </div>
      {err && <div role="alert" className={sty.err}>{err}</div>}
    </div>
  );
}
