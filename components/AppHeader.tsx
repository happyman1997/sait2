'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { css } from '@/lib/css';
import { initialsOf } from './app/ui';
import sty from './AppHeader.module.css';

export type HeaderUser = { name: string; role: 'freelancer' | 'employer'; city: string; avatarUrl?: string | null; isStaff?: boolean } | null;

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
  if (me?.isStaff) tabs.push({ href: '/support', label: 'Поддержка' });

  return (
    <div className={('nav dark-bar' + (wideOnly ? ' only-wide' : '')) + ' ' + sty.c8d4eda9}>
      <Link href="/" onClick={onHome} title="На главную" aria-label="Арена Работы — на главную" className={sty.ca4a0310}>
        <span aria-hidden="true" className={sty.c6261e49} />
        <span className={'fh ' + sty.c298aaa6}>Арена Работы</span>
      </Link>

      {!me && <Link href="/auth" className="btn btn-primary" style={css(HBTN + '; padding: 0 clamp(12px, 2vw, 22px)')}>Создать профиль</Link>}

      {me && (
        <nav aria-label="Разделы" className={sty.c39b724b}>
          {tabs.map(t => (
            <Link key={t.href} href={t.href} onClick={t.href === '/' ? onHome : undefined} aria-current={path === t.href ? 'page' : undefined} style={TAB(path === t.href)}>{t.label}</Link>
          ))}
        </nav>
      )}

      {!me && <Link href="/auth?mode=login" className="btn btn-secondary" style={css(HBTN + '; padding: 0 clamp(14px, 2vw, 24px)')}>Войти</Link>}

      <div style={{ flex: 1 }} />

      {me && (
        <div className={sty.c8408164}>
          <button onClick={onChat} title="Чат" aria-label={'Чат' + (unread ? ', непрочитанных: ' + unread : '')}
            style={css('position: relative; flex: none; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 999px; cursor: pointer; background: ' +
              (chatActive ? 'var(--color-accent)' : 'transparent') + '; border: 1px solid ' + (chatActive ? 'var(--color-accent)' : 'rgba(242, 239, 236, .32)') + '; color: ' + (chatActive ? '#fff' : 'rgba(242, 239, 236, .8)'))}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
            {unread > 0 && <span className={'fh ' + sty.cc4a0a94}>{unread}</span>}
          </button>
          <Link href="/profile" title="Профиль" aria-current={path === '/profile' ? 'page' : undefined}
            style={css('flex: none; display: inline-flex; align-items: center; gap: 9px; padding: 3px 12px 3px 3px; min-height: 42px; box-sizing: border-box; cursor: pointer; border-radius: 999px; font-family: var(--font-body); text-decoration: none; background: ' +
              (path === '/profile' ? 'var(--color-accent)' : 'transparent') + '; border: 1px solid ' + (path === '/profile' ? 'var(--color-accent)' : 'rgba(242, 239, 236, .34)'))}>
            <div className={'fh ' + sty.cf56b479}>
              {me.avatarUrl
                ? <img src={me.avatarUrl} alt="" className={sty.c6412d40} />
                : initialsOf(me.name)}
            </div>
            <div className={sty.cd727df3}>
              <div className={'fh ' + sty.c2515f09}>{me.name}</div>
              <div className={sty.cc8c4d89}>{(me.role === 'employer' ? 'Работодатель' : 'Исполнитель') + (me.city ? ' · ' + me.city : '')}</div>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
