import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import Script from 'next/script';
import { Analytics } from '@/components/Analytics';
import { ServiceWorkerSetup } from '@/components/AppInstall';
import { INSTALL_CATCHER } from '@/lib/install';
import { ModerationGuard } from '@/components/ModerationGuard';
import { ToastProvider } from '@/components/Toast';
import { config } from '@/server/config';
import { OG_SIZE } from '@/server/og';
// Шрифт Golos Text — со своего сервера (раньше — Google Fonts: IP посетителя уходил за рубеж).
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/500.css';
import '@fontsource/golos-text/600.css';
import '@fontsource/golos-text/700.css';
import './globals.css';

// Адрес сайта — из окружения сервера: от него строятся полные ссылки (canonical, Open Graph).
export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(config.publicUrl()),
    title: 'Подработка рядом с домом: разовые смены на карте — Арена Работ',
    description: 'Сезонная подработка и разовые смены: уборка снега, покос травы, благоустройство, погрузка. Ставка, дата и место видны сразу, отклик без резюме.',
    applicationName: 'Арена Работ',
    // iPhone: «На экран „Домой“» — запуск как приложение (app/manifest.ts), имя под иконкой. Строка состояния —
    // тёмная, страница начинается под ней (не заходит под часы и вырез экрана).
    appleWebApp: { capable: true, title: 'Арена Работ', statusBarStyle: 'black' },
    // Next.js пишет только mobile-web-app-capable; iOS до 16.4 без этого тега открывал иконку в Safari, а не приложением.
    other: { 'apple-mobile-web-app-capable': 'yes' },
    // Коды Яндекс.Вебмастера и Google Search Console — из окружения сервера (пустые — тегов нет).
    verification: {
      ...(config.yandexVerification() ? { yandex: config.yandexVerification() } : {}),
      ...(config.googleVerification() ? { google: config.googleVerification() } : {})
    },
    // Превью ссылки в мессенджерах: картинка сайта; заголовок и описание — свои у каждой страницы (<title>).
    openGraph: { type: 'website', locale: 'ru_RU', siteName: 'Арена Работ', images: [{ url: '/api/og/site', ...OG_SIZE, alt: 'Арена Работ — сезонные смены на карте' }] },
    twitter: { card: 'summary_large_image' }
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#22282e' };

// Строгая CSP (proxy.ts): nonce свой у каждого ответа, поэтому все страницы рендерятся по запросу.
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  const metrika = config.metrikaId();
  return (
    <html lang="ru">
      <body>
        <ToastProvider>
          {children}
          <ModerationGuard />
          <ServiceWorkerSetup />
          {/* Яндекс Метрика — только после «Разрешить» в окне о статистике (components/Analytics.tsx). */}
          {metrika > 0 && <Suspense fallback={null}><Analytics id={metrika} /></Suspense>}
          {/* До оживления страницы: ловит «можно установить» (lib/install.ts); nonce Next.js ставит сам. */}
          <Script id="arena-install" strategy="beforeInteractive">{INSTALL_CATCHER}</Script>
        </ToastProvider>
      </body>
    </html>
  );
}
