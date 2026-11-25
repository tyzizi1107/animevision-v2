/**
 * Types et utilitaires partagés par les providers FR.
 *
 * Un provider reçoit `{ tmdbId, mediaType, season, episode, signal }` et rend
 * des `ProviderStream` bruts : une URL (embed ou flux) + sa langue. La couche
 * `resolvers.ts` transforme ensuite les embeds connus en flux jouables, puis
 * `/api/streams` les formate pour passer par `/api/proxy`.
 */

export type MediaType = "tv" | "movie";

export type ProviderLanguage = "vf" | "vostfr";

export type ProviderStream = {
  /** URL de l'embed (ex. ansembed) ou flux direct (mp4 / m3u8). */
  url: string;
  /** Identifiant du provider (anime-sama, franime, …). */
  provider: string;
  /** Libellé lisible de la source (hébergeur). */
  source: string;
  language: ProviderLanguage;
  /** Titre complet côté provider (affiche/diagnostic). */
  title?: string;
  /** En-têtes requis pour lire le flux (Referer, Origin…). */
  headers?: Record<string, string>;
  /** Saison/épisode réellement ciblés chez le provider. */
  seasonNumber?: number;
  episodeNumber?: number;
  /** Libellé de l'hébergeur (sibnet, vidmoly…) une fois résolu. */
  host?: string;
  /** En-têtes à utiliser pour résoudre l'embed (Referer du site source). */
  resolveHeaders?: Record<string, string>;
  /** Balises HLS exposées par le flux (résolutions) quand connues. */
  qualities?: string[];
  /**
   * Numérotation de l'épisode chez le provider quand elle diffère de celle de
   * TMDB (saga découpée en saisons, épisodes absolus…). `0` = inconnu.
   */
  providerSeason?: number;
  providerEpisode?: number;
  /** Saison/épisode demandés côté TMDB (recopié de la requête). */
  tmdbSeason?: number;
  tmdbEpisode?: number;
  /**
   * Pistes proposées par le lecteur du provider (sous-titres, audio). Utile
   * quand la « langue » n'est pas un flux séparé mais un choix de piste.
   */
  tracks?: ProviderTracks;
};

export type ProviderTracks = {
  /** Sous-titres disponibles (VTT), par langue. */
  subtitles?: Array<{
    language: string;
    label: string;
    url: string;
    /**
     * Page où trouver la vraie adresse, quand `url` n'est qu'un gabarit sans
     * signature (Vidzy : `…/srtproxy/<code>_fre.vtt` répond 400 ; l'adresse
     * complète est dans l'embed).
     */
    pageUrl?: string;
  }>;
  /** Pistes audio annoncées par le provider, dans son ordre. */
  audio?: string[];
  /** Code de langue de chaque piste audio (`fr`, `ja`…), même ordre. */
  audioLanguages?: string[];
  /**
   * Ce que le fichier joue RÉELLEMENT : le provider nomme ses flux « VF » ou
   * « VOSTFR », mais Vidzy sert souvent le même fichier pour les deux. On
   * décide donc à partir des pistes : japonais + sous-titres = VOSTFR.
   */
  playback?: "vostfr" | "vf";
};

export type ProviderContext = {
  tmdbId: number;
  mediaType: MediaType;
  season: number | null;
  episode: number | null;
  /** Titres TMDB (FR, original, alternatifs) pour la recherche côté provider. */
  titles: string[];
  /**
   * Titre EXACT de la fiche catalogue. Quand il est présent, la fiche trouvée
   * doit lui correspondre : les autres titres ne servent qu'à la chercher, pas
   * à accepter une autre adaptation (One Piece Log ≠ One Piece).
   */
  exactTitle?: string | null;
  /** Fiche du catalogue, en slug : clé des tables de correspondance. */
  slug?: string | null;
  year: string;
  /** Date de première diffusion TMDB (AAAA-MM-JJ) : distingue deux versions. */
  firstAirDate?: string | null;
  /**
   * Remake condensé : épisode absolu où commence l'arc de la série d'origine
   * (One Piece Log : Fish-Man Island Saga → 523). La source doit chercher
   * cet arc, pas la saison 1 de sa propre numérotation.
   */
  remakeStart?: number | null;
  imdbId: string | null;
  /** Signal partagé : aborté quand le budget du provider est dépassé. */
  signal: AbortSignal;
  /** Numéro absolu Franime (One Piece : 1156), sinon `null`. */
  absoluteEpisode?: number | null;
  /** Numéro affiché par la fiche, quand il diffère du numéro absolu. */
  relativeEpisode?: number | null;
  /** Nombre d'épisodes par saison TMDB, pour retrouver les mêmes arcs. */
  seasonLengths?: number[];
  /** Saisons TMDB de la fiche (longueurs, titres), si l'appelant les connaît. */
  seasons?: import("@/lib/anime-types").AnimeSeason[];
  /** Nombre total d'épisodes de la série (toutes saisons TMDB). */
  totalEpisodes?: number;
  /**
   * Correspondance TMDB ↔ zones de la source. Construite par le provider à
   * partir des lignes de saison qu'il vient de lire, quand il en a.
   */
  layout?: import("@/lib/media-layout").MediaLayout | null;
};

