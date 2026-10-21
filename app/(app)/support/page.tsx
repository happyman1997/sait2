import { redirect } from 'next/navigation';
import { SupportPage } from '@/components/app/SupportPage';
import { currentUser } from '@/server/http';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Поддержка — Арена Работ' };

// Раздел сотрудников; остальных — на страницу помощи с адресом поддержки.
export default async function Support() {
  const u = await currentUser();
  if (!u?.is_staff) redirect('/help');
  return <SupportPage />;
}
