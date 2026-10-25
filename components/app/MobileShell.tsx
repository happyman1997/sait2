'use client';

// Мобильная оболочка (< 720 px), как в популярных приложениях: сверху — лёгкая шапка (знак или название раздела,
// справа — журнал и чат), снизу — вкладки с иконками. У исполнителя «Карта · Поиск · Смена · Мои смены · Профиль»,
// у работодателя «Карта · Заказы · ＋ · Отклики · Профиль», у гостя «Карта · Поиск · Войти».
// На широком экране скрыта через CSS (.only-narrow).
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { initialsOf } from './ui';
import { useLive } from './Live';
import sty from './MobileShell.module.css';

export const NAV_H = 'calc(56px + env(safe-area-inset-bottom))';

type IconName = 'map' | 'search' | 'shift' | 'list' | 'plus' | 'people' | 'user' | 'bell' | 'chat';

/** Контурные иконки; у активной вкладки — закрашенные (как в Instagram). */
function Icon({ name, on = false }: { name: IconName; on?: boolean }) {
  const fill = on ? 'currentColor' : 'none';
  const cut = 'var(--tab-bg)';
  const body: Record<IconName, ReactNode> = {
    map: <><path d="M9 3.5 3.5 5.6v15l5.5-2.1 6 2.1 5.5-2.1v-15L15 5.6 9 3.5Z" fill={fill} /><path d="M9 3.5v15M15 5.6v15" stroke={on ? cut : 'currentColor'} /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.6-4.6" /></>,
    shift: <><rect x="3" y="7" width="18" height="13" rx="2.5" fill={fill} /><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7" /><path d="M3 12.5h18" stroke={on ? cut : 'currentColor'} /></>,
    list: <><rect x="4.5" y="3.5" width="15" height="17.5" rx="2.5" fill={fill} /><path d="M8.5 9h7M8.5 13h7M8.5 17h4" stroke={on ? cut : 'currentColor'} /></>,
    plus: <><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><path d="M12 8v8M8 12h8" /></>,
    people: <><circle cx="9" cy="8.5" r="3.5" fill={fill} /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5Z" fill={fill} /><path d="M16 5.2a3.3 3.3 0 0 1 0 6.6M18.5 14.8c1.7.7 2.8 2.4 3.1 4.7" /></>,
    user: <><circle cx="12" cy="8" r="4" fill={fill} /><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5Z" fill={fill} /></>,
    bell: <><path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5Z" fill={fill} /><path d="M10.3 20.5a2 2 0 0 0 3.4 0" /></>,
    chat: <path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.6-4.3A8.5 8.5 0 1 1 20.5 11.5Z" fill={fill} />
  };
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on && name === 'search' ? 2.6 : 1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{body[name]}</svg>
  );
}

const Badge = ({ n }: { n: number }) => (n > 0 ? <span className={sty.badge}>{n > 99 ? '99+' : n}</span> : null);

const TITLE: Record<string, string> = { '/shift': 'Смена', '/apps': 'Отклики', '/profile': 'Профиль', '/support': 'Поддержка' };

/** Верхняя полоса: на карте — знак площадки, в разделах — название; справа — журнал и чат (или вход для гостя). */
export function MobileBar() {
  const { me, journal, rail, setRail, unread, dock, setDock } = useLive();
  const path = usePathname();
  const title = path === '/mine' ? (me?.role === 'employer' ? 'Мои заказы' : 'Мои смены') : TITLE[path];
  return (
    <header className={'only-narrow ' + sty.bar}>
      {title
        ? <h1 className={sty.title}>{title}</h1>
        : <Link href="/" onClick={() => window.dispatchEvent(new Event('arena:home'))} className={'fh ' + sty.brand} aria-label="Арена Работ — на главную">
          <BrandMark width={25} height={21} /><span className={sty.brandText}>Арена Работ</span>
        </Link>}
      <span className={sty.grow} />
      {me ? (
        <>
          <button className={sty.iconBtn} onClick={() => setRail(rail === 'journal' ? null : 'journal')} aria-pressed={rail === 'journal'}
            aria-label={'Журнал' + (journal ? ', новых: ' + journal : '')}>
            <Icon name="bell" on={rail === 'journal'} /><Badge n={journal} />
          </button>
          <button className={sty.iconBtn} onClick={() => setDock({ open: !dock.open, view: dock.view })} aria-pressed={dock.open}
            aria-label={'Чат' + (unread ? ', непрочитанных: ' + unread : '')}>
            <Icon name="chat" on={dock.open} /><Badge n={unread} />
          </button>
        </>
      ) : (
        <Link href="/auth" className={'btn btn-primary ' + sty.signup}>Создать профиль</Link>
      )}
    </header>
  );
}

