'use client';

// Поиск в каталоге подработки: по мере ввода — подходящие виды работ (и по тому, как их называют: «грузчик»,
// «дворник»), по «Найти» — страница результатов /raboty?q=… с заказами. Без скриптов работает как обычная форма.
import Link from 'next/link';
import { useState } from 'react';
import { slugify, workById } from '@/lib/seo';
import { normSkill, searchSkills } from '@/lib/skills';
import sty from './Seo.module.css';

export function WorkSearch({ customs, initial = '' }: { customs: { label: string; slug: string }[]; initial?: string }) {
  const [q, setQ] = useState(initial);
  const n = normSkill(q);
  const hints = n.length < 2 ? [] : [
    ...searchSkills(q, [], 6).map(t => ({ label: t.label, href: '/raboty/' + (workById(t.id)?.slug ?? slugify(t.label)) })),
    ...customs.filter(c => normSkill(c.label).includes(n)).map(c => ({ label: c.label, href: '/raboty/' + c.slug }))
  ].slice(0, 8);
  return (
    <div className={sty.search}>
      <form action="/raboty" method="get" role="search" className={sty.searchForm}>
        <input type="search" name="q" value={q} onChange={e => setQ(e.target.value)} maxLength={100}
          className={'input ' + sty.searchInput} aria-label="Поиск подработки" placeholder="Например: снег, грузчик, покраска, Химки" />
        <button type="submit" className="btn btn-primary">Найти</button>
      </form>
      {hints.length > 0 && (
        <div className={sty.hints} aria-live="polite">
          <span className={sty.muted}>Виды работ:</span>
          {hints.map(h => <Link key={h.href} href={h.href} className={sty.chip}>{h.label}</Link>)}
        </div>
      )}
    </div>
  );
}
