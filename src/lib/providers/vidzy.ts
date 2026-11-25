/**
 * Provider Vidzy (`vidzy.org`) — films et séries en VF et VOSTFR.
 *
 * C'est la source la plus directe de toutes : l'identifiant est le **tmdbId**
 * lui-même, donc aucune recherche de titre, donc aucun risque de tomber sur un
 * homonyme.
 *
 *   1. `GET /serie/{tmdbId}/{saison}/{episode}/{vf|vostfr}`
 *      `GET /movie/{tmdbId}/{vf|vostfr}`
 *      → page minimale dont le `<iframe id="pf" src="https://vidzy.cc/embed-…">`
 *      porte le lecteur. Les deux langues sont demandées en parallèle : Vidzy
 *      n'expose pas de liste, chaque URL ne sert qu'une version.
 *   2. L'embed est résolu par `resolveVidzy` (flux HLS `vidzy.org/hls2/…`).
 *
 * Une fiche inconnue répond 404 « Non disponible » : le provider rend alors une
 * liste vide sans gêner les autres sources.
 */

import { BASE_HEADERS, BROWSER_UA, fetchText, type ProviderContext, type ProviderLanguage, type ProviderStream } from "./types";

const SITE = "https://vidzy.org";
const LANGUAGES: ProviderLanguage[] = ["vf", "vostfr"];

/** URL de la fiche Vidzy pour une saison/épisode (ou un film) et une langue. */
export function vidzyUrl(context: Pick<ProviderContext, "tmdbId" | "mediaType" | "season" | "episode">, language: ProviderLanguage): string {
  const suffix = `/${language}`;
  if (context.mediaType === "movie") return `${SITE}/movie/${context.tmdbId}${suffix}`;
  const season = Math.max(1, Number(context.season ?? 1));
  const episode = Math.max(1, Number(context.episode ?? 1));
  return `${SITE}/serie/${context.tmdbId}/${season}/${episode}${suffix}`;
}

