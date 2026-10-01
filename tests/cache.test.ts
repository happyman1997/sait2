// Кэш выдачи для гостей: общий расчёт для одновременных запросов, время жизни, вытеснение, ошибки не кэшируются.
import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '@/server/cache';

describe('TtlCache', () => {
  it('одновременные запросы ждут один расчёт; после срока — пересчёт', async () => {
    vi.useFakeTimers();
    const c = new TtlCache<number>(1000, 10);
    let n = 0;
    const load = () => new Promise<number>(r => setTimeout(() => r(++n), 10));
    const [a, b] = [c.get('k', load), c.get('k', load)];
    await vi.advanceTimersByTimeAsync(20);
    expect([await a, await b]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(1500);
    const d = c.get('k', load);
    await vi.advanceTimersByTimeAsync(20);
    expect(await d).toBe(2);
    vi.useRealTimers();
  });

  it('вытесняет самые давние записи сверх лимита', async () => {
    const c = new TtlCache<string>(60_000, 2);
    await c.get('a', async () => 'a'); await c.get('b', async () => 'b');
    await c.get('a', async () => 'x');           // a — свежее
    await c.get('c', async () => 'c');           // вытесняет b
    expect(c.size).toBe(2);
    expect(await c.get('b', async () => 'b2')).toBe('b2');
    expect(await c.get('c', async () => 'no')).toBe('c');
  });

  it('просроченные записи убираются при вставке, не дожидаясь вытеснения по размеру; maxAge строже срока', async () => {
    vi.useFakeTimers();
    const c = new TtlCache<number>(1000, 100);
    await c.get('a', async () => 1); await c.get('b', async () => 2);
    await vi.advanceTimersByTimeAsync(1500);
    await c.get('c', async () => 3);
    expect(c.size).toBe(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(await c.get('c', async () => 30, 500)).toBe(30);   // для этого вызова запись уже старая
    vi.useRealTimers();
  });

  it('ошибку не запоминает', async () => {
    const c = new TtlCache<number>(60_000, 10);
    await expect(c.get('k', async () => { throw new Error('сбой'); })).rejects.toThrow('сбой');
    expect(await c.get('k', async () => 7)).toBe(7);
  });
});
