'use client';

// «Назад» (кнопка телефона, жест, кнопка браузера) закрывает то, что открыто поверх страницы, — чат, список,
// фильтры, панели, — а не уводит со страницы. Открыли — в истории появляется запись; «Назад» её снимает и закрывает.
// Закрыли своей кнопкой — свою запись убираем сами (history.back), если в это время не идёт переход по ссылке.
// Next.js встраивает такие записи в свой роутер (window.history.pushState, app-router.js), перезагрузки нет.
import { useEffect, useRef } from 'react';

let seq = 0;
/** Свои history.back(): их popstate ничего не закрывает. */
let skip = 0;
/** Время последнего нажатия на ссылку: идёт переход — свою запись не трогаем, иначе «Назад» отменил бы переход. */
let linkClickAt = 0;
const listeners = new Set<(state: unknown) => void>();

if (typeof window !== 'undefined') {
  document.addEventListener('click', e => { if ((e.target as Element | null)?.closest?.('a[href]')) linkClickAt = Date.now(); }, true);
  window.addEventListener('popstate', e => {
    if (skip > 0) { skip--; return; }
    for (const l of [...listeners]) l(e.state);
  });
}

/** Сейчас идёт переход по ссылке (нажата недавно). */
export const navigatingByLink = () => Date.now() - linkClickAt < 1500;

/** Убрать текущую запись истории своим «Назад» — её popstate слоям не достанется. */
export function popOwnEntry() {
  skip++;
  window.history.back();
}

const narrow = () => window.matchMedia('(max-width: 719.98px)').matches;

/**
 * Пока open — «Назад» закрывает (вызывает close). Только на телефоне: на компьютере панели живут рядом с картой,
 * и «Назад» там привычно листает страницы.
 */
export function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    if (!open || !narrow()) return;
    const id = 'L' + ++seq;
    let pushed = false, gone = false;
    // Запись — после монтирования: в строгом режиме разработки эффект монтируется дважды, первый раз отменяется.
    const t = setTimeout(() => { window.history.pushState({ arenaLayer: id }, ''); pushed = true; }, 0);
    const onPop = (state: unknown) => {
      if ((state as { arenaLayer?: string } | null)?.arenaLayer === id) return;
      gone = true;
      closeRef.current();
    };
    listeners.add(onPop);
    return () => {
      clearTimeout(t);
      listeners.delete(onPop);
      // Снимаем запись тиком позже: если в том же действии открылось другое (заказ из списка), оно займёт эту запись.
      if (pushed && !gone) setTimeout(() => {
        if ((window.history.state as { arenaLayer?: string } | null)?.arenaLayer === id && !navigatingByLink()) popOwnEntry();
      }, 0);
    };
  }, [open]);
}
