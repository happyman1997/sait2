'use client';

// Панель «Фильтры»: тип работы с автодополнением, оплата от, расстояние от базы, когда выходить.
import { useState, type KeyboardEvent } from 'react';
import { KM_STEPS } from '@/lib/catalog';
import { css } from '@/lib/css';
import { Chip } from './ui';
import sty from './FiltersPanel.module.css';

export type Filters = { types: string[]; minPay: number; km: number; when: 'any' | 'soon'; q: string };
export const EMPTY_FILTERS: Filters = { types: [], minPay: 0, km: 0, when: 'any', q: '' };
export type JobTypeRow = { id: string; label: string; custom: boolean; count: number };

export const filtersCount = (f: Filters) => (f.when === 'soon' ? 1 : 0) + (f.minPay > 0 ? 1 : 0) + (f.km ? 1 : 0) + f.types.length;

const SEC = 'display: grid; gap: 6px; padding: 14px 16px; border-top: 1px solid var(--color-divider)';
const SEC_LABEL = 'font-family: var(--font-heading); font-weight: 600; font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 62%, transparent)';
const SEC_VALUE = 'font-family: var(--font-heading); font-weight: 600; font-size: 17px; letter-spacing: .02em; color: var(--color-accent-900); white-space: nowrap';
const SCALE = 'display: flex; justify-content: space-between; font-size: 12px; color: color-mix(in srgb, var(--color-text) 62%, transparent)';

