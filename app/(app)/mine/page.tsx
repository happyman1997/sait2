import { redirect } from 'next/navigation';
import { MyJobsPage } from '@/components/app/MyJobsPage';
import { currentUser } from '@/server/http';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Мои смены и заказы — Арена Работы' };

export default async function Mine() {
  const u = await currentUser();
  if (!u) redirect('/auth?mode=login');
  return <MyJobsPage role={u.role} />;
}
