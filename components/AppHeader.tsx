'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { css } from '@/lib/css';

type Me = { name: string; role: 'freelancer' | 'employer'; city: string } | null;

// Шапка приложения (тёмная полоса прототипа). Вкладки, чат и реклама появятся вместе с картой.
export function AppHeader({ me }: { me: Me }) {
  const router = useRouter();
  const logout = async () => {
    await api('/api/auth/logout', {}).catch(() => {});
    router.refresh();
  };
  return (
    <div className="nav dark-bar" style={css('display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; padding: clamp(11px, 1.6vw, 18px) max(clamp(14px, 2vw, 24px), calc((100% - 1440px) / 2)); min-height: clamp(70px, 10vw, 112px); flex: none; background: var(--ink); color: #f2efec')}>
      <Link href="/" title="На главную" aria-label="Арена Работы — на главную" style={css('display: flex; align-items: center; gap: clamp(10px, 1.2vw, 16px); flex: 0 1 auto; min-width: 0; color: inherit; text-decoration: none')}>
        <span aria-hidden="true" style={css('width: clamp(44px, 6vw, 84px); height: clamp(44px, 6vw, 84px); flex: none; border: 1px dashed rgba(242, 239, 236, .45)')} />
        <span style={css('font-family: var(--font-heading); font-size: clamp(26px, 3.4vw, 50px); line-height: 1; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; min-width: 0; font-weight: 600')}>Арена Работы</span>
      </Link>
      <div style={{ flex: 1 }} />
      {me ? (
        <div style={css('display: flex; align-items: center; gap: 10px; flex-wrap: wrap')}>
          <div style={css('display: grid; text-align: right; line-height: 1.25')}>
            <span style={css('font-family: var(--font-heading); font-size: 15px; font-weight: 600')}>{me.name}</span>
            <span style={css('font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: rgba(242, 239, 236, .6)')}>{me.role === 'employer' ? 'Работодатель' : 'Исполнитель'} · {me.city}</span>
          </div>
          <button onClick={logout} className="btn btn-secondary" style={css('height: 40px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; border-radius: 999px')}>Выйти</button>
        </div>
      ) : (
        <div style={css('display: flex; gap: 8px')}>
          <Link href="/auth?mode=login" className="btn btn-secondary" style={css('height: clamp(38px, 5vw, 46px); font-size: clamp(13px, 1.4vw, 15px); letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; padding: 0 clamp(12px, 2vw, 22px); border-radius: 999px')}>Войти</Link>
          <Link href="/auth" className="btn btn-primary" style={css('height: clamp(38px, 5vw, 46px); font-size: clamp(13px, 1.4vw, 15px); letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; padding: 0 clamp(12px, 2vw, 22px); border-radius: 999px')}>Создать профиль</Link>
        </div>
      )}
    </div>
  );
}
