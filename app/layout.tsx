import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ModerationGuard } from '@/components/ModerationGuard';
import { ToastProvider } from '@/components/Toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'Арена Работы — сезонные смены на карте',
  description: 'Уборка снега, покос, благоустройство, стройка: работодатели публикуют смены точкой на карте, исполнители откликаются рядом с домом.'
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#22282e' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&display=swap" />
      </head>
      <body>
        <ToastProvider>
          {children}
          <ModerationGuard />
        </ToastProvider>
      </body>
    </html>
  );
}
