import { MapApp } from '@/components/app/MapApp';
import { currentUser } from '@/server/http';

export const dynamic = 'force-dynamic';

// Главная — карта заказов. Гость видит карту, список и карточки без регистрации.
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await currentUser();
  const sp = await searchParams;
  const job = parseInt(sp.job || '', 10);
  return (
    <MapApp
      me={u && { name: u.name, role: u.role, city: u.city, baseLat: u.base_lat, baseLng: u.base_lng }}
      initialJob={Number.isSafeInteger(job) && job > 0 ? job : null}
      autoApply={sp.apply === '1'}
    />
  );
}
