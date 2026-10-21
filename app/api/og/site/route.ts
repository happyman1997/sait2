import { route } from '@/server/http';
import { siteOgImage } from '@/server/og';

// Картинка-превью ссылки на сайт для мессенджеров.
export const GET = route(async () => siteOgImage());
