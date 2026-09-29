'use client';

import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { css } from '@/lib/css';
import { AppHeader } from '@/components/AppHeader';
import { ChatDock } from './ChatDock';
import { LiveProvider, useLive, type Me } from './Live';
import { NotifyRail } from './NotifyRail';
import { ReviewModal } from './ReviewModal';

function Inner({ children }: { children: ReactNode }) {
  const { me, unread, dock, setDock, place, setRail } = useLive();
  const path = usePathname();
  // Переход в другой раздел сворачивает «Сообщения» в полосу — окно не закрывает кнопки новой страницы.
  useEffect(() => { setDock({ open: false }); setRail(null); }, [path, setDock, setRail]);
  return (
    <div style={css('display: flex; flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden')}>
      <AppHeader me={me && { name: me.name, role: me.role, city: me.city, avatarUrl: me.avatarUrl }} unread={unread}
        chatActive={dock.open} onChat={() => setDock({ open: !dock.open, view: dock.view })}
        onHome={() => window.dispatchEvent(new Event('arena:home'))} />
      <div style={css('flex: 1; min-height: 0; display: flex; flex-direction: column')}>{children}</div>
      <ChatDock place={place} />
      <ReviewModal />
      <NotifyRail />
    </div>
  );
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  return <LiveProvider me={me}><Inner>{children}</Inner></LiveProvider>;
}
