/**
 * Cache genérico em memória com expiração por TTL.
 */

export interface TtlCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
}

export function createTtlCache<T>(
  ttlMs: number,
  now: () => number = Date.now
): TtlCache<T> {
  const entries = new Map<string, { value: T; timestamp: number }>();

  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.timestamp >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: T): void {
      entries.set(key, { value, timestamp: now() });
    },
    delete(key: string): void {
      entries.delete(key);
    },
    clear(): void {
      entries.clear();
    },
  };
}
