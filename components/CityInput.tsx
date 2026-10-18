'use client';

// Поле города с подсказками: под полем — города России по первым буквам, с регионом. Выбор мышью, пальцем или
// стрелками и Enter; город не из списка (посёлок, СНТ) тоже можно оставить. Список грузится при первом фокусе.
import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { cityValue, normCity, searchCities, type City } from '@/lib/cities';
import sty from './CityInput.module.css';

let loading: Promise<City[]> | null = null;
const loadCities = () => (loading ??= import('@/lib/cities.json').then(m => m.default.cities as City[]));

export function CityInput({ id, value, onChange, onPick, onKeyDown, onBlur, placeholder, style, className = 'input', ariaLabel, wrapStyle, autoFocus }: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  /** Выбран город из подсказок (уже записан через onChange). */
  onPick?: (v: string) => void;
  /** Клавиши, которые подсказки не забрали себе (например, Enter, когда список закрыт). */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Ушли из поля (выбор из подсказок фокус не снимает). */
  onBlur?: () => void;
  placeholder?: string;
  style?: CSSProperties;
  className?: string;
  ariaLabel?: string;
  /** Обёртке поля — например, flex: 1, если поле стоит в строке с кнопкой. */
  wrapStyle?: CSSProperties;
  autoFocus?: boolean;
}) {
  const [list, setList] = useState<City[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const lid = useId();

  const hits = list ? searchCities(list, value) : [];
  // Город уже выбран — список не держим открытым.
  const done = !!list && hits.length > 0 && cityValue(hits[0], list) === value.trim();
  const show = open && hits.length > 0 && !done;

  const pick = (c: City) => {
    const v = cityValue(c, list!);
    onChange(v);
    onPick?.(v);
    setOpen(false);
    setActive(-1);
  };

  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (show && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive(a => (d > 0 ? (a + 1) % hits.length : a <= 0 ? hits.length - 1 : a - 1));
      return;
    }
    if (show && e.key === 'Enter') {
      // Enter берёт подсвеченный город, а без подсветки — первый: «хим» + Enter → Химки.
      e.preventDefault();
      e.stopPropagation();
      pick(hits[active >= 0 ? active : 0]);
      return;
    }
    if (show && e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    onKeyDown?.(e);
  };

  // Ушли из поля, не выбрав: «москва» → «Москва», если такой город в списке один.
  const blur = () => {
    setOpen(false);
    setActive(-1);
    if (list && value.trim() && !done) {
      const same = list.filter(c => normCity(c[0]) === normCity(value));
      if (same.length === 1) onChange(cityValue(same[0], list));
    }
    onBlur?.();
  };

  return (
    <div className={sty.wrap} style={wrapStyle}>
      <input id={id} className={className} style={style} value={value} placeholder={placeholder} aria-label={ariaLabel} autoFocus={autoFocus}
        role="combobox" aria-autocomplete="list" aria-expanded={show} aria-controls={lid}
        aria-activedescendant={show && active >= 0 ? lid + '-' + active : undefined} autoComplete="off"
        onFocus={() => { loadCities().then(setList).catch(() => {}); setOpen(true); }}
        onChange={e => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onBlur={blur} onKeyDown={key} />
      {show && (
        <ul id={lid} role="listbox" className={sty.list}>
          {hits.map((c, i) => (
            <li key={c[0] + c[1]} id={lid + '-' + i} role="option" aria-selected={i === active} className={sty.item + (i === active ? ' ' + sty.on : '')}
              // Фокус остаётся в поле: выбор — по click, а не по уходу из поля.
              onPointerDown={e => e.preventDefault()} onClick={() => pick(c)} onMouseEnter={() => setActive(i)}>
              <span className={sty.name}>{c[0]}</span>
              {c[1] && <span className={sty.region}>{c[1]}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
