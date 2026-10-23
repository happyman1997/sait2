import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
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
  return (
    <html lang="ru">
      <body>
        <ToastProvider>
          {children}
          <ModerationGuard />
        </ToastProvider>
      </body>
    </html>
  );
}
