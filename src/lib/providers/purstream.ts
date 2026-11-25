/**
 * Purstream (`purstream.vc`) — films, séries et animés en VF.
 *
 * C'est la source la plus simple des trois : une API JSON, sans Cloudflare ni
 * BotBlocker, et des flux HLS **directs** (pas d'embed à résoudre).
 *
 *   1. `GET <api>/search-bar/search/<titre>?types=tv|movie`
 *      → `data.items.movies.items[]` (`id`, `title`, `type`, `isAnime`)
 *   2. `GET <api>/media/<id>/sheet`
 *      → `data.items.tmdbId` (contrôle de cohérence) **et** `data.items.urls[]`,
 *      la liste complète des flux de la fiche : `{ url, name }` où `name`
 *      ressemble à `pulse | 1080p | VF` et `url` contient `/S2/E1/`.
 *      Une série renvoie donc tous ses épisodes d'un coup.
 *
 * On filtre sur `/S<n>/E<n>/` plutôt que d'appeler une route par épisode : une
 * seule requête suffit, et c'est ce qui garde le provider rapide.
 */

import { BASE_HEADERS, fetchText, normalizeTitle, type ProviderContext, type ProviderLanguage, type ProviderStream } from "./types";

const API = "https://api.purstream.vc/api/v1";

type PurstreamItem = {
  id?: number;
  title?: string;
  type?: string;
  isAnime?: boolean;
  tmdbId?: number;
  urls?: Array<{ url?: string; name?: string }>;
};

type PurstreamResponse = { type?: string; data?: { count?: number; items?: unknown } };

/** `pulse | 1080p | VF` → `{ quality, language }`. */
function parseSourceName(name: string): { quality: string | null; language: ProviderLanguage } {
  const quality = /(\d{3,4}p)/i.exec(name)?.[1]?.toLowerCase() ?? null;
  // `MULTI` et `VF` sont servis en français ; `VOSTFR` en version sous-titrée.
  const language: ProviderLanguage = /vostfr|vost|sub/i.test(name) ? "vostfr" : "vf";
  return { quality, language };
}

/** Numéro de saison/épisode d'après `/S2/E1/`, ou `12x05`. */
function parseEpisodePath(url: string): { season: number; episode: number } | null {
  const slash = /\/S(\d+)\/E(\d+)\//i.exec(url);
  if (slash) return { season: Number(slash[1]), episode: Number(slash[2]) };
  const x = /\/S(\d+)(\d{2})\//i.exec(url);
  if (x) return { season: Number(x[1]), episode: Number(x[2]) };
  return null;
}

function scoreTitle(candidate: string, titles: string[]): number {
  const value = normalizeTitle(candidate);
  if (!value) return 0;
  let best = 0;
  for (const title of titles) {
    const wanted = normalizeTitle(title);
    if (!wanted) continue;
    if (value === wanted) best = Math.max(best, 100);
    else if (value.startsWith(`${wanted} `)) best = Math.max(best, 70);
    else if (value.includes(wanted)) best = Math.max(best, 55);
  }
  return best;
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  const response = await fetchText(url, {
    headers: { ...BASE_HEADERS, Accept: "application/json" },
    signal,
    timeoutMs: 5_000,
  });
  if (!response?.ok) return null;
  try {
    return JSON.parse(response.text) as T;
  } catch {
    return null;
  }
}

export async function extractPurstreamStreams(context: ProviderContext): Promise<ProviderStream[]> {
  const { titles, season, episode, mediaType, tmdbId, signal } = context;
  const query = titles[0];
  if (!query) return [];

  // 1. Recherche, restreinte au bon type de média.
  const type = mediaType === "tv" ? "tv" : "movie";
  const search = await getJson<PurstreamResponse>(
    `${API}/search-bar/search/${encodeURIComponent(query)}?types=${type}`,
    signal,
  );
  const movies = (search?.data?.items as { movies?: { items?: PurstreamItem[] } } | undefined)?.movies?.items;
  if (!Array.isArray(movies) || movies.length === 0) return [];

  const ranked = movies
    .map((item) => ({ item, score: scoreTitle(item.title ?? "", titles) }))
    .filter((entry) => entry.score > 0 && entry.item.id != null)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return [];

  const top = ranked[0]!.score;
  const candidates = ranked.filter((entry) => entry.score === top).slice(0, 2);

  for (const { item } of candidates) {
    const sheet = await getJson<PurstreamResponse>(`${API}/media/${item.id}/sheet`, signal);
    const detail = sheet?.data?.items as PurstreamItem | undefined;
    if (!detail || !Array.isArray(detail.urls)) continue;

    // Le `tmdbId` de la fiche permet d'écarter homonymes et suites.
    if (detail.tmdbId && detail.tmdbId !== tmdbId) continue;

    const streams: ProviderStream[] = [];
    for (const entry of detail.urls) {
      if (!entry.url || !/\.m3u8(?:[?#]|$)/i.test(entry.url)) continue;
      const position = parseEpisodePath(entry.url);
      if (mediaType === "tv") {
        if (!position) continue;
        if (position.season !== (season ?? 1) || position.episode !== episode) continue;
      }
      const { language } = parseSourceName(entry.name ?? "");
      streams.push({
        url: entry.url,
        provider: "purstream",
        source: entry.name ?? "Purstream",
        language,
        title: `${detail.title ?? item.title ?? query}${position ? ` S${position.season}E${position.episode}` : ""} ${language === "vf" ? "VF" : "VOSTFR"}`,
        seasonNumber: position?.season,
        episodeNumber: position?.episode,
        // Le CDN (`free.finepulfe.xyz`) attend le Referer du site.
        headers: { Referer: "https://purstream.vc/" },
      });
    }

    // Plusieurs sources par épisode : on les rend toutes, le lecteur choisit.
    if (streams.length > 0) return streams;
  }

  return [];
}

export const __purstreamInternals = { parseSourceName, parseEpisodePath, scoreTitle };
