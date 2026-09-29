'use client';

// Панель «Фильтры»: тип работы с автодополнением, оплата от, расстояние от базы, когда выходить.
import { useState, type KeyboardEvent } from 'react';
import { KM_STEPS } from '@/lib/catalog';
import { css } from '@/lib/css';
import { Chip } from './ui';

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
      <div onClick={onClose} style={css('position: fixed; inset: 0; z-index: 92')} />
      <div role="dialog" aria-label="Фильтры" style={css('position: fixed; right: 16px; bottom: 16px; z-index: 93; width: 380px; max-width: calc(100vw - 32px); box-sizing: border-box; max-height: calc(100vh - 32px); overflow-y: auto; overflow-x: hidden; background: var(--color-neutral-100); border: 1px solid var(--color-divider); box-shadow: 0 18px 48px rgba(20, 26, 32, .24)')}>
        <div style={css('display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 16px')}>
          <span style={css('font-family: var(--font-heading); font-weight: 600; font-size: 22px; line-height: 1; text-transform: uppercase; letter-spacing: .03em')}>Фильтры</span>
          <span style={css('font-size: 13px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>найдено {found}</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose} aria-label="Закрыть" style={css('width: 32px; height: 32px; padding: 0; font-size: 18px; line-height: 1')}>×</button>
        </div>

        <div style={css(SEC + '; gap: 8px')}>
          <div style={css('display: flex; align-items: baseline; gap: 8px')}><span style={css(SEC_LABEL)}>Тип работы</span><span style={{ flex: 1 }} /><span style={css(SEC_VALUE)}>{filters.types.length ? filters.types.length + ' выбрано' : 'любой'}</span></div>
          <div style={{ position: 'relative' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={css('position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: color-mix(in srgb, var(--color-text) 55%, transparent); pointer-events: none')}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input className="input" value={typeQuery} onChange={e => { setTypeQuery(e.target.value); setTypeOpen(true); }} onFocus={() => setTypeOpen(true)} onBlur={() => setTypeOpen(false)} onKeyDown={typeKey}
              autoComplete="off" aria-label="Тип работы" placeholder="Начните вводить: снег, газон…" style={css('height: 36px; min-height: 36px; width: 100%; box-sizing: border-box; font-size: 13.5px; padding: 0 10px 0 32px')} />
          </div>
          {typeOpen && (
            <div role="listbox" style={css('border: 1px solid var(--color-divider); background: var(--color-bg); max-height: 220px; overflow-y: auto; overflow-x: hidden; box-shadow: var(--shadow-md)')}>
              {suggest.map(t => {
                const i = q ? t.label.toLowerCase().indexOf(q) : -1;
                return (
                  <button key={t.id} role="option" aria-selected={false} onMouseDown={e => { e.preventDefault(); pick(t.id); }}
                    style={css('display: flex; width: 100%; align-items: baseline; gap: 10px; padding: 8px 11px; border: 0; border-bottom: 1px solid var(--color-divider); background: transparent; text-align: left; cursor: pointer; font: inherit; font-size: 13.5px; color: inherit')}>
                    <span style={css('flex: 1; min-width: 0; overflow-wrap: anywhere')}>
                      {i >= 0 ? <>{t.label.slice(0, i)}<b style={css('font-weight: 600; color: var(--color-accent-900)')}>{t.label.slice(i, i + q.length)}</b>{t.label.slice(i + q.length)}</> : t.label}
                      {t.custom ? ' · свой' : ''}
                    </span>
                    <span style={css('flex: none; font-size: 12.5px; color: color-mix(in srgb, var(--color-text) 60%, transparent)')}>{t.count ? t.count + ' зак.' : 'нет заказов'}</span>
                  </button>
                );
              })}
              {!suggest.length && (
                <div style={css('padding: 10px 11px; font-size: 13px; line-height: 1.45; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>
                  {q ? 'Нет типа «' + typeQuery.trim() + '». Типы берутся из опубликованных заказов.' : 'Все типы уже выбраны.'}
                </div>
              )}
            </div>
          )}
          {filters.types.length > 0 && (
            <div style={css('display: flex; flex-wrap: wrap; gap: 6px')}>
              {filters.types.map(id => (
                <span key={id} className="tag tag-accent" style={css('display: inline-flex; align-items: center; gap: 6px')}>
                  {typeOf(id)?.label || id}
                  <button onClick={() => setFilters({ ...filters, types: filters.types.filter(x => x !== id) })} aria-label="Убрать" style={css('all: unset; cursor: pointer; padding: 0 2px; font-size: 15px; line-height: 1')}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={css(SEC)}>
          <div style={css('display: flex; align-items: baseline; gap: 8px')}><span style={css(SEC_LABEL)}>Оплата от</span><span style={{ flex: 1 }} /><span style={css(SEC_VALUE)}>{filters.minPay ? 'от ' + filters.minPay.toLocaleString('ru-RU') + ' ₽' : 'любая'}</span></div>
          <input type="range" min={0} max={15000} step={500} value={filters.minPay} onChange={e => setFilters({ ...filters, minPay: +e.target.value })} aria-label="Оплата от" style={css('width: 100%; margin: 0; height: 26px; accent-color: var(--color-accent); cursor: pointer')} />
          <div style={css(SCALE)}><span>любая</span><span>5 000</span><span>10 000</span><span>15 000 ₽</span></div>
        </div>

        <div style={css(SEC)}>
          <div style={css('display: flex; align-items: baseline; gap: 8px')}><span style={css(SEC_LABEL)}>Расстояние от базы</span><span style={{ flex: 1 }} /><span style={css(SEC_VALUE)}>{filters.km ? 'до ' + filters.km + ' км' : 'любое'}</span></div>
          <div style={css('font-size: 12.5px; line-height: 1.4; color: color-mix(in srgb, var(--color-text) 64%, transparent)')}>База: {baseLabel}</div>
          <input type="range" min={0} max={8} step={1} value={kmIndex} onChange={e => setFilters({ ...filters, km: KM_STEPS[+e.target.value] })} aria-label="Расстояние от базы" style={css('width: 100%; margin: 0; height: 26px; accent-color: var(--color-accent); cursor: pointer')} />
          <div style={css(SCALE)}>
            {KM_STEPS.map(v => <span key={v} style={css('min-width: 1.4em; text-align: center; ' + ((filters.km || 0) === v ? 'color: var(--color-accent-900); font-weight: 600' : ''))}>{v ? v : '∞'}</span>)}
          </div>
          <div style={css('display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px')}>
            {[10, 50, 200, 0].map(v => <Chip key={v} active={(filters.km || 0) === v} onClick={() => setFilters({ ...filters, km: v })} extra="white-space: nowrap">{v ? 'до ' + v + ' км' : 'любое расстояние'}</Chip>)}
          </div>
        </div>

        <div style={css(SEC + '; gap: 8px')}>
          <span style={css(SEC_LABEL)}>Когда выходить</span>
          <div style={css('display: flex; gap: 6px; flex-wrap: wrap')}>
            <Chip active={filters.when === 'any'} onClick={() => setFilters({ ...filters, when: 'any' })} extra="white-space: nowrap">любые даты</Chip>
            <Chip active={filters.when === 'soon'} onClick={() => setFilters({ ...filters, when: 'soon' })} extra="white-space: nowrap">сегодня и завтра</Chip>
          </div>
        </div>

        <div style={css('position: sticky; bottom: 0; display: flex; justify-content: space-between; gap: 8px; padding: 10px 13px; border-top: 1px solid var(--color-divider); background: var(--color-neutral-100)')}>
          {has && <button className="btn btn-ghost" onClick={() => setFilters({ ...EMPTY_FILTERS, q: filters.q })} style={css('height: 30px; font-size: 13px')}>Снять всё</button>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={onClose} style={css('height: 30px; font-size: 13px')}>Показать {found}</button>
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
    <div style={css('display: flex; gap: 6px; flex-wrap: wrap; align-items: center')}>
      {tags.map(t => (
        <span key={t.key} className="tag tag-accent" style={css('display: inline-flex; align-items: center; gap: 6px; white-space: nowrap')}>
          {t.label}
          <button onClick={t.clear} aria-label={'Убрать фильтр ' + t.label} style={css('all: unset; cursor: pointer; padding: 0 2px; font-size: 15px; line-height: 1')}>×</button>
        </span>
      ))}
      {tags.length > 1 && <button className="btn btn-ghost" onClick={() => setFilters(EMPTY_FILTERS)} style={css('height: 26px; font-size: 12.5px')}>Снять всё</button>}
    </div>
  );
}
