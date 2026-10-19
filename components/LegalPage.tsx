import Link from 'next/link';
import type { ReactNode } from 'react';
import { LEGAL_DOCS } from './DocLinks';
import sty from './LegalPage.module.css';

export function LegalPage({ kicker, title, children, footer }: { kicker: string; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className={sty.c996d334}>
      <Link href="/" className={'btn btn-secondary ' + sty.c68b45ae}>← На главную</Link>
      <div className={'fh ' + sty.c8e4b18f}>{kicker}</div>
      <h1 className={sty.c68398ba}>{title}</h1>
      {children}
      {footer && <p className={sty.foot}>{footer}</p>}
      <nav className={sty.docs}>{LEGAL_DOCS.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}<Link href="/help">Помощь и поддержка</Link></nav>
    </main>
  );
}
