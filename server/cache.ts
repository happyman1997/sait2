// Небольшой кэш в памяти процесса с временем жизни и вытеснением самых старых записей.
// Одинаковые запросы, пришедшие одновременно, ждут один общий расчёт (без «грохочущего стада» на старте).
type Entry<T> = { at: number; value: Promise<T> };

export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();
  constructor(private ttlMs: number, private max: number) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.map.get(key);
    if (hit && now - hit.at < this.ttlMs) {
      // Обновляем позицию — Map хранит порядок вставки, старейшие вытесняются первыми.
      this.map.delete(key); this.map.set(key, hit);
      return hit.value;
    }
    const value = load();
    this.map.set(key, { at: now, value });
    // Ошибку не кэшируем: следующий запрос попробует заново.
    value.catch(() => { if (this.map.get(key)?.value === value) this.map.delete(key); });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
    return value;
  }

  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}
