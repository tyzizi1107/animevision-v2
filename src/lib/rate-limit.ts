type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Limiteur en mémoire (suffisant pour un déploiement mono-instance).
 * En production multi-région, remplacer par Redis/Upstash.
 */
export function rateLimit(
  key: string,
  limit = 10,
  windowMs = 10 * 60 * 1000,
): { ok: true; remaining: number } | { ok: false; retryAfter: number } {
  const now = Date.now();

  if (buckets.size > 5000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt < now) buckets.delete(bucketKey);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;
  return { ok: true, remaining: limit - bucket.count };
}
