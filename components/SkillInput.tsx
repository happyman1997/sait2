'use client';

// Поле «что умеете»: навык пишут своими словами, под полем — подходящие виды работ площадки
// («двор» → «Уличная уборка»). Выбор из подсказок — вид работ из каталога; Enter или «Добавить» — вписанное
// как есть (через запятую — несколько; «грузчик» сам станет «Погрузкой и разгрузкой», lib/skills.ts).
// Внешний вид подсказок — как у поля города (CityInput.module.css).
import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { searchSkills } from '@/lib/skills';
import sty from './CityInput.module.css';

/** Последняя часть после запятой — по ней подсказки; остальное уже вписано. */
const lastPart = (v: string) => { const i = Math.max(v.lastIndexOf(','), v.lastIndexOf(';')); return [v.slice(0, i + 1), v.slice(i + 1)] as const; };

export function SkillInput({ id, value, onChange, onAdd, onBlur, onKeyDown, exclude = [], placeholder, style, className = 'input', ariaLabel, wrapStyle, autoFocus }: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  /** id — вид работ, выбранный в подсказках; text — вписанное (вместе с id — то, что было до запятой). */
  onAdd: (r: { id?: string; text: string }) => void;
  onBlur?: () => void;
  /** Клавиши, которые поле не забрало себе (например, Escape при закрытых подсказках). */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Уже отмеченные виды работ — в подсказках не повторяем. */
  exclude?: string[];
  placeholder?: string;
  style?: CSSProperties;
  className?: string;
  ariaLabel?: string;
  wrapStyle?: CSSProperties;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const lid = useId();
  const [before, q] = lastPart(value);
  const hits = searchSkills(q, exclude);
  const show = open && hits.length > 0;

  const pick = (h: { id: string }) => {
    onAdd({ id: h.id, text: before });
    setActive(-1);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (show && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive(a => (d > 0 ? (a + 1) % hits.length : a <= 0 ? hits.length - 1 : a - 1));
      return;
    }
    if (e.key === 'Enter') {
      // Подсвеченная подсказка — она; иначе вписанное как есть (Enter не угадывает за человека).
      e.preventDefault();
      e.stopPropagation();
      if (show && active >= 0) pick(hits[active]);
      else if (value.trim()) { onAdd({ text: value }); setActive(-1); }
      return;
    }
    if (show && e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    onKeyDown?.(e);
  };

  return (
    <div className={sty.wrap} style={wrapStyle}>
      <input id={id} className={className} style={style} value={value} placeholder={placeholder} aria-label={ariaLabel} autoFocus={autoFocus}
        role="combobox" aria-autocomplete="list" aria-expanded={show} aria-controls={lid}
        aria-activedescendant={show && active >= 0 ? lid + '-' + active : undefined} autoComplete="off" maxLength={300}
        onFocus={() => setOpen(true)}
        onChange={e => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onBlur={() => { setOpen(false); setActive(-1); onBlur?.(); }} onKeyDown={key} />
      {show && (
        <ul id={lid} role="listbox" className={sty.list}>
          {hits.map((h, i) => (
            <li key={h.id} id={lid + '-' + i} role="option" aria-selected={i === active} className={sty.item + (i === active ? ' ' + sty.on : '')}
              // Фокус остаётся в поле: выбор — по click.
              onPointerDown={e => e.preventDefault()} onClick={() => pick(h)} onMouseEnter={() => setActive(i)}>
              <span className={sty.name}>{h.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
