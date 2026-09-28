import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';

// Простой раннер: файлы db/migrations/NNN_name.sql по порядку, каждый — в своей транзакции.
export async function migrate(p: Pool, dir = path.join(process.cwd(), 'db', 'migrations'), log = console.log) {
  await p.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await p.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(r => r.name));
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await p.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      log(`migrated: ${f}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw new Error(`Миграция ${f} не применилась: ${(e as Error).message}`);
    } finally {
      c.release();
    }
  }
}
