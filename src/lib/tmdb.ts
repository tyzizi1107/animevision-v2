/**
 * Client TMDB : source unique du catalogue (plus aucune collection MongoDB
 * `franime`). Les réponses sont mises en cache en mémoire avec un TTL court
 * pour rester sous la limite de débit de l'API (50 req/s) sans jamais servir
 * de données périmées trop longtemps.
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_ROOT = "https://image.tmdb.org/t/p";
const DEFAULT_TIMEOUT_MS = 8_000;

export const ANIMATION_GENRE_ID = 16;
export const JAPAN_COUNTRY = "JP";

export type MediaType = "tv" | "movie";

export type TmdbGenre = { id: number; name: string };

type CacheEntry = { at: number; value: unknown };

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<unknown>>();
const MAX_CACHE_ENTRIES = 400;

export function clearTmdbCache(): void {
  cache.clear();
  pending.clear();
}

export function getTmdbApiKey(): string {
  const key = process.env.TMDB_API_KEY?.trim();
  if (!key) {
    throw new Error("Configuration TMDB manquante : définissez TMDB_API_KEY dans .env.local.");
  }
  return key;
}

/** Chemin d'image TMDB → URL absolue (null si absent). */
export function imageUrl(path: unknown, size = "w500"): string | null {
  if (typeof path !== "string" || !path.trim()) return null;
  const value = path.trim();
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") ? `${TMDB_IMAGE_ROOT}/${size}${value}` : null;
}

function pruneCache(now: number) {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (now - entry.at > 60_000) cache.delete(key);
    if (cache.size <= MAX_CACHE_ENTRIES * 0.75) break;
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * GET TMDB avec cache mémoire + déduplication des requêtes en vol.
 * `path` doit commencer par `/` (ex. `/discover/tv`), `params` sans api_key.
 */
export async function tmdbGet<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  ttlMs = 10 * 60_000,
): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  const key = `${path}?${query}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < ttlMs) return cached.value as T;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight as Promise<T>;

  const request = (async () => {
    const url = `${TMDB_BASE}${path}?${query ? `${query}&` : ""}api_key=${encodeURIComponent(getTmdbApiKey())}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      const error = new Error(`TMDB ${path} → HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const value = (await response.json()) as T;
    cache.set(key, { at: Date.now(), value });
    pruneCache(Date.now());
    return value;
  })().finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });

  pending.set(key, request);
  return request;
}

/** Requête TMDB qui renvoie null au lieu de lever (404, réseau, config). */
/** Écrit le résultat en base : il survit à un redémarrage du serveur. */
async function persistTmdb(key: string, value: unknown) {
  try {
    const { getDb } = await import("./mongodb");
    const db = await getDb();
    await db.collection("tmdbCache").updateOne(
      { _id: key as never },
      { $set: { value, at: new Date() } },
      { upsert: true },
    );
  } catch {
    /* la base est un bonus : sans elle le cache mémoire suffit */
  }
}

/**
 * GET TMDB qui sert d'abord la copie Mongo (survit aux redémarrages), puis la
 * mémoire. Sans réponse, la requête part et le résultat est écrit en base.
 */
export async function tmdbCached<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  ttlMs = 10 * 60_000,
): Promise<T | null> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.set(k, String(v));
  }
  const key = `${path}?${search.toString()}`;
  const memory = cache.get(key);
  if (memory && Date.now() - memory.at < ttlMs) return memory.value as T;
  try {
    const { getDb } = await import("./mongodb");
    const db = await getDb();
    const stored = await db.collection("tmdbCache").findOne({ _id: key as never });
    if (stored && Date.now() - new Date(stored.at as Date).getTime() < ttlMs) {
      cache.set(key, { at: Date.now(), value: stored.value });
      return stored.value as T;
    }
  } catch {
    /* base indisponible : on demande directement à TMDB */
  }
  const value = await tmdbTry<T>(path, params, ttlMs);
  if (value !== null) void persistTmdb(key, value);
  return value;
}

export async function tmdbTry<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  ttlMs?: number,
): Promise<T | null> {
  try {
    return await tmdbGet<T>(path, params, ttlMs);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status !== 404) console.warn("[tmdb]", (error as Error).message);
    return null;
  }
}

export function localeParams(language = "fr-FR"): Record<string, string> {
  return { language, include_adult: "false" };
}
