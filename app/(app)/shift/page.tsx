import { redirect } from 'next/navigation';
import { ShiftScreen } from '@/components/app/ShiftScreen';
import { currentUser } from '@/server/http';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Смена — Арена Работы' };

export default async function Shift() {
  const u = await currentUser();
  if (!u) redirect('/auth?mode=login');
  return <ShiftScreen />;
}
