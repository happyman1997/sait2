import type { Metadata } from 'next';
import { MapApp } from '@/components/app/MapApp';
import { currentUser } from '@/server/http';
import { getJob } from '@/server/jobs';
import { meOf } from '@/server/me';
import { JsonLd } from '@/components/seo/Seo';
import { jobMetadata, siteLd } from '@/server/seo';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const jobOf = (raw: string | undefined) => {
  const n = parseInt(raw || '', 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * Ссылка на заказ на карте (/?job=N) — со своим заголовком, описанием и превью (их показывают мессенджеры);
 * canonical — страница заказа /zakaz/N, где все условия текстом: в поиске она, а не карта.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const num = jobOf((await searchParams).job);
  if (!num) return { alternates: { canonical: '/' } };
  try {
    return jobMetadata(await getJob(num, null));
  } catch {
    return { robots: { index: false, follow: true } };
  }
}

// Главная — карта заказов. Гость видит карту, список и карточки без регистрации.
export default async function Home({ searchParams }: Props) {
  const u = await currentUser();
  const sp = await searchParams;
  const num = jobOf(sp.job);
  return (
    <>
      {/* Заголовок карты для поисковиков и экранных дикторов; разметка сайта — только на самой главной. */}
      <h1 className="sr-only">Подработка и разовые смены рядом с домом — карта заказов</h1>
      {!num && <JsonLd data={siteLd()} />}
      <MapApp
        me={meOf(u)}
        initialJob={num}
        autoApply={sp.apply === '1'}
        openList={sp.list === '1'}
        startNew={sp.new === '1'}
      />
    </>
  );
}
