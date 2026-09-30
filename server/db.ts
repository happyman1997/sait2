import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';

// Один пул на процесс (в dev Next перезагружает модули — держим в globalThis).
const g = globalThis as unknown as { __arenaPool?: Pool };

export function pool(): Pool {
  if (!g.__arenaPool) {
    // Размер пула и предел длительности запроса — из окружения; зависший запрос не держит соединение вечно.
    const p = new Pool({
      connectionString: config.databaseUrl(), max: config.dbPoolMax(), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000,
      statement_timeout: config.dbStatementTimeoutMs(),
      // current_date и границы суток в SQL — в часовом поясе площадки, как и в коде (localClock).
      options: '-c timezone=' + config.timeZone()
    });
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

// Действия «после фиксации» (сброс кэшей и т. п.): внутри tx копятся и выполняются только после COMMIT,
// при откате — отбрасываются. Иначе параллельный запрос успел бы закэшировать ещё не зафиксированное состояние.
const pending = new AsyncLocalStorage<Array<() => void>>();

export function afterCommit(fn: () => void) {
  const list = pending.getStore();
  if (list) list.push(fn); else fn();
}

export async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  const after: Array<() => void> = [];
  try {
    await client.query('BEGIN');
    const out = await pending.run(after, () => fn(client));
    await client.query('COMMIT');
    client.release();
    for (const f of after) {
      try { f(); } catch (e) { console.error('[db] afterCommit:', e); }
    }
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    throw e;
  }
}
