import type { Metadata } from 'next';
import { MapApp } from '@/components/app/MapApp';
import { dateLabel, money } from '@/lib/jobs';
import { currentUser } from '@/server/http';
import { getJob } from '@/server/jobs';
import { meOf } from '@/server/me';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const jobOf = (raw: string | undefined) => {
  const n = parseInt(raw || '', 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * Ссылка на заказ (/?job=N) — со своим заголовком и описанием: их показывают поисковики и мессенджеры.
 * Берётся гостевая карточка: у частного заказчика — без дома и имени, как на карте.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const num = jobOf((await searchParams).job);
  if (!num) return { alternates: { canonical: '/' } };
  try {
    const j = await getJob(num, null);
    const title = j.title + ' — ' + money(j.pay, j.unit) + ' · ' + j.address + ' — Арена Работы';
    const about = (j.repeat ? 'Серия выходов с ' : 'Выход ') + dateLabel(j.date) + '. ' + j.description.replace(/\s+/g, ' ').trim();
    const description = about.length > 200 ? about.slice(0, 197).replace(/\s+\S*$/, '') + '…' : about;
    const closed = j.status !== 'open' && j.status !== 'staffed';
    return {
      title, description,
      alternates: { canonical: '/?job=' + num },
      openGraph: { title, description, type: 'website', locale: 'ru_RU', siteName: 'Арена Работы' },
      // Закрытые и отменённые заказы поисковикам не нужны.
      robots: closed ? { index: false, follow: true } : undefined
    };
  } catch {
    return { robots: { index: false, follow: true } };
  }
}

// Главная — карта заказов. Гость видит карту, список и карточки без регистрации.
export default async function Home({ searchParams }: Props) {
  const u = await currentUser();
  const sp = await searchParams;
  return (
    <MapApp
      me={meOf(u)}
      initialJob={jobOf(sp.job)}
      autoApply={sp.apply === '1'}
    />
  );
}
