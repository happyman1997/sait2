'use client';

import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { ChatDock } from './ChatDock';
import { LiveProvider, useLive, type Me } from './Live';
import { MobileBar, MobileNav } from './MobileShell';
import { NotifyRail } from './NotifyRail';
import { ReviewModal } from './ReviewModal';
import sty from './AppShell.module.css';

function Inner({ children }: { children: ReactNode }) {
  const { me, unread, dock, setDock, place, setRail } = useLive();
  const path = usePathname();
  // Переход в другой раздел сворачивает «Сообщения» в полосу — окно не закрывает кнопки новой страницы.
  useEffect(() => { setDock({ open: false }); setRail(null); }, [path, setDock, setRail]);
  return (
    <div className={sty.cfa14b4e}>
      <MobileBar />
      <AppHeader wideOnly={!!me} me={me && { name: me.name, role: me.role, city: me.city, avatarUrl: me.avatarUrl, isStaff: me.isStaff }} unread={unread}
        chatActive={dock.open} onChat={() => setDock({ open: !dock.open, view: dock.view })}
        onHome={() => window.dispatchEvent(new Event('arena:home'))} />
      <div className={sty.c5e48755}>{children}</div>
      <MobileNav />
      <ChatDock place={place} />
      <ReviewModal />
      <NotifyRail />
    </div>
  );
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  return <LiveProvider me={me}><Inner>{children}</Inner></LiveProvider>;
}
