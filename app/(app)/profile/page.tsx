import { redirect } from 'next/navigation';
import { ProfilePage } from '@/components/app/ProfilePage';
import { currentUser } from '@/server/http';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Профиль — Арена Работы' };

export default async function Profile() {
  const u = await currentUser();
  if (!u) redirect('/auth?mode=login');
  return <ProfilePage />;
}
