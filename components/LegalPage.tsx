import Link from 'next/link';
import type { ReactNode } from 'react';
import { css } from '@/lib/css';

export function LegalPage({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <main style={css('max-width: 760px; margin: 0 auto; padding: 32px 16px 60px; font-size: 15px; line-height: 1.6')}>
      <Link href="/" className="btn btn-secondary" style={css('height: 40px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; padding: 0 16px')}>← На главную</Link>
      <div style={css('margin-top: 24px; font-family: var(--font-heading); font-size: 12.5px; letter-spacing: .2em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 64%, transparent)')}>{kicker}</div>
      <h1 style={css('margin: 4px 0 18px; font-size: 30px; text-transform: uppercase; letter-spacing: .02em')}>{title}</h1>
      {children}
    </main>
  );
}
