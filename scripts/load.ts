// Нагрузочная проверка поиска и карточки заказа.
//   npm run load -- --seed 20000                  добавить синтетические заказы (только не в продакшене)
//   npm run load -- --url http://localhost:3000 --seconds 20 --concurrency 32
// Печатает RPS, p50/p95/p99 и ошибки по каждому сценарию.
import { CITY_COORDS } from '../lib/catalog';
import { pool } from '../server/db';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

async function seed(n: number) {
  if (process.env.NODE_ENV === 'production') throw new Error('Синтетические заказы в продакшене запрещены.');
  const emp = await pool().query<{ id: string }>(`SELECT id FROM users WHERE login = 'aigul_t'`);
  if (!emp.rows[0]) throw new Error('Сначала npm run db:seed');
  const cities = Object.entries(CITY_COORDS);
  const types = ['snow', 'ice', 'grass', 'street', 'green', 'load', 'trash', 'leaves'];
  for (let done = 0; done < n; done += 1000) {
    const k = Math.min(1000, n - done);
    await pool().query(
      `INSERT INTO jobs (employer_id, type_id, title, description, address, lat, lng, district, pay, unit, pay_type, date, volume, crew, urgent, access, tools)
       SELECT $1, t, 'Нагрузка ' || g, 'Синтетический заказ для нагрузочной проверки', c || ', тестовая ул., ' || g,
              lat + (random() - .5) * .6, lng + (random() - .5) * .9, c, (500 + random() * 9500)::int, 'за заказ', 'перевод на карту',
              current_date + (random() * 20)::int, 'по договорённости', 1, random() < .1, '{}', 'нужен свой инвентарь'
         FROM generate_series(1, $2) g,
              LATERAL (SELECT ($3::text[])[1 + (random() * (array_length($3::text[], 1) - 1))::int] AS c) cc,
              LATERAL (SELECT (($4::float8[])[array_position($3::text[], cc.c)]) AS lat, (($5::float8[])[array_position($3::text[], cc.c)]) AS lng) ll,
              LATERAL (SELECT ($6::text[])[1 + (random() * (array_length($6::text[], 1) - 1))::int] AS t) tt`,
      [emp.rows[0].id, k, cities.map(c => c[0]), cities.map(c => c[1][0]), cities.map(c => c[1][1]), types]);
    process.stdout.write('\rдобавлено ' + (done + k));
  }
  await pool().query('ANALYZE jobs');
  console.log('\nготово');
}

type Stat = { ok: number; err: number; ms: number[] };

async function run(url: string, seconds: number, concurrency: number) {
  const cities = Object.values(CITY_COORDS);
  const today = new Date().toISOString().slice(0, 10);
  const nums = (await pool().query<{ num: string }>(`SELECT num FROM jobs ORDER BY random() LIMIT 500`)).rows.map(r => r.num);
  const scenarios: Record<string, () => string> = {
    'поиск рядом': () => { const c = cities[Math.floor(Math.random() * cities.length)]; return `/api/jobs?today=${today}&lat=${c[0]}&lng=${c[1]}&km=50`; },
    'поиск с текстом': () => { const c = cities[Math.floor(Math.random() * cities.length)]; return `/api/jobs?today=${today}&lat=${c[0]}&lng=${c[1]}&q=${encodeURIComponent('снег')}`; },
    'карточка заказа': () => `/api/jobs/${nums[Math.floor(Math.random() * nums.length)]}`
  };
  const stats: Record<string, Stat> = Object.fromEntries(Object.keys(scenarios).map(k => [k, { ok: 0, err: 0, ms: [] }]));
  const names = Object.keys(scenarios);
  const end = Date.now() + seconds * 1000;
  // Лимит геокодера и поиска по IP: каждый «клиент» — со своим адресом (TRUST_PROXY_HOPS=1 на стенде).
  const worker = async (w: number) => {
    while (Date.now() < end) {
      const name = names[Math.floor(Math.random() * names.length)];
      const t0 = performance.now();
      try {
        const r = await fetch(url + scenarios[name](), { headers: { 'x-forwarded-for': '10.1.' + (w >> 8) + '.' + (w & 255) } });
        await r.arrayBuffer();
        if (r.ok) stats[name].ok++; else stats[name].err++;
      } catch { stats[name].err++; }
      stats[name].ms.push(performance.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(0) : '—'; };
  console.table(Object.fromEntries(names.map(n => [n, {
    'запросов/с': (stats[n].ms.length / seconds).toFixed(1), 'p50, мс': q(stats[n].ms, .5), 'p95, мс': q(stats[n].ms, .95), 'p99, мс': q(stats[n].ms, .99), 'ошибок': stats[n].err
  }])));
}

async function main() {
  const n = parseInt(arg('seed', '0'), 10);
  if (n > 0) await seed(n);
  else await run(arg('url', 'http://localhost:3000'), parseInt(arg('seconds', '20'), 10), parseInt(arg('concurrency', '32'), 10));
}

main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool().end());
