// Адрес стиля карты: по умолчанию OpenFreeMap; свой хостинг (DEPLOY.md, deploy/map-setup.mjs) — относительный /map/style.json.
export const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
/** Свой хостинг карты: стиль со своего сайта, тайлы — один файл PMTiles, который отдаёт nginx. */
export const SELF_HOSTED_MAP = STYLE_URL.startsWith('/');
