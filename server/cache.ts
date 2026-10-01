// Небольшой кэш в памяти процесса с временем жизни и вытеснением самых старых записей.
// Одинаковые запросы, пришедшие одновременно, ждут один общий расчёт (без «грохочущего стада» на старте).
type Entry<T> = { at: number; value: Promise<T> };

export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();
  constructor(private ttlMs: number, private max: number) {}

  /** maxAgeMs — строже общего срока для этого вызова (например, вошедшим — свежее, чем гостям). */
  get(key: string, load: () => Promise<T>, maxAgeMs = this.ttlMs): Promise<T> {
    const now = Date.now();
    const hit = this.map.get(key);
    if (hit && now - hit.at < Math.min(this.ttlMs, maxAgeMs)) {
      // Обновляем позицию — Map хранит порядок вставки, старейшие вытесняются первыми.
      this.map.delete(key); this.map.set(key, hit);
      return hit.value;
    }
    const value = load();
    this.map.set(key, { at: now, value });
    // Ошибку не кэшируем: следующий запрос попробует заново.
    value.catch(() => { if (this.map.get(key)?.value === value) this.map.delete(key); });
    // Старые записи — в начале Map: просроченные убираем сразу (иначе они держат память до вытеснения по размеру).
    for (const [k, e] of this.map) {
      if (this.map.size > this.max || now - e.at >= this.ttlMs) this.map.delete(k);
      else break;
    }
    return value;
  }

  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}
