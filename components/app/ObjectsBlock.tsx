'use client';

// «Мои объекты» (как в прототипе): список адресов работодателя с кнопками «Создать заказ» и «Карточка»,
// карточка объекта — название, адрес, объём, кто встречает, доступ, инвентарь и смены по объекту.
import { useEffect, useState } from 'react';
import { ACCESS, TOOLS } from '@/lib/catalog';
import { api, ApiError } from '@/lib/api';
import { css } from '@/lib/css';
import { dateLabel, jobNum } from '@/lib/jobs';
import { showModeration } from '@/components/ModerationGuard';
import { useFlash } from '@/components/Toast';
import { Chip, Corners, FIELD_ERR, LABEL, MUTED } from './ui';
import sty from './ObjectsBlock.module.css';

export type ObjectCard = {
  id: string; name: string; address: string; lat: number; lng: number; area: string; contact: string;
  access: string[]; tools: string; shifts: number; lastDate: string | null;
};

const STATUS: Record<string, string> = { open: 'идёт набор', staffed: 'набрано', reported: 'сдана', accepted: 'принята', cancelled: 'отменена' };

export function ObjectsList({ objects, onMark, onEdit }: { objects: ObjectCard[]; onMark: (o: ObjectCard) => void; onEdit: (o: ObjectCard) => void }) {
  return (
    <div className={'blueprint ' + sty.c57daa0f}>
      <Corners />
      <div style={css(LABEL)}>Мои объекты</div>
      {!objects.length && (
        <div style={css('font-size: 13px; line-height: 1.45; margin-top: 8px; ' + MUTED)}>
          Объектов пока нет. В форме заказа нажмите «Сохранить адрес как объект» — дальше заказ с этого адреса создаётся в один клик.
        </div>
      )}
      <div className={sty.c39b0f5c}>
        {objects.map(o => (
          <div key={o.id} className={sty.ccfa1a69}>
            <div className={'fh ' + sty.c583964a}>{o.name}</div>
            <div style={css('font-size: 12.5px; ' + MUTED)}>{o.address + (o.area ? ' · ' + o.area : '')}</div>
            <div style={css('font-size: 12.5px; margin-top: 3px; ' + MUTED)}>
              {(o.access.length ? o.access.join(', ') : 'доступ не указан') + ' · ' + (o.tools || 'инвентарь не указан') +
                (o.shifts ? ' · смен: ' + o.shifts : '')}
            </div>
            <div className={sty.cd0ad396}>
              <button className={'btn btn-secondary ' + sty.cbf21556} onClick={() => onMark(o)}>Создать заказ</button>
              <button className={'btn btn-ghost ' + sty.cbf21556} onClick={() => onEdit(o)}>Карточка</button>
            </div>
          </div>
        ))}
      </div>
      {objects.length > 0 && <div style={css('font-size: 12.5px; line-height: 1.4; margin-top: 8px; ' + MUTED)}>Заказ с объекта подставляет адрес, объём, доступ и инвентарь — форму заново не заполняете.</div>}
    </div>
  );
}