export function FiltersPanel({ filters, setFilters, types, found, baseLabel, onClose }: {
  filters: Filters; setFilters: (f: Filters) => void; types: JobTypeRow[]; found: number; baseLabel: string; onClose: () => void;
}) {
  const [typeQuery, setTypeQuery] = useState('');
  const [typeOpen, setTypeOpen] = useState(false);
  const q = typeQuery.trim().toLowerCase();
  const typeOf = (id: string) => types.find(t => t.id === id);

  const suggest = types
    .filter(t => !filters.types.includes(t.id) && (!q || t.label.toLowerCase().includes(q)))
    .sort((a, b) => (q ? (a.label.toLowerCase().indexOf(q) === 0 ? 0 : 1) - (b.label.toLowerCase().indexOf(q) === 0 ? 0 : 1) : 0) || b.count - a.count)
    .slice(0, 10);

  const pick = (id: string) => { setFilters({ ...filters, types: filters.types.includes(id) ? filters.types : filters.types.concat(id) }); setTypeQuery(''); };
  const typeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter — выбрать первый вариант, Backspace в пустом поле — удалить последний выбранный.
    if (e.key === 'Enter') { e.preventDefault(); if (suggest[0]) pick(suggest[0].id); }
    else if (e.key === 'Backspace' && !typeQuery && filters.types.length) setFilters({ ...filters, types: filters.types.slice(0, -1) });
    else if (e.key === 'Escape') setTypeOpen(false);
  };

  const kmIndex = Math.max(0, KM_STEPS.indexOf(filters.km || 0));
  const has = filtersCount(filters) > 0;

  return (
    <div>
      <div onClick={onClose} className={sty.c0a107c1} />
      <div role="dialog" aria-label="Фильтры" className={sty.c5995b2e}>
        <div className={sty.c95229b5}>
          <span className={'fh ' + sty.cc483501}>Фильтры</span>
          <span className={sty.cdde3848}>найдено {found}</span>
          <span style={{ flex: 1 }} />
          <button className={'btn btn-ghost ' + sty.c5120674} onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        <div style={css(SEC + '; gap: 8px')}>
          <div className={sty.cd286696}><span style={css(SEC_LABEL)}>Тип работы</span><span style={{ flex: 1 }} /><span style={css(SEC_VALUE)}>{filters.types.length ? filters.types.length + ' выбрано' : 'любой'}</span></div>
          <div style={{ position: 'relative' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={sty.c251ed59}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input className={'input ' + sty.cd66c52e} value={typeQuery} onChange={e => { setTypeQuery(e.target.value); setTypeOpen(true); }} onFocus={() => setTypeOpen(true)} onBlur={() => setTypeOpen(false)} onKeyDown={typeKey}
              autoComplete="off" aria-label="Тип работы" placeholder="Начните вводить: снег, газон…" />
          </div>
          {typeOpen && (
            <div role="listbox" className={sty.c0fa607f}>
              {suggest.map(t => {
                const i = q ? t.label.toLowerCase().indexOf(q) : -1;
                return (
                  <button key={t.id} role="option" aria-selected={false} onMouseDown={e => { e.preventDefault(); pick(t.id); }}
                    className={sty.c043f9fd}>
                    <span className={sty.c51bfbf5}>
                      {i >= 0 ? <>{t.label.slice(0, i)}<b className={sty.ce0dcfb9}>{t.label.slice(i, i + q.length)}</b>{t.label.slice(i + q.length)}</> : t.label}
                      {t.custom ? ' · свой' : ''}
                    </span>
                    <span className={sty.ce33f94a}>{t.count ? t.count + ' зак.' : 'нет заказов'}</span>
                  </button>
                );
              })}
              {!suggest.length && (
                <div className={sty.cd556c46}>
                  {q ? 'Нет типа «' + typeQuery.trim() + '». Типы берутся из опубликованных заказов.' : 'Все типы уже выбраны.'}
                </div>
              )}
            </div>
          )}
          {filters.types.length > 0 && (
            <div className={sty.c2bf69bb}>
              {filters.types.map(id => (
                <span key={id} className={'tag tag-accent ' + sty.c687e3e0}>
                  {typeOf(id)?.label || id}
                  <button onClick={() => setFilters({ ...filters, types: filters.types.filter(x => x !== id) })} aria-label="Убрать" className={sty.c3846a47}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={css(SEC)}>
          <div className={sty.cd286696}><span style={css(SEC_LABEL)}>Оплата от</span><span style={{ flex: 1 }} /><span style={css(SEC_VALUE)}>{filters.minPay ? 'от ' + filters.minPay.toLocaleString('ru-RU') + ' ₽' : 'любая'}</span></div>
          <input type="range" min={0} max={15000} step={500} value={filters.minPay} onChange={e => setFilters({ ...filters, minPay: +e.target.value })} aria-label="Оплата от" className={sty.ce09a478} />
          <div style={css(SCALE)}><span>любая</span><span>5 000</span><span>10 000</span><span>15 000 ₽</span></div>
        </div>

        <div style={css(SEC)}>
          <div className={sty.cd286696}><span style={css(SEC_LABEL)}>Расстояние от базы</span><span style={{ flex: 1 }} /><span style={css(SEC_VALUE)}>{filters.km ? 'до ' + filters.km + ' км' : 'любое'}</span></div>
          <div className={sty.cde09e4d}>База: {baseLabel}</div>
          <input type="range" min={0} max={8} step={1} value={kmIndex} onChange={e => setFilters({ ...filters, km: KM_STEPS[+e.target.value] })} aria-label="Расстояние от базы" className={sty.ce09a478} />
          <div style={css(SCALE)}>
            {KM_STEPS.map(v => <span key={v} style={css('min-width: 1.4em; text-align: center; ' + ((filters.km || 0) === v ? 'color: var(--color-accent-900); font-weight: 600' : ''))}>{v ? v : '∞'}</span>)}
          </div>
          <div className={sty.cc222aa4}>
            {[10, 50, 200, 0].map(v => <Chip key={v} active={(filters.km || 0) === v} onClick={() => setFilters({ ...filters, km: v })} extra="white-space: nowrap">{v ? 'до ' + v + ' км' : 'любое расстояние'}</Chip>)}
          </div>
        </div>

        <div style={css(SEC + '; gap: 8px')}>
          <span style={css(SEC_LABEL)}>Когда выходить</span>
          <div className={sty.c454c221}>
            <Chip active={filters.when === 'any'} onClick={() => setFilters({ ...filters, when: 'any' })} extra="white-space: nowrap">любые даты</Chip>
            <Chip active={filters.when === 'soon'} onClick={() => setFilters({ ...filters, when: 'soon' })} extra="white-space: nowrap">сегодня и завтра</Chip>
          </div>
        </div>

        <div className={sty.c79f2e99}>
          {has && <button className={'btn btn-ghost ' + sty.c932c509} onClick={() => setFilters({ ...EMPTY_FILTERS, q: filters.q })}>Снять всё</button>}
          <span style={{ flex: 1 }} />
          <button className={'btn btn-primary ' + sty.c932c509} onClick={onClose}>Показать {found}</button>
        </div>
      </div>
    </div>
  );
}

/** Метки активных фильтров с × — под тулбаром. */
export function ActiveFilterTags({ filters, setFilters, types }: { filters: Filters; setFilters: (f: Filters) => void; types: JobTypeRow[] }) {
  const tags: { key: string; label: string; clear: () => void }[] = [];
  filters.types.forEach(id => tags.push({ key: 't' + id, label: types.find(t => t.id === id)?.label || id, clear: () => setFilters({ ...filters, types: filters.types.filter(x => x !== id) }) }));
  if (filters.minPay) tags.push({ key: 'pay', label: 'от ' + filters.minPay.toLocaleString('ru-RU') + ' ₽', clear: () => setFilters({ ...filters, minPay: 0 }) });
  if (filters.km) tags.push({ key: 'km', label: 'до ' + filters.km + ' км', clear: () => setFilters({ ...filters, km: 0 }) });
  if (filters.when === 'soon') tags.push({ key: 'when', label: 'сегодня и завтра', clear: () => setFilters({ ...filters, when: 'any' }) });
  if (filters.q.trim()) tags.push({ key: 'q', label: '«' + filters.q.trim() + '»', clear: () => setFilters({ ...filters, q: '' }) });
  if (!tags.length) return null;
  return (
    <div className={sty.c996d16f}>
      {tags.map(t => (
        <span key={t.key} className={'tag tag-accent ' + sty.cbe753c8}>
          {t.label}
          <button onClick={t.clear} aria-label={'Убрать фильтр ' + t.label} className={sty.c3846a47}>×</button>
        </span>
      ))}
      {tags.length > 1 && <button className={'btn btn-ghost ' + sty.cd1673a6} onClick={() => setFilters(EMPTY_FILTERS)}>Снять всё</button>}
    </div>
  );
}
