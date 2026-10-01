// Живые события: после обрыва LISTEN-соединения слушатель восстанавливается и просит клиентов перечитать данные.
import { afterAll, describe, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool } = await import('@/server/db');
const live = await import('@/server/live');

afterAll(async () => { await pool().end(); });

const waitFor = async (cond: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('не дождались'); await new Promise(r => setTimeout(r, 50)); }
};

describe('live', () => {
  it('обрыв LISTEN: переподключение, resync подписчикам, события идут дальше', async () => {
    const got: unknown[] = [];
    const id = crypto.randomUUID();
    const unsub = await live.subscribe(id, e => got.push(e));
    await live.publish([id], { t: 'job', num: 1 });
    await waitFor(() => got.length === 1);
    await pool().query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE 'LISTEN %' AND pid <> pg_backend_pid()`);
    await waitFor(() => got.some(e => (e as { t: string }).t === 'resync'));
    await live.publish([id], { t: 'job', num: 2 });
    await waitFor(() => got.some(e => (e as { num?: number }).num === 2));
    unsub();
  }, 20_000);
});
