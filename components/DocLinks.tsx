import Link from 'next/link';
import { css } from '@/lib/css';

// Документы площадки — в открытом доступе с любой страницы, где собираются данные (ч. 2 ст. 18.1 152-ФЗ).
export const LEGAL_DOCS = [
  ['/legal/offer', 'Оферта'], ['/legal/rules', 'Правила площадки'],
  ['/legal/personal-data', 'Политика обработки персональных данных'], ['/legal/consent', 'Согласие на обработку данных']
] as const;

/** Строка «Виды подработки · Помощь и поддержка · Документы: Оферта · Правила · Политика · Согласие». newTab — чтобы не терять заполненную форму. */
export function DocLinks({ style = '', newTab = false }: { style?: string; newTab?: boolean }) {
  return (
    <nav aria-label="Документы" style={css('font-size: 12.5px; line-height: 1.7; color: color-mix(in srgb, var(--color-text) 64%, transparent); ' + style)}>
      <Link href="/raboty" {...(newTab ? { target: '_blank' } : {})} style={{ color: 'var(--color-accent-700)' }}>Виды подработки</Link>
      {' · '}
      <Link href="/help" {...(newTab ? { target: '_blank' } : {})} style={{ color: 'var(--color-accent-700)' }}>Помощь и поддержка</Link>
      {' · '}Документы:{' '}
      {LEGAL_DOCS.map(([href, label], i) => (
        <span key={href}>
          {i > 0 && ' · '}
          <Link href={href} {...(newTab ? { target: '_blank' } : {})} style={{ color: 'var(--color-accent-700)' }}>{label}</Link>
        </span>
      ))}
    </nav>
  );
}