/** Lit le lecteur (`<iframe id="pf" src="…">`) et le titre de la page. */
export function parseVidzyPage(html: string): { embed: string | null; title: string | null } {
  const embed = /<iframe[^>]+id=["']pf["'][^>]+src=["']([^"']+)["']/i.exec(html)?.[1]
    ?? /<iframe[^>]+src=["']([^"']*\/embed-[^"']+)["']/i.exec(html)?.[1]
    ?? null;
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  return { embed, title };
}

/** Épisodes que Vidzy annonce pour la saison d'une page (`CFG.episodes`). */
export function parseVidzyEpisodeList(html: string): number[] {
  const match = /"episodes"\s*:\s*\[([\d,\s]*)\]/.exec(html);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

/**
 * Fiche complète de Vidzy pour un tmdbId (`/api/<tmdbId>`) : la seule source
 * fiable de la structure (saisons + épisodes) et des langues disponibles.
 *
 * Les pages `/serie/…` répondent 200 à n'importe quelle saison et rejouent un
 * autre épisode : c'est ce qui faisait lire la mauvaise vidéo. L'API, elle,
 * liste les épisodes réellement présents, saison par saison.
 */
type VidzyInfo = {
  available: boolean;
  tmdbId: number;
  type: "tv" | "movie";
  title: string | null;
  languages: ProviderLanguage[];
  seasons: Array<{ season: number; episodes: number[] }>;
  embedTemplate: string | null;
};

const INFO_TTL = 10 * 60_000;
const infoCache = new Map<number, { at: number; info: VidzyInfo | null }>();

async function fetchVidzyInfo(context: ProviderContext): Promise<VidzyInfo | null> {
  const tmdbId = Number(context.tmdbId);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;
  const hit = infoCache.get(tmdbId);
  if (hit && Date.now() - hit.at < INFO_TTL) return hit.info;
  const page = await fetchText(`${SITE}/api/${tmdbId}`, {
    headers: { ...BASE_HEADERS, "User-Agent": BROWSER_UA, Accept: "application/json,*/*", Referer: `${SITE}/` },
    signal: context.signal,
    timeoutMs: 8_000,
    redirect: "follow",
  }).catch(() => null);
  let info: VidzyInfo | null = null;
  if (page && page.status < 400) {
    try {
      const raw = JSON.parse(page.text) as {
        available?: boolean;
        tmdb_id?: number;
        detectedType?: string;
        title?: string;
        languages?: string[];
        seasons?: Array<{ season?: number; episodes?: unknown[] }>;
        embed?: string;
      };
      // Un film n'a pas de `seasons` du tout : l'API ne l'annonce qu'avec
      // `available`, ses langues et l'URL du lecteur.
      if (raw.available) {
        info = {
          available: true,
          tmdbId,
          type: raw.detectedType === "movie" ? "movie" : "tv",
          title: raw.title ?? null,
          languages: (raw.languages ?? []).filter((value): value is ProviderLanguage => value === "vf" || value === "vostfr"),
          seasons: (Array.isArray(raw.seasons) ? raw.seasons : [])
            .map((season) => ({
              season: Number(season.season) || 0,
              episodes: (season.episodes ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0),
            }))
            .filter((season) => season.episodes.length > 0)
            .sort((a, b) => a.season - b.season),
          embedTemplate: typeof raw.embed === "string" ? raw.embed : null,
        };
      }
    } catch {
      info = null;
    }
  }
  infoCache.set(tmdbId, { at: Date.now(), info });
  return info;
}

/**
 * Saison et épisode chez Vidzy, à partir de la saison de la fiche.
 *
 * Nos fiches et celles de Vidzy suivent toutes deux le découpage TMDB (One
 * Piece : 24 saisons, S1 = 61 épisodes), donc la saison se transmet telle
 * quelle. On vérifie quand même que l'épisode existe dans cette saison ; sinon
 * on cherche l'épisode ABSOLU dans la liste complète (fiches qui numérotent en
 * continu : S2E62 au lieu de S2E1).
 */
function locateEpisode(
  info: VidzyInfo,
  season: number,
  episode: number,
): { season: number; episode: number } | null {
  const exact = info.seasons.find((entry) => entry.season === season);
  if (exact?.episodes.includes(episode)) return { season, episode };

  // Épisode commun à plusieurs saisons chez Vidzy (One Piece : 1→61 dans les
  // saisons 1, 2 et 3) : seule la saison demandée nous dit laquelle ils veulent.
  // Un épisode très au-delà de la saison (500 en S1, qui n'en a que 61) est en
  // revanche un numéro ABSOLU : on le retrouve par son rang dans la série.
  if (exact && exact.episodes.length > 0 && episode <= exact.episodes.length * 2) return null;

  // Épisode absolu : rang de l'épisode dans la série entière.
  let offset = 0;
  for (const entry of info.seasons) {
    if (entry.season === 0) continue;
    if (episode > offset && episode <= offset + entry.episodes.length) {
      return { season: entry.season, episode: entry.episodes[episode - offset - 1] ?? episode - offset };
    }
    offset += entry.episodes.length;
  }
  return null;
}

async function fetchLanguage(
  context: ProviderContext,
  language: ProviderLanguage,
): Promise<ProviderStream[]> {
  const info = await fetchVidzyInfo(context);
  if (!info) return [];
  // L'API dit quelles langues Vidzy publie réellement : inutile de demander
  // une version absente.
  if (info.languages.length > 0 && !info.languages.includes(language)) return [];

  if (info.type === "movie" || context.mediaType === "movie") {
    // L'API donne déjà l'URL du film (`https://vidzy.org/movie/<tmdbId>`) ;
    // sinon on la reconstruit. La langue n'entre pas dans l'adresse.
    const embed = (info.embedTemplate ?? `${SITE}/movie/${info.tmdbId}`)
      .replace("{tmdbId}", String(info.tmdbId))
      .replace("{season}", "1")
      .replace("{episode}", "1")
      .replace("{language}", language);
    return [await buildStream(context, language, { embed, title: info.title, season: 1 })];
  }

  const season = Math.max(1, Number(context.season ?? 1));
  const episode = Math.max(1, Number(context.episode ?? 1));
  const located = locateEpisode(info, season, episode);
  if (!located) return [];

  // L'URL que donne l'API (`…/serie/{season}/{episode}`) est la page qui
  // contient le lecteur : c'est elle que `resolveVidzy` ouvre pour trouver
  // l'iframe d'embed.
  const template = info.embedTemplate ?? `${SITE}/serie/{tmdbId}/{season}/{episode}`;
  const embed = template
    .replace("{tmdbId}", String(info.tmdbId))
    .replace("{season}", String(located.season))
    .replace("{episode}", String(located.episode))
    .replace("{language}", language);
  // Contrôle final : l'embed doit exister (une page « Non disponible » pour un
  // épisode absent de Vidzy ne sert rien). La saison/l'épisode, eux, viennent
  // de l'API `/api/<tmdbId>`, qui liste ce que Vidzy propose réellement.
  const page = await fetchText(embed, {
    headers: { ...BASE_HEADERS, "User-Agent": BROWSER_UA, Accept: "text/html,*/*", Referer: `${SITE}/` },
    signal: context.signal,
    timeoutMs: 8_000,
  });
  if (!page || page.status >= 400 || /Non disponible/i.test(page.text.slice(0, 600))) return [];

  return [await buildStream(context, language, { embed, title: info.title, season: located.season })];
}

/** Complète un flux trouvé (pistes audio / sous-titres) avant de le rendre. */
async function buildStream(
  context: ProviderContext,
  language: ProviderLanguage,
  found: { embed: string; title: string | null; season: number },
): Promise<ProviderStream> {
  const { embed, title } = found;
  // Vidzy ne propose pas de flux séparés par langue : VF et VOSTFR pointent le
  // même fichier, la version n'est qu'un choix de piste (audio et sous-titres)
  // dans son lecteur. On garde donc les pistes trouvées sur l'embed pour les
  // exposer dans les réglages du nôtre.
  const tracks = await vidzyTracks(embed, context.signal);
  // Vérification finale : un .vtt qui n'a aucune réplique (titre d'épisode et
  // bande-annonce seulement) ne doit pas être proposé — sinon on affiche des
  // sous-titres qui n'apparaissent jamais pendant les dialogues.
  const verified = tracks?.subtitles
    ? (await Promise.all(tracks.subtitles.map(async (track) => {
        const body = await fetchText(track.url, {
          headers: { ...BASE_HEADERS, "User-Agent": BROWSER_UA, Referer: "https://vidzy.cc/" },
          signal: context.signal,
          timeoutMs: 5_000,
          redirect: "follow",
        }).catch(() => null);
        if (!body || body.status >= 400) return null;
        return /-->/.test(body.text) ? track : null;
      }))).filter((track): track is NonNullable<typeof track> => track !== null)
    : undefined;
  if (tracks && verified && verified.length !== (tracks.subtitles?.length ?? 0)) {
    tracks.subtitles = verified;
    if (!tracks.subtitles.length && !tracks.audio?.length) {
      // Plus rien à proposer : le flux reste lisible, simplement sans pistes.
      tracks.subtitles = [];
    }
  }

  return {
    url: embed.startsWith("http") ? embed : new URL(embed, "https://vidzy.cc/").toString(),
    provider: "vidzy",
    source: "Vidzy",
    language,
    title: `${title ?? context.titles[0] ?? "Vidzy"} ${language === "vf" ? "VF" : "VOSTFR"}`,
    seasonNumber: context.mediaType === "movie" ? undefined : Math.max(1, Number(context.season ?? 1)),
    episodeNumber: context.mediaType === "movie" ? undefined : Math.max(1, Number(context.episode ?? 1)),
    // L'embed n'accepte pas d'autre Referer que celui de son propre site.
    resolveHeaders: { Referer: "https://vidzy.cc/" },
    tracks,
  };
}

/** Langues dont Vidzy publie une piste de sous-titres (`…_fre.vtt`, `…_jpn.vtt`). */
const SUBTITLE_LANGUAGES: Record<string, string> = {
  fre: "Français",
  eng: "Anglais",
  jpn: "Japonais",
  spa: "Espagnol",
  por: "Portugais",
  ita: "Italien",
  ger: "Allemand",
  ara: "Arabe",
  rus: "Russe",
  tur: "Turc",
};

/**
 * Pistes proposées par le lecteur de Vidzy, lues dans l'embed :
 * - sous-titres : URL `srtproxy/<code>_<lang>.vtt?dx=…&srv=…&disk=…` (302 vers
 *   `u14.vidzy.org/vtt/…`, d'où le `follow` du proxy) ;
 * - audio : `_fssAL=[…]` quand la source déclare plusieurs pistes.
 */
async function vidzyTracks(embed: string, signal?: AbortSignal): Promise<ProviderStream["tracks"]> {
  const page = await fetchText(embed, {
    headers: { ...BASE_HEADERS, "User-Agent": BROWSER_UA, Accept: "text/html,*/*", Referer: "https://vidzy.cc/" },
    signal,
    timeoutMs: 6_000,
  });
  if (!page || page.status >= 400) return undefined;

  const code = /embed-([a-z0-9]+)\.html/i.exec(embed)?.[1] ?? null;
  const subtitles = new Map<string, string>();
  for (const match of page.text.matchAll(/srtproxy\/[a-z0-9]+_([a-z]{3})\.vtt\?[^"'\\\s]*/gi)) {
    const language = match[1].toLowerCase();
    if (subtitles.has(language)) continue;
    const full = match[0];
    subtitles.set(language, full.startsWith("http") ? full : `https://vidzy.cc/${full}`);
  }
  // Certains embeds n'exposent que le code, la piste française est alors implicite.
  // Aucune piste dans la page : l'embed en publie une implicitement, mais son
  // adresse exacte (signature `?dx=…&srv=…&disk=…`) est ailleurs dans son
  // HTML. On ne met pas d'URL inventée (elle répondrait 400) : `pageUrl` dit
  // où la chercher.
  const implicit = !subtitles.size && code;
  if (implicit && code) {
    subtitles.set("fre", `https://vidzy.cc/srtproxy/${code}_fre.vtt`);
  }

  const audio = /_fssAL\s*=\s*\[([^\]]*)\]/i.exec(page.text)?.[1]
    ?.split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean) ?? [];

  const result = {
    subtitles: [...subtitles].map(([language, url]) => ({
      language,
      label: SUBTITLE_LANGUAGES[language] ?? language.toUpperCase(),
      url,
      ...(implicit ? { pageUrl: `https://vidzy.cc/embed-${code}.html` } : {}),
    })),
    audio,
  };
  return result.subtitles.length || result.audio.length ? result : undefined;
}

export async function extractVidzyStreams(context: ProviderContext): Promise<ProviderStream[]> {
  if (!context.tmdbId) return [];
  // Vidzy publie souvent le MÊME fichier pour VF et VOSTFR : deux flux
  // identiques dans la liste. On ne demande la seconde langue que si la
  // première n'a rien donné.
  for (const language of LANGUAGES) {
    const found = await fetchLanguage(context, language);
    if (found.length > 0) return found;
  }
  return [];
}

export const __vidzyInternals = { vidzyUrl, parseVidzyPage };
