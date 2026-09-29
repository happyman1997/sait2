'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { css } from '@/lib/css';
import { initialsOf } from './app/ui';

export type HeaderUser = { name: string; role: 'freelancer' | 'employer'; city: string } | null;

const TAB = (active: boolean) => css('flex: none; white-space: nowrap; cursor: pointer; transition: background .15s, color .15s; background: ' +
  (active ? 'var(--color-accent)' : 'transparent') + '; border: 1px solid ' + (active ? 'var(--color-accent)' : 'transparent') +
  '; color: ' + (active ? '#fff' : 'rgba(242, 239, 236, .82)') + '; box-shadow: ' + (active ? '0 2px 8px color-mix(in srgb, var(--color-accent) 34%, transparent)' : 'none') +
  '; font-family: var(--font-heading); font-weight: 600; font-size: 14.5px; letter-spacing: .04em; padding: 9px 16px; text-decoration: none');

const HBTN = 'height: clamp(38px, 5vw, 46px); font-size: clamp(13px, 1.4vw, 15px); letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; flex: 0 0 auto';

// Шапка приложения (тёмная полоса прототипа). Клик по логотипу — на главную, панели закрываются.
export function AppHeader({ me, onHome }: { me: HeaderUser; onHome?: () => void }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const logout = async () => {
    await api('/api/auth/logout', {}).catch(() => {});
    setMenu(false);
    router.refresh();
  };

  return (
    <div className="nav dark-bar" style={css('display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; padding: clamp(11px, 1.6vw, 18px) max(clamp(14px, 2vw, 24px), calc((100% - 1440px) / 2)); min-height: clamp(70px, 10vw, 112px); flex: none; background: var(--ink); color: #f2efec')}>
      <Link href="/" onClick={onHome} title="На главную" aria-label="Арена Работы — на главную" style={css('display: flex; align-items: center; gap: clamp(10px, 1.2vw, 16px); flex: 0 1 auto; min-width: 0; color: inherit; text-decoration: none')}>
        <span aria-hidden="true" style={css('width: clamp(44px, 6vw, 84px); height: clamp(44px, 6vw, 84px); flex: none; border: 1px dashed rgba(242, 239, 236, .45)')} />
        <span style={css('font-family: var(--font-heading); font-weight: 600; font-size: clamp(26px, 3.4vw, 50px); line-height: 1; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; min-width: 0')}>Арена Работы</span>
      </Link>

      {!me && <Link href="/auth" className="btn btn-primary" style={css(HBTN + '; padding: 0 clamp(12px, 2vw, 22px)')}>Создать профиль</Link>}

      {me && (
        <div style={css('display: flex; gap: 5px; flex: 0 0 auto; flex-wrap: nowrap')}>
          <Link href="/" onClick={onHome} style={TAB(true)}>Карта</Link>
        </div>
      )}

      {!me && <Link href="/auth?mode=login" className="btn btn-secondary" style={css(HBTN + '; padding: 0 clamp(14px, 2vw, 24px)')}>Войти</Link>}

      <div style={{ flex: 1 }} />

      {me && (
        <div ref={menuRef} style={css('position: relative; display: flex; align-items: center; gap: 10px; flex: none')}>
          <button onClick={() => setMenu(m => !m)} aria-expanded={menu} title="Профиль"
            style={css('flex: none; display: inline-flex; align-items: center; gap: 9px; padding: 3px 12px 3px 3px; min-height: 42px; cursor: pointer; border-radius: 999px; font-family: var(--font-body); background: ' +
              (menu ? 'var(--color-accent)' : 'transparent') + '; border: 1px solid ' + (menu ? 'var(--color-accent)' : 'rgba(242, 239, 236, .34)'))}>
            <div style={css('position: relative; flex: none; width: 34px; height: 34px; border-radius: 999px; overflow: hidden; background: var(--color-accent); display: grid; place-items: center; font-family: var(--font-heading); font-size: 14px; color: #fff')}>{initialsOf(me.name)}</div>
            <div style={css('min-width: 0; text-align: left; line-height: 1.15')}>
              <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 15px; letter-spacing: .03em; text-transform: uppercase; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px')}>{me.name}</div>
              <div style={css('font-size: 12px; color: rgba(242, 239, 236, .72); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px')}>{(me.role === 'employer' ? 'Работодатель' : 'Исполнитель') + (me.city ? ' · ' + me.city : '')}</div>
            </div>
          </button>
          {menu && (
            <div role="menu" style={css('position: absolute; right: 0; top: calc(100% + 8px); z-index: 120; min-width: 220px; background: var(--color-neutral-100); color: var(--color-text); border: 1px solid var(--color-divider); box-shadow: var(--shadow-lg); padding: 6px')}>
              <div style={css('padding: 8px 10px 10px; font-size: 13px; line-height: 1.4; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>Кабинет в роли аккаунта. Для второй роли нужен отдельный аккаунт.</div>
              <button role="menuitem" onClick={logout} className="btn btn-secondary btn-block" style={css('height: 38px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Выйти</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
