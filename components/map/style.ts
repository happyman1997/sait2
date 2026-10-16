// Адрес стиля карты. В продакшене — карта OpenFreeMap через свой nginx (/ofm/styles/liberty, docker-compose.prod.yml):
// браузер обращается только к нашему сайту. При разработке — OpenFreeMap напрямую. Свой файл тайлов
// (DEPLOY.md, deploy/map-setup.mjs) — /map/style.json.
export const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
/** Тайлы OpenFreeMap — напрямую или через свой nginx. */
export const OFM_MAP = STYLE_URL.startsWith('/ofm/') || STYLE_URL.includes('openfreemap.org');
/** Свой хостинг карты: стиль со своего сайта, тайлы — один файл PMTiles, который отдаёт nginx. */
export const SELF_HOSTED_MAP = STYLE_URL.startsWith('/') && !OFM_MAP;
