'use client';

// Мобильная оболочка (< 720 px, как в прототипе): узкая верхняя полоса с журналом и нижнее меню
// «Карта · Смена · Отклики · Чат · Проф.». На широком экране скрыта через CSS (.only-narrow).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { css } from '@/lib/css';
import { useLive } from './Live';

export const NAV_H = 'calc(56px + env(safe-area-inset-bottom))';

const HEADING: Record<string, string> = { '/': 'карта', '/shift': 'смена', '/mine': 'мои смены', '/apps': 'отклики', '/profile': 'профиль' };

export function MobileBar() {
  const { me, journal, setRail } = useLive();
  const path = usePathname();
  if (!me) return null;
  const heading = path === '/mine' && me.role === 'employer' ? 'мои заказы' : HEADING[path] || '';
  return (
    <div className="only-narrow" style={css('flex: none; align-items: center; gap: 8px; padding: max(8px, env(safe-area-inset-top)) 10px 8px 16px; border-bottom: 1px solid var(--color-divider); background: var(--color-bg)')}>
      <Link href="/" onClick={() => window.dispatchEvent(new Event('arena:home'))} style={css('font-family: var(--font-heading); font-weight: 600; font-size: 18px; letter-spacing: .14em; text-transform: uppercase; color: inherit; text-decoration: none; white-space: nowrap')}>Арена Работы</Link>
      <span style={css('font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 62%, transparent); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{heading}</span>
      <span style={{ flex: 1 }} />
      <button onClick={() => setRail('journal')} aria-label={'Журнал' + (journal ? ', новых: ' + journal : '')}
        style={css('flex: none; position: relative; width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid var(--color-divider); background: transparent; cursor: pointer; color: inherit')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {journal > 0 && <span style={css('position: absolute; top: 3px; right: 3px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; background: var(--color-accent); color: #fff; font-family: var(--font-heading); font-size: 11px; line-height: 16px; text-align: center')}>{journal > 99 ? '99+' : journal}</span>}
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
      <nav className="only-narrow" aria-label="Разделы"
        style={css('position: fixed; left: 0; right: 0; bottom: 0; z-index: 85; padding-bottom: env(safe-area-inset-bottom); border-top: 1px solid var(--color-divider); background: var(--color-neutral-100)')}>
        {items.map(it => {
          const on = it.key === 'chat' ? dock.open : !dock.open && path === it.key;
          const inner = <>{it.label}{!!it.badge && <span style={css('min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; background: var(--color-accent); color: #fff; font-size: 11px; line-height: 16px; text-align: center')}>{it.badge}</span>}</>;
          return it.href
            ? <Link key={it.key} href={it.href} onClick={() => setDock({ open: false })} aria-current={on ? 'page' : undefined} style={style(on)}>{inner}</Link>
            : <button key={it.key} onClick={() => setDock({ open: !dock.open, view: dock.view })} aria-pressed={on} style={style(on)}>{inner}</button>;
        })}
      </nav>
    </>
  );
}
