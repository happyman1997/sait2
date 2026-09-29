import { redirect } from 'next/navigation';
import { ApplicantsPage } from '@/components/app/ApplicantsPage';
import { currentUser } from '@/server/http';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Отклики — Арена Работы' };

export default async function Apps() {
  const u = await currentUser();
  if (!u) redirect('/auth?mode=login');
  if (u.role !== 'employer') redirect('/mine');
  return <ApplicantsPage />;
}
