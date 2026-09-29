import { notFound } from 'next/navigation';
import { SupportPage } from '@/components/app/SupportPage';
import { currentUser } from '@/server/http';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Поддержка — Арена Работы' };

// Для посторонних раздела нет — 404.
export default async function Support() {
  const u = await currentUser();
  if (!u?.is_staff) notFound();
  return <SupportPage />;
}