/** badge — число на вкладке; 'dot' — точка без числа (есть смена, на которую наняли). */
type Tab = { key: string; label: string; icon: IconName | 'avatar'; href?: string; act?: () => void; on: boolean; badge?: number | 'dot' };

/** Нижние вкладки: иконка и короткая подпись, у открытой вкладки иконка закрашена. */
export function MobileNav() {
  const { me, dock, setDock, mapList, setMapList, setRail, todo } = useLive();
  const path = usePathname();
  const router = useRouter();
  const onMap = path === '/';
  const free = !dock.open;
  const leave = () => { setDock({ open: false }); setRail(null); setMapList(false); };

  const map: Tab = { key: 'map', label: 'Карта', icon: 'map', href: '/', on: free && onMap && !mapList };
  const search: Tab = {
    key: 'search', label: 'Поиск', icon: 'search', on: free && onMap && mapList,
    act: () => { setDock({ open: false }); setRail(null); if (onMap) setMapList(true); else router.push('/?list=1'); }
  };
  const page = (href: string, label: string, icon: IconName, badge?: Tab['badge']): Tab => ({ key: href, label, icon, href, on: free && path === href, badge });
  const count = (n: number) => (n > 0 ? n : undefined);
  const profile: Tab = { key: '/profile', label: 'Профиль', icon: 'avatar', href: '/profile', on: free && path === '/profile' };

  const tabs: Tab[] = !me
    ? [map, search, { key: 'login', label: 'Войти', icon: 'user', href: '/auth?mode=login', on: false }]
    : me.role === 'employer'
      ? [map, page('/mine', 'Заказы', 'list', count(todo.reported.length + todo.reviews.length)), {
        key: 'new', label: 'Заказ', icon: 'plus', on: false,
        act: () => { leave(); if (onMap) window.dispatchEvent(new Event('arena:new-job')); else router.push('/?new=1'); }
      }, page('/apps', 'Отклики', 'people', count(todo.apps)), profile]
      : [map, search, page('/shift', 'Смена', 'shift', todo.shift ? 'dot' : undefined), page('/mine', 'Мои смены', 'list', count(todo.reviews.length)), profile];

  const face = (t: Tab) => t.icon !== 'avatar' ? <Icon name={t.icon} on={t.on} /> : (
    <span className={sty.avatar + (t.on ? ' ' + sty.avatarOn : '')}>
      {me?.avatarUrl ? <img src={me.avatarUrl} alt="" /> : initialsOf(me?.name || '')}
    </span>
  );

  return (
    <>
      {/* Место под фиксированные вкладки, чтобы контент не уходил под них */}
      <div className="only-narrow" aria-hidden="true" style={{ flex: 'none', height: NAV_H }} />
      <nav className={'only-narrow ' + sty.nav} aria-label="Разделы">
        {tabs.map(t => {
          const badge = t.badge === 'dot' ? <span className={sty.tabDot} aria-hidden="true" />
            : t.badge ? <span className={sty.tabBadge} aria-hidden="true">{t.badge > 9 ? '9+' : t.badge}</span> : null;
          const inner = <><span className={sty.tabIcon}>{face(t)}{badge}</span><span className={sty.tabLabel}>{t.label}</span></>;
          return t.href
            ? <Link key={t.key} href={t.href} className={sty.tab + (t.on ? ' ' + sty.tabOn : '')} aria-current={t.on ? 'page' : undefined}
              onClick={() => { if (t.key === 'map' && onMap) window.dispatchEvent(new Event('arena:home')); leave(); }}>{inner}</Link>
            : <button key={t.key} className={sty.tab + (t.on ? ' ' + sty.tabOn : '')} aria-pressed={t.on} onClick={t.act}>{inner}</button>;
        })}
      </nav>
    </>
  );
}
