import { redirect } from 'next/navigation';
import { AuthScreen, type AuthMode } from '@/components/auth/AuthScreen';
import { platformStats } from '@/server/auth';
import { one } from '@/server/db';
import { currentUser } from '@/server/http';
import { enabledProviders } from '@/server/oauth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Вход и регистрация — Арена Работ' };

export default async function AuthPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const applyNum = parseInt(sp.apply || '', 10);
  const pending = Number.isSafeInteger(applyNum) && applyNum > 0
    ? await one<{ num: string; title: string }>('SELECT num, title FROM jobs WHERE num = $1', [applyNum])
    : null;
  const mode: AuthMode = sp.mode === 'login' || sp.mode === 'recover' ? sp.mode : 'signup';
  // Восстановление открыто и во входе: так пароль задают те, кто регистрировался через Яндекс ID / VK ID.
  if (mode !== 'recover' && await currentUser()) redirect(pending ? '/?job=' + pending.num : '/');
  const stats = await platformStats();
  return (
    <AuthScreen
      initialMode={mode}
      initialRole={sp.role === 'employer' && !pending ? 'employer' : 'freelancer'}
      stats={stats}
      pending={pending && { num: Number(pending.num), title: pending.title }}
      oauthProviders={enabledProviders()}
      oauthTicket={typeof sp.oauth === 'string' ? sp.oauth : null}
      oauthError={typeof sp.oauth_error === 'string' ? sp.oauth_error.slice(0, 300) : null}
    />
  );
}
