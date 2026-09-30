// Действия «после фиксации»: внутри транзакции ждут COMMIT, при откате отбрасываются, вне транзакции — сразу.
import { afterAll, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { afterCommit, pool, tx } = await import('@/server/db');

afterAll(async () => { await pool().end(); });

describe('afterCommit', () => {
  it('в транзакции — только после COMMIT, по порядку', async () => {
    const log: string[] = [];
    await tx(async (db) => {
      afterCommit(() => log.push('a'));
      await db.query('SELECT 1');
      afterCommit(() => log.push('b'));
      log.push('body');
    });
    expect(log).toEqual(['body', 'a', 'b']);
  });

  it('при откате не выполняется; вне транзакции — сразу', async () => {
    const log: string[] = [];
    await expect(tx(async () => { afterCommit(() => log.push('x')); throw new Error('сбой'); })).rejects.toThrow('сбой');
    expect(log).toEqual([]);
    afterCommit(() => log.push('now'));
    expect(log).toEqual(['now']);
  });

  it('ошибка в действии не ломает уже зафиксированную транзакцию', async () => {
    const out = await tx(async () => { afterCommit(() => { throw new Error('после'); }); return 42; });
    expect(out).toBe(42);
  });
});
