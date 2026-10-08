import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { ModerationGuard } from '@/components/ModerationGuard';
import { ToastProvider } from '@/components/Toast';
import { config } from '@/server/config';
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
    title: 'Арена Работы — сезонные смены на карте',
    description: 'Уборка снега, покос, благоустройство, стройка: работодатели публикуют смены точкой на карте, исполнители откликаются рядом с домом.'
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
