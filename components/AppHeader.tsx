'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { css } from '@/lib/css';
import { initialsOf } from './app/ui';

export type HeaderUser = { name: string; role: 'freelancer' | 'employer'; city: string; avatarUrl?: string | null } | null;

const TAB = (active: boolean) => css('flex: none; white-space: nowrap; cursor: pointer; transition: background .15s, color .15s; background: ' +
  (active ? 'var(--color-accent)' : 'transparent') + '; border: 1px solid ' + (active ? 'var(--color-accent)' : 'transparent') +
  '; color: ' + (active ? '#fff' : 'rgba(242, 239, 236, .82)') + '; box-shadow: ' + (active ? '0 2px 8px color-mix(in srgb, var(--color-accent) 34%, transparent)' : 'none') +
  '; font-family: var(--font-heading); font-weight: 600; font-size: 14.5px; letter-spacing: .04em; padding: 9px 16px; text-decoration: none');

const HBTN = 'height: clamp(38px, 5vw, 46px); font-size: clamp(13px, 1.4vw, 15px); letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; flex: 0 0 auto';

// Шапка приложения (тёмная полоса прототипа). Клик по логотипу — на главную, панели закрываются.
export function AppHeader({ me, onHome, unread = 0, onChat, chatActive = false, wideOnly = false }: {
  me: HeaderUser; onHome?: () => void; unread?: number; onChat?: () => void; chatActive?: boolean;
  /** На узком экране вошедшего пользователя шапку заменяет мобильная полоса. */
  wideOnly?: boolean;
}) {
  const path = usePathname();
  const tabs = !me ? [] : me.role === 'employer'
    ? [{ href: '/', label: 'Карта' }, { href: '/mine', label: 'Мои заказы' }, { href: '/apps', label: 'Отклики' }]
    : [{ href: '/', label: 'Карта' }, { href: '/mine', label: 'Мои смены' }];

  return (
    <div className={'nav dark-bar' + (wideOnly ? ' only-wide' : '')} style={css('display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; padding: clamp(11px, 1.6vw, 18px) max(clamp(14px, 2vw, 24px), calc((100% - 1440px) / 2)); min-height: clamp(70px, 10vw, 112px); flex: none; background: var(--ink); color: #f2efec')}>
      <Link href="/" onClick={onHome} title="На главную" aria-label="Арена Работы — на главную" style={css('display: flex; align-items: center; gap: clamp(10px, 1.2vw, 16px); flex: 0 1 auto; min-width: 0; color: inherit; text-decoration: none')}>
        <span aria-hidden="true" style={css('width: clamp(44px, 6vw, 84px); height: clamp(44px, 6vw, 84px); flex: none; border: 1px dashed rgba(242, 239, 236, .45)')} />
        <span style={css('font-family: var(--font-heading); font-weight: 600; font-size: clamp(26px, 3.4vw, 50px); line-height: 1; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; min-width: 0')}>Арена Работы</span>
      </Link>

      {!me && <Link href="/auth" className="btn btn-primary" style={css(HBTN + '; padding: 0 clamp(12px, 2vw, 22px)')}>Создать профиль</Link>}

      {me && (
        <nav aria-label="Разделы" style={css('display: flex; gap: 5px; flex: 0 1 auto; flex-wrap: wrap')}>
          {tabs.map(t => (
            <Link key={t.href} href={t.href} onClick={t.href === '/' ? onHome : undefined} aria-current={path === t.href ? 'page' : undefined} style={TAB(path === t.href)}>{t.label}</Link>
          ))}
        </nav>
      )}

      {!me && <Link href="/auth?mode=login" className="btn btn-secondary" style={css(HBTN + '; padding: 0 clamp(14px, 2vw, 24px)')}>Войти</Link>}

      <div style={{ flex: 1 }} />

      {me && (
        <div style={css('position: relative; display: flex; align-items: center; gap: 10px; flex: none')}>
          <button onClick={onChat} title="Чат" aria-label={'Чат' + (unread ? ', непрочитанных: ' + unread : '')}
            style={css('position: relative; flex: none; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 999px; cursor: pointer; background: ' +
              (chatActive ? 'var(--color-accent)' : 'transparent') + '; border: 1px solid ' + (chatActive ? 'var(--color-accent)' : 'rgba(242, 239, 236, .32)') + '; color: ' + (chatActive ? '#fff' : 'rgba(242, 239, 236, .8)'))}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
            {unread > 0 && <span style={css('position: absolute; top: -3px; right: -3px; min-width: 17px; height: 17px; box-sizing: border-box; padding: 0 4px; border-radius: 999px; background: var(--color-accent); color: #fff; font-family: var(--font-heading); font-size: 11.5px; line-height: 17px; text-align: center')}>{unread}</span>}
          </button>
          <Link href="/profile" title="Профиль" aria-current={path === '/profile' ? 'page' : undefined}
            style={css('flex: none; display: inline-flex; align-items: center; gap: 9px; padding: 3px 12px 3px 3px; min-height: 42px; box-sizing: border-box; cursor: pointer; border-radius: 999px; font-family: var(--font-body); text-decoration: none; background: ' +
              (path === '/profile' ? 'var(--color-accent)' : 'transparent') + '; border: 1px solid ' + (path === '/profile' ? 'var(--color-accent)' : 'rgba(242, 239, 236, .34)'))}>
            <div style={css('position: relative; flex: none; width: 34px; height: 34px; border-radius: 999px; overflow: hidden; background: var(--color-accent); display: grid; place-items: center; font-family: var(--font-heading); font-size: 14px; color: #fff')}>
              {me.avatarUrl
                ? <img src={me.avatarUrl} alt="" style={css('position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover')} />
                : initialsOf(me.name)}
            </div>
            <div style={css('min-width: 0; text-align: left; line-height: 1.15')}>
              <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 15px; letter-spacing: .03em; text-transform: uppercase; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px')}>{me.name}</div>
              <div style={css('font-size: 12px; color: rgba(242, 239, 236, .72); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px')}>{(me.role === 'employer' ? 'Работодатель' : 'Исполнитель') + (me.city ? ' · ' + me.city : '')}</div>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
