import { redirect } from 'next/navigation';
import { ShiftScreen } from '@/components/app/ShiftScreen';
import { currentUser } from '@/server/http';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Смена — Арена Работ' };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function Shift({ searchParams }: Props) {
  const u = await currentUser();
  if (!u) redirect('/auth?mode=login');
  // /shift?job=N — смена конкретного заказа (кнопка «Экран смены» в его карточке).
  const n = parseInt((await searchParams).job || '', 10);
  return <ShiftScreen pick={Number.isSafeInteger(n) && n > 0 ? n : null} />;
}
