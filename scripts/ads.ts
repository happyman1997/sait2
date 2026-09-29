// Управление рекламой без админки:
//   npm run ads -- list
//   npm run ads -- add ad.json      (поля: placement feed|profile, audience?, advertiser, advertiserInn?, title, line, cta?, url, erid, weight?, endsAt?)
//   npm run ads -- off <id> | on <id>
//   npm run ads -- report 2026-10-01 2026-10-31
import fs from 'node:fs';
import { adReport } from '../server/ads';
import { pool, query } from '../server/db';

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'list') {
    const r = await query('SELECT id, placement, audience, advertiser, title, erid, active, ends_at FROM ads ORDER BY created_at');
    console.table(r.rows);
  } else if (cmd === 'add' && a) {
    const d = JSON.parse(fs.readFileSync(a, 'utf8'));
    const r = await query<{ id: string }>(
      `INSERT INTO ads (placement, audience, advertiser, advertiser_inn, title, line, cta, url, erid, weight, ends_at)
       VALUES ($1, $2, $3, $4, $5, coalesce($6, ''), coalesce($7, 'Подробнее'), $8, $9, coalesce($10, 1), $11) RETURNING id`,
      [d.placement, d.audience ?? null, d.advertiser, d.advertiserInn ?? null, d.title, d.line ?? null, d.cta ?? null, d.url, d.erid, d.weight ?? null, d.endsAt ?? null]);
    console.log('добавлено:', r.rows[0].id);
  } else if ((cmd === 'off' || cmd === 'on') && a) {
    await query('UPDATE ads SET active = $2 WHERE id = $1', [a, cmd === 'on']);
    console.log(cmd === 'on' ? 'включено' : 'выключено');
  } else if (cmd === 'report' && a && b) {
    console.table(await adReport(a, b));
  } else {
    console.log('команды: list | add <file.json> | off <id> | on <id> | report <с> <по>');
  }
}

main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool().end());
