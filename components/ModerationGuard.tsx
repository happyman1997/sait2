'use client';

// Глобальный фильтр запрещённых слов: запрещённое слово не даёт ввести — поле откатывается
// к предыдущему значению и открывается попап «Так написать нельзя». Сервер проверяет то же самое повторно.
import { useEffect, useRef, useState } from 'react';
import { BAD_WHY, badSpan, badWordIn, maskBad, type BadCategory } from '@/lib/moderation';

type Pop = { where: string; category: BadCategory; text: string; el: HTMLElement | null };

let showExternal: ((p: Pop) => void) | null = null;

/** Показать попап по ответу сервера (если проверку на клиенте обошли). */
export function showModeration(where: string, category: BadCategory, text = '') {
  showExternal?.({ where, category, text, el: null });
}

const isText = (el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && /^(text|search|email|tel|url|)$/i.test(el.getAttribute('type') || ''));

function fieldName(el: HTMLElement): string {
  const f = el.closest('.field');
  const lab = f?.querySelector('label');
  const own = lab ? [...lab.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : '';
  const ph = el.getAttribute('placeholder') || '';
  const guess = /сообщен|напиш/i.test(ph) ? 'Сообщение' : /снег|газон|тип/i.test(ph) ? 'Тип работы' : /поиск|адрес|город/i.test(ph) ? 'Поиск'
    : /отзыв/i.test(ph) ? 'Отзыв' : /причин/i.test(ph) ? 'Причина' : /навык/i.test(ph) ? 'Свой навык' : /инвентар/i.test(ph) ? 'Свой инвентарь' : '';
  const t = el.getAttribute('aria-label') || own || lab?.textContent?.replace(/\s*(не\s+)?обязательно\s*$/i, '') || guess || ph || 'текстовое поле';
  return t.replace(/[…:]+\s*$/, '').trim();
}

// Установщик значения в обход React — чтобы откат поля не сбил внутренний трекер значения.
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
}

export function ModerationGuard() {
  const [pop, setPop] = useState<Pop | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    showExternal = setPop;
    const good = new WeakMap<Element, string>();
    const remember = (e: Event) => { if (isText(e.target)) good.set(e.target, e.target.value); };
    const onInput = (e: Event) => {
      const el = e.target;
      if (!isText(el)) return;
      const val = el.value;
      const cat = badWordIn(val);
      if (!cat) { setTimeout(() => good.set(el, el.value), 0); return; }
      const prev = good.get(el) ?? '';
      const pos = Math.max(0, (el.selectionStart || 0) - (val.length - prev.length));
      e.stopImmediatePropagation();
      setNativeValue(el, badWordIn(prev) ? '' : prev);
      try { el.setSelectionRange(pos, pos); } catch {}
      setPop(p => p ?? { where: fieldName(el), category: cat, text: val, el });
    };
    document.addEventListener('focusin', remember, true);
    document.addEventListener('beforeinput', remember, true);
    document.addEventListener('input', onInput, true);
    return () => {
      showExternal = null;
      document.removeEventListener('focusin', remember, true);
      document.removeEventListener('beforeinput', remember, true);
      document.removeEventListener('input', onInput, true);
    };
  }, []);

  useEffect(() => { if (pop) okRef.current?.focus(); }, [pop]);

  if (!pop) return null;
  const close = () => { const el = pop.el; setPop(null); try { el?.focus(); } catch {} };
  const sp = badSpan(pop.text);
  const cut = (x: string, end: boolean) => (x.length > 40 ? (end ? x.slice(0, 40) + '…' : '…' + x.slice(-40)) : x);

  return (
    <div
      className="dialog-backdrop"
      style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: 16, background: 'color-mix(in srgb, var(--color-text) 40%, transparent)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } }}
    >
      <div className="dialog blueprint" role="alertdialog" aria-modal="true" aria-labelledby="bw-title"
        style={{ width: 420, maxWidth: '100%', boxSizing: 'border-box', position: 'relative', background: 'var(--color-bg)', boxShadow: 'var(--shadow-lg)', padding: '20px 22px' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 12, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--color-accent-900)' }}>Модерация · {pop.category}</div>
        <div className="dialog-title" id="bw-title" style={{ marginTop: 4 }}>Так написать нельзя</div>
        <div className="dialog-body" style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: 14, lineHeight: 1.45 }}>
            <span style={{ color: 'color-mix(in srgb,var(--color-text) 62%,transparent)' }}>Где</span><span>Поле «{pop.where}»</span>
            {pop.text && <>
              <span style={{ color: 'color-mix(in srgb,var(--color-text) 62%,transparent)' }}>Что</span>
              <span style={{ overflowWrap: 'anywhere' }}>
                {cut(sp.before, false)}
                <mark style={{ background: 'var(--color-accent-200)', color: 'var(--color-accent-900)', borderBottom: '2px solid var(--color-accent-900)', padding: '0 2px' }}>{maskBad(sp.hit, pop.category)}</mark>
                {cut(sp.after, true)}
              </span>
            </>}
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.45, color: 'color-mix(in srgb,var(--color-text) 75%,transparent)' }}>
            {BAD_WHY[pop.category] || 'Нарушение правил платформы.'} Выделенное не сохранено — перефразируйте.
          </div>
        </div>
        <div className="dialog-actions">
          <button ref={okRef} className="btn btn-primary blueprint" style={{ position: 'relative' }} onClick={close}>
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />Исправить
          </button>
        </div>
      </div>
    </div>
  );
}
