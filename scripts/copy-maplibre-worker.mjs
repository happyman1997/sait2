// Воркер MapLibre (v6) грузится отдельным ES-модулем рядом с общим чанком. После сборки webpack
// путь относительно пакета теряется — кладём файлы установленной версии в public/maplibre/.
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('node_modules/maplibre-gl/dist');
const dst = path.resolve('public/maplibre');
fs.mkdirSync(dst, { recursive: true });
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log('maplibre worker → public/maplibre');