export type ProviderResult = {
  provider: string;
  streams: ProviderStream[];
  /** Message de diagnostic (jamais affiché brut à l'utilisateur). */
  error?: string;
  durationMs: number;
};

// Version de Chrome volontairement « ancienne » : certains CDN (Vidzy) servent
// une playlist de variantes à la place de la playlist de segments dès que le
// User-Agent annonce une version de navigateur récente, et le lecteur échoue
// alors sur « Missing Target Duration ».
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const BASE_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
};

export function normalizeTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function slugifyTitle(value: string): string {
  return normalizeTitle(value).replace(/\s+/g, "-");
}

const STOP_WORDS = new Set(["the", "a", "an", "of", "no", "wa", "to", "de", "la", "le", "les", "des", "du", "et", "and", "oav", "film"]);

/** Mots significatifs d'un titre (≥ 3 lettres, hors mots vides). */
export function titleWords(value: string): string[] {
  return normalizeTitle(value).split(" ").filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

/** Découpe un tableau HTML/JS `["1","","1"]` en nombre d'entrées. */
export function countArrayEntries(source: string): number {
  const matches = source.match(/"[^"]*"|''/g);
  return matches ? matches.length : 0;
}

/**
 * Petit pot de cookies par hôte : le front Anime-Sama exige le PHPSESSID posé
 * sur la page saison pour signer une URL lecteur (sinon 419 csrf).
 */
const cookieJars = new Map<string, Map<string, string>>();

export function absorbCookies(url: string, response: Response): void {
  try {
    const host = new URL(url).host;
    const raw = response.headers.getSetCookie?.() ?? [];
    if (raw.length === 0) return;
    const jar = cookieJars.get(host) ?? new Map<string, string>();
    for (const line of raw) {
      const pair = line.split(";")[0]?.trim();
      if (!pair || !pair.includes("=")) continue;
      const [name, ...rest] = pair.split("=");
      if (name) jar.set(name.trim(), rest.join("="));
    }
    cookieJars.set(host, jar);
  } catch {
    // En-tête illisible : on continue sans cookie.
  }
}

export function cookieHeaderFor(url: string): string {
  try {
    const jar = cookieJars.get(new URL(url).host);
    if (!jar || jar.size === 0) return "";
    return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  } catch {
    return "";
  }
}

/** `fetch` avec timeout et en-têtes par défaut ; null en cas d'échec. */
export async function fetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; text: string; url: string; location: string | null } | null> {
  const { timeoutMs = 5_000, headers, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = rest.signal ? AbortSignal.any([rest.signal as AbortSignal, timeout]) : timeout;
  try {
    const jarCookie = cookieHeaderFor(url);
    const response = await fetch(url, {
      ...rest,
      signal,
      redirect: rest.redirect ?? "manual",
      headers: {
        ...BASE_HEADERS,
        ...(jarCookie ? { Cookie: jarCookie } : {}),
        ...(headers as Record<string, string> | undefined),
      },
      cache: "no-store",
    });
    absorbCookies(url, response);
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text: body,
      url: response.url || url,
      location: response.headers.get("location"),
    };
  } catch {
    return null;
  }
}

/** Découpe un HTML en liste de `<a href>` (utilisé pour les catalogues). */
export function extractLinks(html: string, pattern: RegExp): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1]!;
    if (pattern.test(href)) links.add(href);
  }
  return [...links];
}
