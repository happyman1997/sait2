import type { ReactNode } from 'react';
import { AppShell } from '@/components/app/AppShell';
import { currentUser } from '@/server/http';

export const dynamic = 'force-dynamic';

// Общая оболочка «Карта / Мои смены / Отклики»: шапка, живые события, «Сообщения», окно отзыва.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const u = await currentUser();
  return <AppShell me={u && { name: u.name, role: u.role, city: u.city, baseLat: u.base_lat, baseLng: u.base_lng }}>{children}</AppShell>;
}
