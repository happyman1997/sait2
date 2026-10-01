// Подготовка своей карты (без обращений к зарубежным серверам из браузера пользователя):
//   node deploy/map-setup.mjs https://arenarabot.ru [папка=deploy/map]
// Скачивает стиль liberty (OpenFreeMap), шрифты подписей и значки, переписывает адреса в стиле на свой сайт:
// стиль — /map/style.json, тайлы — /map/russia.pmtiles (собирает Planetiler, см. DEPLOY.md), шрифты и значки — /map/…
// Нужен Node 18+ и доступ в интернет на время подготовки. Повторный запуск докачивает недостающее.
import fs from 'node:fs';
import path from 'node:path';

const publicUrl = (process.argv[2] || '').replace(/\/$/, '');
const dir = process.argv[3] || 'deploy/map';
const SOURCE_STYLE = process.env.MAP_SOURCE_STYLE || 'https://tiles.openfreemap.org/styles/liberty';
if (!/^https?:\/\//.test(publicUrl)) { console.error('Укажите адрес сайта: node deploy/map-setup.mjs https://arenarabot.ru'); process.exit(1); }

const get = async (url) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url).catch(() => null);
    if (r?.ok) return Buffer.from(await r.arrayBuffer());
    if (r && r.status === 404) return null;
    await new Promise(res => setTimeout(res, 1000 * (i + 1)));
  }
  throw new Error('не скачалось: ' + url);
};
const save = (file, buf) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); };
const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); };

const style = JSON.parse((await get(SOURCE_STYLE)).toString());

// Шрифты подписей: все наборы из слоёв, диапазоны по 256 символов (недостающие у источника — пропускаются).
const stacks = new Set();
for (const l of style.layers) {
  const f = l.layout?.['text-font'];
  if (Array.isArray(f) && f.every(x => typeof x === 'string')) stacks.add(f.join(','));
}
const jobs = [];
for (const s of stacks) for (let r = 0; r < 65536; r += 256) jobs.push([s, r + '-' + (r + 255)]);
let fonts = 0;
await pool(jobs, 16, async ([s, range]) => {
  const file = path.join(dir, 'fonts', s, range + '.pbf');
  if (fs.existsSync(file)) { fonts++; return; }
  const buf = await get(style.glyphs.replace('{fontstack}', encodeURIComponent(s)).replace('{range}', range));
  if (buf) { save(file, buf); fonts++; }
});
console.log('шрифты:', [...stacks].join(' | '), '—', fonts, 'файлов');

// Значки (sprite): обычный и @2x.
const sprites = Array.isArray(style.sprite) ? style.sprite : [{ id: 'default', url: style.sprite }];
for (const s of sprites) {
  for (const ext of ['.json', '.png', '@2x.json', '@2x.png']) {
    const buf = await get(s.url + ext);
    if (buf) save(path.join(dir, 'sprites', s.id + ext), buf);
  }
}
console.log('значки:', sprites.map(s => s.id).join(', '));

// Стиль: всё — со своего сайта.
const vector = Object.entries(style.sources).find(([, src]) => src.type === 'vector');
if (!vector) throw new Error('в стиле нет векторного источника');
style.sources[vector[0]] = { type: 'vector', url: 'pmtiles://' + publicUrl + '/map/russia.pmtiles',
  attribution: '© <a href="https://openmaptiles.org">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">участники OpenStreetMap</a>' };
style.glyphs = publicUrl + '/map/fonts/{fontstack}/{range}.pbf';
style.sprite = Array.isArray(style.sprite) ? sprites.map(s => ({ id: s.id, url: publicUrl + '/map/sprites/' + s.id })) : publicUrl + '/map/sprites/default';
save(path.join(dir, 'style.json'), Buffer.from(JSON.stringify(style)));
console.log('стиль:', path.join(dir, 'style.json'));
if (!fs.existsSync(path.join(dir, 'russia.pmtiles'))) console.log('Тайлов ещё нет — соберите russia.pmtiles (DEPLOY.md, раздел «Своя карта»).');
