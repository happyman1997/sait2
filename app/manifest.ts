import type { MetadataRoute } from 'next';

// Сайт как приложение на телефоне (PWA): «Установить» в Android/Chrome, «На экран „Домой“» на iPhone —
// своя иконка, запуск без адресной строки. Иконки — из app/icon.svg (maskable: логотип в безопасной зоне,
// Android обрезает кругом или скруглённым квадратом). Ярлыки — долгое нажатие на иконку.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Арена Работ — подработка рядом с домом',
    short_name: 'Арена Работ',
    description: 'Сезонная подработка и разовые смены на карте: уборка снега, покос травы, благоустройство, погрузка.',
    lang: 'ru',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#22282e',
    theme_color: '#22282e',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts: [
      { name: 'Карта заказов', url: '/', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Мои заказы и смены', short_name: 'Мои', url: '/mine', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Профиль', url: '/profile', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] }
    ]
  };
}