export function ObjectCardPanel({ object, onClose, onSaved, onDeleted, onOpenJob }: {
  object: ObjectCard; onClose: () => void; onSaved: (o: ObjectCard) => void; onDeleted: (id: string) => void; onOpenJob: (num: number) => void;
}) {
  const flash = useFlash();
  const [d, setD] = useState(object);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shifts, setShifts] = useState<{ num: number; title: string; date: string; status: string; hired: number }[] | null>(null);

  useEffect(() => {
    api<{ shifts: typeof shifts }>('/api/me/objects/' + object.id + '/shifts').then(r => setShifts(r.shifts)).catch(() => setShifts([]));
  }, [object.id]);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      // Адрес поменяли — переставляем точку объекта; не нашли — точка остаётся, адрес сохраняем как вписали.
      let point: { lat?: number; lng?: number } = {};
      if (d.address.trim() !== object.address.trim()) {
        const g = await api<{ hits: { lat: number; lng: number }[] }>('/api/geo/search?q=' + encodeURIComponent(d.address.trim())).catch(() => ({ hits: [] }));
        if (g.hits[0]) point = { lat: g.hits[0].lat, lng: g.hits[0].lng };
        else flash('Новый адрес не найден на карте — точка объекта осталась прежней');
      }
      const r = await api<{ object: ObjectCard }>('/api/me/objects/' + object.id,
        { name: d.name, address: d.address, area: d.area, contact: d.contact, access: d.access, tools: d.tools, ...point }, 'PATCH');
      flash('Объект «' + r.object.name + '» сохранён');
      onSaved(r.object);
    } catch (e) {
      if (e instanceof ApiError && e.body.moderation) showModeration(e.body.moderation.label, e.body.moderation.category);
      setErr(e instanceof ApiError ? { field: e.field, message: e.message } : { message: 'Не удалось сохранить' });
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm('Удалить объект «' + object.name + '»? Заказы с него останутся.')) return;
    try { await api('/api/me/objects/' + object.id, null, 'DELETE'); flash('Объект удалён'); onDeleted(object.id); }
    catch (e) { flash(e instanceof ApiError ? e.message : 'Не удалось удалить'); }
  };
  const field = (k: 'name' | 'address' | 'area' | 'contact', label: string, ph: string) => (
    <div className={'field ' + sty.ce5a6d3c}>
      <label htmlFor={'obj-' + k}>{label}</label>
      <input id={'obj-' + k} className="input" value={d[k]} onChange={e => setD({ ...d, [k]: e.target.value })} placeholder={ph} />
      {err?.field === k && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
    </div>
  );

  return (
    <div>
      <div className={sty.cf5c1e62}>
        <div className={'fh ' + sty.c41db1e5}>Карточка объекта</div>
        <button className={'btn btn-ghost ' + sty.c165129c} onClick={onClose}>Закрыть</button>
      </div>
      {field('name', 'Название', 'Двор на Гиляровского')}
      {field('address', 'Адрес', 'ул. Гиляровского, 24')}
      {field('area', 'Объём', '320 м²')}
      {field('contact', 'Кто встречает', 'консьерж — вход со двора')}
      <div style={css(LABEL + '; margin-top: 14px; margin-bottom: 7px')}>Доступ</div>
      <div className={sty.c2bf69bb}>
        {ACCESS.map(a => <Chip key={a} active={d.access.includes(a)} onClick={() => setD({ ...d, access: d.access.includes(a) ? d.access.filter(x => x !== a) : [...d.access, a] })}>{a}</Chip>)}
      </div>
      <div style={css(LABEL + '; margin-top: 14px; margin-bottom: 7px')}>Инвентарь</div>
      <div className={sty.c2bf69bb}>
        {TOOLS.map(t => <Chip key={t} active={d.tools === t} onClick={() => setD({ ...d, tools: d.tools === t ? '' : t })}>{t}</Chip>)}
      </div>
      <div style={css(LABEL + '; margin-top: 16px; margin-bottom: 7px')}>Смены по объекту</div>
      {shifts === null && <div style={css('font-size: 13px; ' + MUTED)}>Загружаем…</div>}
      {shifts?.length === 0 && <div style={css('font-size: 13px; ' + MUTED)}>Смен по этому объекту пока не было.</div>}
      <div className={sty.cab743e8}>
        {shifts?.map(s => (
          <button key={s.num} onClick={() => onOpenJob(s.num)} className={sty.cf1cae7a}>
            <span className={'fh ' + sty.c532e21a}>{jobNum(s.num) + ' · ' + s.title}</span>
            <span style={css('display: block; font-size: 12.5px; ' + MUTED)}>{dateLabel(s.date) + ' · ' + (STATUS[s.status] || s.status) + (s.hired ? ' · нанято ' + s.hired : '')}</span>
          </button>
        ))}
      </div>
      {err && !['name', 'address', 'area', 'contact'].includes(err.field || '') && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
      <button className={'btn btn-primary btn-block ' + sty.c8ab760c} onClick={save} disabled={busy}>Сохранить объект</button>
      <button className={'btn btn-ghost btn-block ' + sty.c0945196} onClick={remove}>Удалить объект</button>
    </div>
  );
}
