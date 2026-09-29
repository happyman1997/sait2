import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';

// Один пул на процесс (в dev Next перезагружает модули — держим в globalThis).
const g = globalThis as unknown as { __arenaPool?: Pool };

export function pool(): Pool {
  if (!g.__arenaPool) {
    const p = new Pool({ connectionString: config.databaseUrl(), max: 10, idleTimeoutMillis: 30_000 });
    // Обрыв простаивающего соединения не должен ронять процесс — пул переподключится сам.
    p.on('error', (e) => console.error('[db] idle client error:', e.message));
    g.__arenaPool = p;
  }
  return g.__arenaPool;
}

export type Db = Pick<PoolClient, 'query'>;

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = [], db: Db = pool()) {
  return db.query<T>(sql, params);
}

export async function one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = [], db: Db = pool()): Promise<T | null> {
  const r = await db.query<T>(sql, params);
  return r.rows[0] ?? null;
}

export async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
