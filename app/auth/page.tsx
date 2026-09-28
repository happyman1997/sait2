import { redirect } from 'next/navigation';
import { AuthScreen, type AuthMode } from '@/components/auth/AuthScreen';
import { platformStats } from '@/server/auth';
import { currentUser } from '@/server/http';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Вход и регистрация — Арена Работы' };

export default async function AuthPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentUser()) redirect('/');
  const sp = await searchParams;
  const mode: AuthMode = sp.mode === 'login' || sp.mode === 'recover' ? sp.mode : 'signup';
  const stats = await platformStats();
  return <AuthScreen initialMode={mode} initialRole={sp.role === 'employer' ? 'employer' : 'freelancer'} stats={stats} />;
}
