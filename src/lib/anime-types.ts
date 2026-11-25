/** Langue publique d'un épisode : « vostfr » (VO sous-titrée) ou « vf ». */
export type AnimeLanguage = "vostfr" | "vf";

export type AnimeSource = {
  lecteur: string;
  lien: string;
  /** Langue du flux (rempli par /api/streams, vide pour TMDB). */
  language?: AnimeLanguage;
  /** Numéro absolu Franime (One Piece : 1156), quand il diffère du numéro affiché. */
  absoluteNumber?: number;
  /** URL à lire dans la balise <video> (via /api/proxy). */
  proxyUrl?: string;
};

export type AnimeEpisode = {
  number: number;
  /** Numéro absolu Franime, quand le catalogue en connaît un (One Piece : 1156). */
  absoluteNumber?: number;
  titre?: string;
  airDate?: string;
  overview?: string;
  still?: string | null;
  runtime?: number | null;
  adminEdited?: boolean;
  availableLanguages?: AnimeLanguage[];
  vo: AnimeSource[];
  vf: AnimeSource[];
};

export type AnimeSeason = {
  name: string;
  slug: string;
  affiche?: string | null;
  year?: string;
  episodes: AnimeEpisode[];
};

export type EpisodeAvailability = {
  number: number;
  titre?: string;
  airDate?: string;
  still?: string | null;
  runtime?: number | null;
  availableLanguages?: AnimeLanguage[];
  hasVo: boolean;
  hasVf: boolean;
};

export type SeasonIndex = {
  name: string;
  slug: string;
  affiche?: string | null;
  year?: string;
  episodes: EpisodeAvailability[];
};

export type AnimeSummary = {
  id: string;
  titre: string;
  autresNoms: string[];
  type: string;
  synopsis: string;
  affiche: string | null;
  banniere: string | null;
  logo: string | null;
  genres: string[];
  score: number;
  date: string;
};

export type AnimeDetail = AnimeSummary & {
  seasons: AnimeSeason[];
  index: SeasonIndex[];
  episodeCount: number;
  languages: AnimeLanguage[];
  /**
   * Numéro absolu d'un épisode, tel que le catalogue Franime le numérote en
   * continu (One Piece : saison 23, épisode 1 → 1156). `null` si la fiche
   * n'a pas de numérotation absolue connue.
   */
  absoluteEpisode: (seasonNumber: number, episodeNumber: number) => number | null;
  /**
   * Saga Franime correspondant à une saison TMDB (numéro de saga + son premier
   * numéro absolu). `null` quand la fiche n'a pas de catalogue de sagas.
   */
  sagaFor?: (seasonNumber: number) => { saga: number; firstAbsolute: number | null } | null;
  /** Numéro d'épisode DANS sa saga (celui qu'attend le lecteur), depuis un absolu. */
  sagaEpisodeNumber?: (absolute: number) => number | null;
  /** Numéro de saga qui contient un numéro absolu donné. */
  sagaIndexOf?: (absolute: number) => number | null;
};

export const LANGUAGE_LABELS: Record<AnimeLanguage, string> = {
  vostfr: "VOSTFR",
  vf: "VF",
};

const LECTEUR_LABELS: Record<string, string> = {
  sibnet: "Sibnet",
  vidmoly: "Vidmoly",
  ansembed: "Ansembed",
  uqload: "Uqload",
  sendvid: "Sendvid",
  oneupload: "OneUpload",
  vk: "VK",
  vkvideo: "VK Vidéo",
  smoothpre: "Smoothpre",
  lpayer: "Lpayer",
  minochinos: "Minochinos",
  earnvids: "Earnvids",
  movearnpre: "Movearnpre",
  dingtezuni: "Dingtezuni",
};

export function lecteurLabel(lecteur: string): string {
  const key = lecteur.trim().toLowerCase();
  if (LECTEUR_LABELS[key]) return LECTEUR_LABELS[key];
  if (!key) return "Source";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function isAnimeLanguage(value: unknown): value is AnimeLanguage {
  return value === "vostfr" || value === "vf";
}

export function typeLabel(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (normalized === "anime") return "Série animée";
  if (normalized === "film") return "Film";
  if (normalized === "kaï") return "Kaï";
  return type || "Anime";
}

/**
 * URL de lecture, calquée sur celles de Vidzy :
 *   série → `/serie/<tmdbId>/<saison>/<episode>`
 *   film  → `/movie/<tmdbId>`
 * La langue n'est pas dans l'URL : c'est un réglage du lecteur.
 */
export function watchHref(
  animeId: string,
  seasonSlug: string,
  episode: number,
  _language?: AnimeLanguage,
): string {
  return `/regarder/${animeId}/${seasonSlug}/${episode}`;
}

/** `/anime/<tmdbId>` est une série, `/movie/<tmdbId>` un film : vrai pour un film. */
export function isMovieId(id: string): boolean {
  return /^movie-/i.test(id.trim());
}

/** Adresse publique d'une fiche : `/serie/<id>` ou `/movie/<id>`. */
export function detailHref(animeId: string): string {
  return isMovieId(animeId) ? `/movie/${animeId}` : `/serie/${animeId}`;
}

/**
 * Premier épisode à proposer : le catalogue vient de TMDB, donc les flux ne
 * sont connus qu'à la lecture (/api/streams). On pointe le premier épisode
 * déjà diffusé (les épisodes à venir ne sont pas lisibles).
 */
export function firstPlayable(
  anime: AnimeDetail,
  preferredLanguage: AnimeLanguage = "vostfr",
): { season: AnimeSeason; episode: AnimeEpisode; language: AnimeLanguage } | null {
  const today = new Date().toISOString().slice(0, 10);
  const aired = (episode: AnimeEpisode) => !episode.airDate || episode.airDate <= today;
  // La langue demandée (préférence du compte) passe devant, sinon VOSTFR.
  const language: AnimeLanguage = preferredLanguage === "vf" ? "vf" : "vostfr";
  for (const season of anime.seasons) {
    const episode = season.episodes.find((candidate) => candidate.number > 0 && aired(candidate));
    if (episode) return { season, episode, language };
  }
  const first = anime.seasons[0]?.episodes[0];
  return first ? { season: anime.seasons[0]!, episode: first, language } : null;
}
