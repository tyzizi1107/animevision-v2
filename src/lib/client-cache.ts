type CacheEntry<T> = { expiresAt: number; value: T };

const cache = new Map<string, CacheEntry<unknown>>();
const pending = new Map<string, Promise<unknown>>();

/** Cache mémoire côté navigateur pour éviter de répéter les mêmes appels lors des retours SPA. */
export async function getClientCached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;

  const request = load().then((value) => {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (cache.size > 100) {
      const now = Date.now();
      for (const [cachedKey, entry] of cache) if (entry.expiresAt <= now) cache.delete(cachedKey);
      while (cache.size > 100) cache.delete(cache.keys().next().value!);
    }
    return value;
  }).finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}
