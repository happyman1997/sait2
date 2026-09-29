import { MapApp } from '@/components/app/MapApp';
import { currentUser } from '@/server/http';
import { meOf } from '@/server/me';

export const dynamic = 'force-dynamic';

// Главная — карта заказов. Гость видит карту, список и карточки без регистрации.
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await currentUser();
  const sp = await searchParams;
  const job = parseInt(sp.job || '', 10);
  return (
    <MapApp
      me={meOf(u)}
      initialJob={Number.isSafeInteger(job) && job > 0 ? job : null}
      autoApply={sp.apply === '1'}
    />
  );
}
