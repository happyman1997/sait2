'use client';

// Мобильная оболочка (< 720 px, как в прототипе): узкая верхняя полоса с журналом и нижнее меню
// «Карта · Смена · Отклики · Чат · Проф.». На широком экране скрыта через CSS (.only-narrow).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { css } from '@/lib/css';
import { useLive } from './Live';
import sty from './MobileShell.module.css';

export const NAV_H = 'calc(56px + env(safe-area-inset-bottom))';

const HEADING: Record<string, string> = { '/': 'карта', '/shift': 'смена', '/mine': 'мои смены', '/apps': 'отклики', '/profile': 'профиль' };

export function MobileBar() {
  const { me, journal, setRail } = useLive();
  const path = usePathname();
  if (!me) return null;
  const heading = path === '/mine' && me.role === 'employer' ? 'мои заказы' : HEADING[path] || '';
  return (
    <div className={'only-narrow ' + sty.cd052a46}>
      <Link href="/" onClick={() => window.dispatchEvent(new Event('arena:home'))} className={'fh ' + sty.c03ad802}>Арена Работы</Link>
      <span className={sty.cee04050}>{heading}</span>
      <span style={{ flex: 1 }} />
      <button onClick={() => setRail('journal')} aria-label={'Журнал' + (journal ? ', новых: ' + journal : '')}
        className={sty.c4012f9c}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {journal > 0 && <span className={'fh ' + sty.c13cd613}>{journal > 99 ? '99+' : journal}</span>}
      </button>
    </div>
  );
}

export function MobileNav() {
  const { me, unread, dock, setDock } = useLive();
  const path = usePathname();
  if (!me) return null;
  const items: { key: string; label: string; href?: string; badge?: number }[] = [
    { key: '/', label: 'Карта', href: '/' },
    { key: '/shift', label: 'Смена', href: '/shift' },
    { key: me.role === 'employer' ? '/apps' : '/mine', label: 'Отклики', href: me.role === 'employer' ? '/apps' : '/mine' },
    { key: 'chat', label: 'Чат', badge: unread },
    { key: '/profile', label: 'Проф.', href: '/profile' }
  ];
  const style = (on: boolean) => css('flex: 1; min-width: 0; min-height: 52px; cursor: pointer; background: ' + (on ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent') +
    '; border: none; border-top: 2px solid ' + (on ? 'var(--color-accent)' : 'transparent') + '; color: ' + (on ? 'var(--color-accent-900)' : 'color-mix(in srgb, var(--color-text) 70%, transparent)') +
    '; font-family: var(--font-heading); font-size: 12px; letter-spacing: .04em; text-transform: uppercase; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 0 2px; overflow: hidden; text-decoration: none');
  return (
    <>
      {/* Место под фиксированное меню, чтобы контент не уходил под него */}
      <div className="only-narrow" aria-hidden="true" style={css('flex: none; height: ' + NAV_H)} />
      <nav className={'only-narrow ' + sty.c4b8dcc6} aria-label="Разделы">
        {items.map(it => {
          const on = it.key === 'chat' ? dock.open : !dock.open && path === it.key;
          const inner = <>{it.label}{!!it.badge && <span className={sty.cedbcc9d}>{it.badge}</span>}</>;
          return it.href
            ? <Link key={it.key} href={it.href} onClick={() => setDock({ open: false })} aria-current={on ? 'page' : undefined} style={style(on)}>{inner}</Link>
            : <button key={it.key} onClick={() => setDock({ open: !dock.open, view: dock.view })} aria-pressed={on} style={style(on)}>{inner}</button>;
        })}
      </nav>
    </>
  );
}
