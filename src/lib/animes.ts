import { unstable_cache } from "next/cache";
import type {
  AnimeDetail,
  AnimeEpisode,
  AnimeLanguage,
  AnimeSeason,
  AnimeSource,
  AnimeSummary,
  SeasonIndex,
} from "./anime-types";
import { hiddenIds } from "./availability";
import type { AdminOverride, CatalogueDocument } from "./catalogue-db";
import { applyFicheOverride, catalogueCollection, getCatalogueDocument, summaryFromDocument } from "./catalogue-db";
import {
  getCatalogueSummaryTmdb,
  listCatalogueTmdb,
  queryCatalogueTmdb,
  tmdbGenreStats,
} from "./catalogue-tmdb";
import { orderedSeasons } from "./media-layout";
import { imageUrl, localeParams, tmdbCached, tmdbGet, tmdbTry, ANIMATION_GENRE_ID, JAPAN_COUNTRY, type MediaType } from "./tmdb";

export type { MediaType };

/** TMDB a renvoyé 404 (identifiant inconnu) lors de la dernière résolution. */
const notFoundIds = new Set<string>();

export function isTmdbNotFound(id: string): boolean {
  const parsed = parseCatalogId(id);
  return parsed ? notFoundIds.has(catalogId(parsed.mediaType, parsed.tmdbId)) : false;
}

/**
 * Catalogue 100 % TMDB.
 *
 * Aucune collection MongoDB `franime` n'est lue ni écrite ici : tout vient de
 * l'API TMDB (animes = genre Animation `16` + origine `JP`), avec un cache
 * mémoire léger. Les identifiants publics sont `tv-<tmdbId>` et
 * `movie-<tmdbId>` ; un ancien identifiant (ObjectId Mongo, `series-…`,
 * `<id>` nu) est résolu de façon tolérante pour ne jamais casser une page.
 */

const PAGE_SIZE = 24;
const CATALOG_TTL = 10 * 60_000;
const DISCOVER_MAX_PAGE = 500;
/** Au-delà, la pagination TMDB n'existe plus : on plafonne l'exploration locale. */
const LOCAL_SCAN_PAGE_CAP = 25;

export type CatalogSort = "note" | "recent" | "az";

export type CatalogResult = {
  items: AnimeSummary[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  genres: Array<{ name: string; count: number }>;
  totalCatalog: number;
};

export type HomeData = {
  featured: AnimeSummary[];
  recent: AnimeSummary[];
  trending: AnimeSummary[];
};

export type RecentEpisode = {
  id: string;
  titre: string;
  affiche: string | null;
  banniere: string | null;
  imageEpisode: string | null;
  season: string;
  number: number;
  titreEpisode: string;
  language: "vostfr" | "vf";
  availableLanguages: Array<"vostfr" | "vf">;
  updatedAt: number;
};

/* -------------------------------------------------------------------------- */
/* Identifiants                                                               */
/* -------------------------------------------------------------------------- */

export type ParsedId = { mediaType: MediaType; tmdbId: number; documentId?: string };

/**
 * Identifiant public d'une fiche : un simple NUMÉRO, attribué une fois pour
 * toutes par ordre alphabétique des titres (`/anime/1`, `/anime/2`…). Le
 * numéro vit dans `catalogue.numero` ; TMDB reste la clé interne.
 */
export function catalogId(mediaType: MediaType, tmdbId: number | string): string {
  // Catalogue TMDB direct : plus de numéro à maintenir, l'identifiant est
  // `<type>-<tmdbId>` (`tv-37854`, `movie-1726`).
  return `${normalizeMediaType(mediaType)}-${Number(tmdbId)}`;
}

/** Table `mediaType-tmdbId` → numéro public, remplie au démarrage. */
const numeroByTmdb = new Map<string, number>();
/** Table inverse : numéro public → `mediaType-tmdbId`. */
const TMDB_BY_NUMERO = new Map<number, string>();

/** Ancien mécanisme de numéros publics : conservé vide (catalogue TMDB). */
export async function primeCatalogNumeros(): Promise<void> {
  return;
}

export function normalizeMediaType(value: unknown): MediaType {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "movie" || text === "film" || text === "movies" ? "movie" : "tv";
}

/** `tv-123`, `series-123`, `movie-123`, `123` → { mediaType, tmdbId }. */
export function parseCatalogId(value: unknown): ParsedId | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const prefixed = /^(tv|series|movie|film)[-:/](\d{1,9})$/i.exec(raw);
  if (prefixed) {
    const mediaType = normalizeMediaType(prefixed[1]);
    const tmdbId = Number(prefixed[2]);
    return tmdbId > 0 ? { mediaType, tmdbId } : null;
  }
  if (/^\d{1,9}$/.test(raw)) {
    // Numéro public (`/anime/12`) : il désigne une fiche précise, on le
    // traduit en `tv-<tmdbId>` via la table chargée au démarrage.
    // Ancienne forme `tv-<tmdbId>` ou nombre nu : TMDB est la seule source,
    // un identifiant numérique est donc un tmdbId de série.
    const numero = Number(raw);
    return numero > 0 ? { mediaType: "tv", tmdbId: numero } : null;
  }
  return null;
}

/** Les anciens identifiants Mongo (24 hex) restent « plausibles » mais non résolvables. */
export function isLegacyObjectId(value: unknown): boolean {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function slugify(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "saison";
}

function yearOf(date: unknown): string {
  const value = text(date);
  return /^\d{4}/.test(value) ? value.slice(0, 4) : "";
}

type RawGenre = { id?: number; name?: string };

type RawTmdbItem = {
  id?: number;
  media_type?: string;
  name?: string;
  title?: string;
  original_name?: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: RawGenre[];
  genre_ids?: number[];
  vote_average?: number;
  first_air_date?: string;
  release_date?: string;
  origin_country?: string[];
  original_language?: string;
};

type TmdbList = {
  page?: number;
  total_pages?: number;
  total_results?: number;
  results?: RawTmdbItem[];
};

export function isAnimeItem(item: RawTmdbItem): boolean {
  const genreIds = new Set([...(item.genre_ids ?? []), ...(item.genres ?? []).map((genre) => Number(genre.id))]);
  if (!genreIds.has(ANIMATION_GENRE_ID)) return false;
  const countries = item.origin_country ?? [];
  if (countries.length > 0) return countries.includes(JAPAN_COUNTRY);
  return item.original_language === "ja";
}

function toSummary(item: RawTmdbItem, mediaType: MediaType, publicId?: string): AnimeSummary {
  const tmdbId = Number(item.id);
  const title = text(item.name ?? item.title) || text(item.original_name ?? item.original_title) || "Sans titre";
  const original = text(item.original_name ?? item.original_title);
  const date = text(item.first_air_date ?? item.release_date);
  // Toujours `<type>-<tmdbId>` : l'identifiant sert d'URL (`/serie/tv-…`), un
  // identifiant nu pointait sur une fiche inexistante.
  return {
    id: catalogId(mediaType, tmdbId),
    titre: title,
    autresNoms: [...new Set([original, ...(item.genre_ids ? [] : [])])]
      .filter((alias) => alias && normalize(alias) !== normalize(title))
      .slice(0, 10),
    type: mediaType === "movie" ? "film" : "anime",
    synopsis: text(item.overview),
    affiche: imageUrl(item.poster_path, "w500"),
    banniere: imageUrl(item.backdrop_path, "w1280") ?? imageUrl(item.poster_path, "w780"),
    logo: null,
    genres: [...new Set((item.genres ?? []).map((genre) => text(genre.name)).filter(Boolean))],
    score: Number(item.vote_average) > 0 ? Number(item.vote_average) : 0,
    date,
  };
}

/* -------------------------------------------------------------------------- */
/* Découverte                                                                 */
/* -------------------------------------------------------------------------- */

type DiscoverOptions = {
  mediaType: MediaType;
  page: number;
  sort?: CatalogSort;
  genreId?: number;
  /** Restreint aux animes (Animation + Japon) ; désactivé pour les genres non animés. */
  animeOnly?: boolean;
};

function discoverParams(options: DiscoverOptions): Record<string, string | number> {
  const sortBy = options.sort === "az"
    ? "original_title.asc"
    : options.sort === "recent"
      ? "primary_release_date.desc"
      : "popularity.desc";
  const dateField = options.mediaType === "movie" ? "primary_release_date" : "first_air_date";
  return {
    ...localeParams(),
    page: Math.min(Math.max(1, options.page), DISCOVER_MAX_PAGE),
    sort_by: options.sort === "az"
      ? "original_title.asc"
      : options.sort === "recent"
        ? `${dateField}.desc`
        : sortBy,
    with_genres: options.genreId ? `${ANIMATION_GENRE_ID},${options.genreId}` : String(ANIMATION_GENRE_ID),
    ...(options.animeOnly ? { with_origin_country: JAPAN_COUNTRY } : {}),
    "vote_count.gte": options.sort === "note" ? 10 : 0,
  };
}

async function discoverPage(options: DiscoverOptions): Promise<{ items: AnimeSummary[]; totalPages: number; totalResults: number }> {
  const path = `/discover/${options.mediaType}`;
  const data = await tmdbTry<TmdbList>(path, discoverParams(options), CATALOG_TTL);
  const results = (data?.results ?? []).filter((item) => item && Number(item.id) > 0);
  const items = results
    .filter((item) => !options.animeOnly || isAnimeItem(item))
    .map((item) => toSummary(item, options.mediaType));
  return {
    items,
    totalPages: Math.min(Number(data?.total_pages) || 1, DISCOVER_MAX_PAGE),
    totalResults: Number(data?.total_results) || 0,
  };
}

let tvGenreCache: { at: number; genres: Array<{ id: number; name: string }> } | null = null;

async function tvGenres(): Promise<Array<{ id: number; name: string }>> {
  if (tvGenreCache && Date.now() - tvGenreCache.at < 24 * 60 * 60_000) return tvGenreCache.genres;
  const data = await tmdbTry<{ genres?: Array<{ id: number; name: string }> }>("/genre/tv/list", localeParams(), 24 * 60 * 60_000);
  const genres = (data?.genres ?? []).filter((genre) => Number(genre.id) > 0 && text(genre.name));
  tvGenreCache = { at: Date.now(), genres };
  return genres;
}

export async function getGenreStats(): Promise<Array<{ name: string; count: number }>> {
  // Genres servis par TMDB, avec leur nombre de fiches animées.
  return tmdbGenreStats();
}

/** Genre TMDB correspondant à un nom affiché (FR ou EN), sinon null. */
async function genreIdFromName(name: string): Promise<number | null> {
  const wanted = normalize(name);
  if (!wanted) return null;
  const genres = await tvGenres();
  const hit = genres.find((genre) => normalize(genre.name) === wanted)
    ?? genres.find((genre) => normalize(genre.name).includes(wanted) || wanted.includes(normalize(genre.name)));
  if (hit) return hit.id;
  const animation = genres.find((genre) => genre.id === ANIMATION_GENRE_ID);
  return animation && wanted === normalize(animation.name) ? ANIMATION_GENRE_ID : null;
}

async function searchTmdb(query: string, mediaType: MediaType, page = 1): Promise<{ items: AnimeSummary[]; totalPages: number; totalResults: number }> {
  const data = await tmdbTry<TmdbList>(`/search/${mediaType}`, { ...localeParams(), query, page }, 5 * 60_000);
  const items = (data?.results ?? [])
    .filter((item) => item && Number(item.id) > 0 && isAnimeItem(item))
    .map((item) => toSummary(item, mediaType));
  return {
    items,
    totalPages: Math.min(Number(data?.total_pages) || 1, DISCOVER_MAX_PAGE),
    totalResults: Number(data?.total_results) || items.length,
  };
}

function sortSummaries(items: AnimeSummary[], sort: CatalogSort): AnimeSummary[] {
  const sorted = [...items];
  if (sort === "az") sorted.sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
  else if (sort === "recent") sorted.sort((a, b) => b.date.localeCompare(a.date) || b.score - a.score);
  else sorted.sort((a, b) => b.score - a.score || a.titre.localeCompare(b.titre, "fr"));
  return sorted;
}

export async function searchCatalog(params: {
  q?: string;
  genre?: string;
  type?: string;
  sort?: string;
  page?: number;
}): Promise<CatalogResult> {
  // Catalogue TMDB : recherche, genre, tri et pagination servis par l'API.
  const page = await queryCatalogueTmdb({
    q: params.q,
    genre: params.genre,
    sort: params.sort,
    page: params.page,
  });
  return {
    items: await filterAvailable(page.items),
    total: page.total,
    page: page.page,
    pages: page.pages,
    pageSize: page.pageSize,
    genres: page.genres,
    totalCatalog: page.totalCatalog,
  };
}

/**
 * Retire les fiches dont le cache de disponibilité dit qu'elles n'ont aucune
 * source. Lecture mémoire uniquement : aucune requête provider déclenchée ici.
 */
async function filterAvailable(items: AnimeSummary[]): Promise<AnimeSummary[]> {
  if (items.length === 0) return items;
  const hidden = await hiddenIds(items.map((item) => item.id));
  return hidden.size === 0 ? items : items.filter((item) => !hidden.has(item.id));
}

/* -------------------------------------------------------------------------- */
/* Détail (saisons + épisodes TMDB)                                           */
/* -------------------------------------------------------------------------- */

type TmdbDetail = {
  id?: number;
  name?: string;
  title?: string;
  original_name?: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: RawGenre[];
  genre_ids?: number[];
  vote_average?: number;
  first_air_date?: string;
  release_date?: string;
  origin_country?: string[];
  original_language?: string;
  runtime?: number;
  episode_run_time?: number[];
  seasons?: Array<{
    id?: number;
    name?: string;
    season_number?: number;
    episode_count?: number;
    air_date?: string | null;
    poster_path?: string | null;
    overview?: string;
  }>;
  alternative_titles?: { titles?: Array<{ iso_3166_1?: string; title?: string }> };
  external_ids?: { imdb_id?: string | null };
};

type TmdbSeasonDetail = {
  name?: string;
  season_number?: number;
  poster_path?: string | null;
  air_date?: string | null;
  episodes?: Array<{
    episode_number?: number;
    name?: string;
    air_date?: string | null;
    overview?: string;
    still_path?: string | null;
    runtime?: number | null;
  }>;
};

export type TmdbTitles = {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  titles: string[];
  /** Titre original TMDB (japonais) : dernier recours, jamais en tête. */
  originalTitle?: string;
  year: string;
  /** Date de première diffusion (AAAA-MM-JJ) : distingue deux adaptations. */
  firstAirDate?: string | null;
  imdbId: string | null;
};

/** Titres exploitables pour les providers FR (FR, original, alternatifs, IMDb). */
/**
 * Titres d'une fiche lue directement dans le catalogue (film importé de
 * Franime, sans `tmdbId`) : l'API TMDB ne peut rien dire de ces documents, et
 * les sources FR se contentent de leur titre.
 */
async function localTitlesForProviders(documentId: string, mediaType: MediaType = "tv"): Promise<TmdbTitles | null> {
  const localDoc = await getCatalogueDocument(documentId).catch(() => null);
  if (!localDoc) return null;
  const localSummary = summaryFromDocument(localDoc);
  const localTitles = [
    text(localDoc.title),
    text(localDoc.originalTitle),
    text((localDoc.titles ?? {}).fr),
    text((localDoc.titles ?? {}).en),
    text((localDoc.titles ?? {}).romaji),
  ].filter(Boolean);
  return {
    id: documentId,
    tmdbId: 0,
    mediaType,
    titles: [...new Set([...localTitles, localSummary.titre, ...localSummary.autresNoms].filter(Boolean))],
    originalTitle: text(localDoc.originalTitle) || undefined,
    year: String(localDoc.year ?? ""),
    firstAirDate: text(localDoc.startDate) || null,
    imdbId: null,
  };
}

export async function getTitlesForProviders(id: string): Promise<TmdbTitles | null> {
  await primeCatalogNumeros();
  // Un identifiant de document (`franime-45513`) n'est pas un numéro public :
  // on le reconnaît avant `parseCatalogId`, qui n'accepte que des chiffres.
  if (/^(?:franime|kitsu|local)-[\w-]+$/i.test(id.trim())) {
    return localTitlesForProviders(id.trim());
  }
  const parsed = parseCatalogId(id);
  if (!parsed) return null;

  // Fiche sans TMDB (film importé de Franime) : TMDB n'a rien à donner, mais
  // les titres du document catalogue suffisent aux sources. Sans ce chemin,
  // tous les films répondaient « Contenu introuvable ».
  if (parsed.documentId) {
    return localTitlesForProviders(parsed.documentId, parsed.mediaType);
  }

  const detail = await tmdbCached<TmdbDetail>(
    `/${parsed.mediaType}/${parsed.tmdbId}`,
    { ...localeParams(), append_to_response: "alternative_titles,external_ids" },
    CATALOG_TTL,
  );
  if (!detail) return null;
  // Le titre de la FICHE CATALOGUE passe en premier : il peut différer de
  // celui que rend TMDB en français (arcs remakés, titres FR propres à
  // l'import). Les sources cherchent avec cette liste, dans cet ordre.
  const summary = toSummary({ ...detail, id: parsed.tmdbId }, parsed.mediaType);
  // Comme pour la fiche : l'identifiant peut être un numéro public, la
  // collection est indexée sur `id` — on essaie les deux formes.
  const stored = (await getCatalogueDocument(id).catch(() => null))
    ?? (await getCatalogueDocument(`${parsed.mediaType}-${parsed.tmdbId}`).catch(() => null));
  const storedTitles = stored
    ? [
        text((stored as { title?: unknown }).title),
        text(stored.originalTitle),
        text(((stored as { titles?: Record<string, unknown> }).titles ?? {}).fr),
        text(((stored as { titles?: Record<string, unknown> }).titles ?? {}).en),
        text(((stored as { titles?: Record<string, unknown> }).titles ?? {}).romaji),
      ].filter(Boolean)
    : [];
  const alternatives = (detail.alternative_titles?.titles ?? [])
    .map((entry) => text(entry.title))
    .filter(Boolean)
    .slice(0, 12);
  return {
    id: summary.id,
    tmdbId: parsed.tmdbId,
    mediaType: parsed.mediaType,
    titles: [...new Set([...storedTitles, summary.titre, ...summary.autresNoms, ...alternatives].filter(Boolean))],
    originalTitle: text(detail.original_name) || text(detail.original_title) || undefined,
    year: yearOf(summary.date),
    firstAirDate: text(detail.first_air_date) || text(detail.release_date) || null,
    imdbId: text(detail.external_ids?.imdb_id) || null,
  };
}

function seasonSlug(seasonNumber: number, name: string): string {
  return seasonNumber > 0 ? `saison-${seasonNumber}` : slugify(name || "speciaux");
}

/** Lit un slug de saison (`saison-2`, `2`, `s-2`, nom TMDB) → numéro. */
export function seasonNumberFromSlug(slug: string, seasons: AnimeSeason[] = []): number | null {
  const value = normalize(slug);
  if (!value) return null;
  const numeric = /^(?:saison|saison-|s|-)?(\d{1,4})$/.exec(value);
  if (numeric) return Number(numeric[1]);
  const match = seasons.find((season) => season.slug === value);
  return match ? Number(/(\d+)$/.exec(match.slug)?.[1] ?? 0) : null;
}

/**
 * Découpage d'une fiche, à partir de TMDB seul.
 *
 * Aucune fiche n'est lue en base : TMDB donne les saisons, les épisodes, leurs
 * titres, leurs dates et leurs images. La numérotation absolue de la série
 * (le seul repère commun avec les sources, voir `sources.ts`) est ensuite
 * construite par `sagaNumbering` pour les fiches qui ont des saisons
 * numérotées comme des arcs.
 */
async function buildSeasons(detail: TmdbDetail, mediaType: MediaType, tmdbId: number): Promise<AnimeSeason[]> {
  const runtimeFallback = Array.isArray(detail.episode_run_time) ? Number(detail.episode_run_time[0]) || null : null;

  /** Langues : inconnues avant d'interroger les sources, donc supposées présentes. */
  const languagesFor = (_absolute: number, _seasonNumber: number, _episodeNumber: number) => undefined;

  // Saison 0 = épisodes spéciaux / hors-série : masquée du catalogue.
  const listed = (detail.seasons ?? [])
    .filter((season) => Number(season.season_number) > 0 && (Number(season.episode_count) || 0) > 0)
    .sort((a, b) => Number(a.season_number) - Number(b.season_number));

  // Décalage de chaque saison pour les fiches que TMDB numérote en relatif :
  // la saison n commence après la somme des épisodes des précédentes.
  const seasonOffset = new Map<number, number>();
  {
    let total = 0;
    for (const entry of listed) {
      seasonOffset.set(Number(entry.season_number), total);
      total += Number(entry.episode_count) || 0;
    }
  }

  const seasons = await Promise.all(listed.map(async (season): Promise<AnimeSeason | null> => {
    const seasonNumber = Number(season.season_number);
    const data = await tmdbTry<TmdbSeasonDetail>(`/tv/${tmdbId}/season/${seasonNumber}`, localeParams(), CATALOG_TTL);
    const rawEpisodes = (data?.episodes ?? [])
      .filter((episode) => Number(episode.episode_number) > 0)
      .sort((a, b) => Number(a.episode_number) - Number(b.episode_number));
    if (rawEpisodes.length === 0) return null;
    const name = fixSeasonName(
      text(data?.name ?? season.name) || (seasonNumber === 0 ? "Épisodes spéciaux" : `Saison ${seasonNumber}`),
    );
    // TMDB numérote parfois les épisodes en ABSOLU (One Piece : S23 commence à
    // 1156) et parfois en relatif (Denis la Malice : S1E1). Le premier numéro
    // de la saison est la référence de la série entière — c'est aussi ce
    // qu'utilisent Anime-Sama et Franime pour leurs arcs.
    const firstNumber = Number(rawEpisodes[0]?.episode_number) || 1;
    const absoluteNumbering = firstNumber > 1;
    const episodes: AnimeEpisode[] = rawEpisodes.map((episode) => ({
      number: Number(episode.episode_number),
      // Numéro de la série entière, quelle que soit la numérotation de TMDB.
      absoluteNumber: absoluteNumbering
        ? Number(episode.episode_number)
        : (seasonOffset.get(seasonNumber) ?? 0) + Number(episode.episode_number),
      titre: text(episode.name) || undefined,
      airDate: text(episode.air_date) || undefined,
      overview: text(episode.overview) || undefined,
      still: imageUrl(episode.still_path, "w300"),
      runtime: Number(episode.runtime) > 0 ? Number(episode.runtime) : runtimeFallback,
      availableLanguages: languagesFor(Number(episode.episode_number), seasonNumber, Number(episode.episode_number)),
      vo: [],
      vf: [],
    }));
    return {
      name,
      slug: seasonSlug(seasonNumber, name),
      affiche: imageUrl(data?.poster_path ?? season.poster_path, "w500"),
      year: yearOf(data?.air_date ?? season.air_date) || undefined,
      episodes,
    };
  }));

  // Les saisons de TMDB font foi : plus aucune saison n'est ajoutée depuis un
  // catalogue local, sinon les arcs apparaissaient deux fois (S7 TMDB et saga 7
  // Franime), avec le mauvais contenu dans l'un des deux.
  return seasons.filter((season): season is AnimeSeason => season !== null);
}

/**
 * Correspondance TMDB ↔ sagas des sources, sans aucune donnée locale.
 *
 * Les sites FR découpent les longs animés en arcs numérotés, TMDB en saisons
 * d'épisodes : leurs numéros ne veulent pas dire la même chose (la S7 de One
 * Piece chez TMDB = G-8 / Long Ring Long Land, la saga 7 de Franime = Iles des
 * Hommes-Poissons). Le seul repère commun est le **numéro absolu** de
 * l'épisode dans la série : chaque saga commence là où la précédente s'arrête.
 *
 * On ne peut pas le lire sur TMDB, mais on sait que les deux découpages
 * couvrent la même série : le début d'une saga est donc la somme des longueurs
 * des arcs précédents, rapportée au nombre d'épisodes de TMDB. `sagaFor`
 * donne ce début pour une saison TMDB, `sagaOfAbsolute` le chemin inverse.
 */
function numberingHints(seasons: AnimeSeason[]): Pick<AnimeDetail, "sagaFor" | "sagaIndexOf" | "sagaEpisodeNumber"> {
  const ordered = orderedSeasons(seasons);
  /**
   * Absolu d'un épisode = son numéro de série ENTIÈRE. TMDB le donne
   * directement quand la fiche est numérotée en absolu (One Piece : S23E1 =
   * 1156, le même numéro que chez Anime-Sama et Franime) ; sinon on l'additionne.
   */
  const absoluteOf = new Map<string, number>();
  const firstAbsolute = new Map<number, number>();
  let cursor = 0;
  let real = false;
  for (const [position, season] of ordered.entries()) {
    const number = Number(/(\d+)$/.exec(season.slug)?.[1] ?? position + 1);
    for (const episode of season.episodes) {
      const value = Number(episode.absoluteNumber);
      if (Number.isFinite(value) && value > 0) {
        absoluteOf.set(`${number}:${episode.number}`, value);
        if (!firstAbsolute.has(number)) firstAbsolute.set(number, Math.min(...[...firstAbsolute.values(), value]));
        real = true;
      } else {
        absoluteOf.set(`${number}:${episode.number}`, cursor + episode.number);
      }
    }
    if (real) cursor = Math.max(cursor, ...season.episodes.map((episode) => absoluteOf.get(`${number}:${episode.number}`) ?? 0));
    else cursor += season.episodes.length;
  }

  return {
    sagaFor: (seasonNumber) => {
      const first = firstAbsolute.get(seasonNumber);
      return first === undefined ? null : { saga: seasonNumber, firstAbsolute: first };
    },
    // Saison qui contient un numéro absolu (One Piece : 1156 → saison 23).
    sagaIndexOf: (absolute) => {
      let found: number | null = null;
      for (const [position, season] of ordered.entries()) {
        const number = Number(/(\d+)$/.exec(season.slug)?.[1] ?? position + 1);
        const start = firstAbsolute.get(number);
        if (start !== undefined && start <= absolute) found = number;
      }
      return found;
    },
    sagaEpisodeNumber: (absolute) => {
      // Position dans la saison TMDB et dans la saga de la source : les deux
      // sites comptent de 1 depuis le premier épisode de leur zone.
      let result: number | null = null;
      for (const [position, season] of ordered.entries()) {
        const number = Number(/(\d+)$/.exec(season.slug)?.[1] ?? position + 1);
        const start = firstAbsolute.get(number);
        if (start === undefined) continue;
        const candidates = season.episodes
          .map((episode) => absoluteOf.get(`${number}:${episode.number}`))
          .filter((value): value is number => value !== undefined);
        if (candidates.length === 0) continue;
        const end = Math.max(...candidates);
        if (absolute >= start && absolute <= end) return absolute - start + 1;
      }
      return result;
    },
  };
}

/**
 * Numéros absolus de la fiche, lus dans le catalogue local. Un épisode de
 * fiche numéroté 1156 en saison 23 est l'épisode 1156 absolu chez Franime.
 */
function absoluteEpisodeResolver(seasons: AnimeSeason[]): (seasonNumber: number, episodeNumber: number) => number | null {
  const bySeason = new Map<number, Map<number, number>>();
  for (const season of seasons) {
    const seasonNumber = Number(/(\d+)$/.exec(season.slug)?.[1] ?? 0);
    const map = new Map<number, number>();
    for (const episode of season.episodes) {
      const absolute = Number(episode.absoluteNumber ?? episode.number);
      if (Number.isFinite(absolute)) map.set(episode.number, absolute);
    }
    if (seasonNumber) bySeason.set(seasonNumber, map);
  }
  return (seasonNumber, episodeNumber) => {
    const direct = bySeason.get(seasonNumber)?.get(episodeNumber);
    if (direct !== undefined) return direct;
    // La saison d'affichage est celle de TMDB : un numéro de fiche ≥ 1000 ne
    // peut être qu'un numéro absolu, on le prend tel quel.
    if (episodeNumber >= 1000) return episodeNumber;
    return null;
  };
}

/**
 * Corrections de noms côtés TMDB (`language=fr-FR`), qui ne sont pas à jour :
 * la saison 23 de One Piece s'appelle « S23 - Arc Erbaf » chez TMDB alors que
 * l'arc est Elbaf. On garde le préfixe de TMDB et on remplace l'arc.
 */
const SEASON_NAME_FIXES: Array<{ match: RegExp; fix: (name: string) => string }> = [
  { match: /\berbaf\b/i, fix: (name) => name.replace(/\berbaf\b/gi, "Elbaf") },
  { match: /\belbaph\b/i, fix: (name) => name.replace(/\belbaph\b/gi, "Elbaf") },
];

function fixSeasonName(name: string): string {
  for (const { match, fix } of SEASON_NAME_FIXES) if (match.test(name)) return fix(name);
  return name;
}

/** Langues réellement proposées par la fiche : jamais une langue sans épisode. */
function availableLanguages(seasons: AnimeSeason[]): AnimeLanguage[] {
  const languages = new Set<AnimeLanguage>();
  for (const season of seasons) {
    for (const episode of season.episodes) {
      for (const language of episode.availableLanguages ?? []) languages.add(language);
    }
  }
  // Aucune information de lecteurs : on ne masque rien.
  if (languages.size === 0) return ["vostfr", "vf"];
  return (["vostfr", "vf"] as AnimeLanguage[]).filter((language) => languages.has(language));
}

/**
 * Saisons lues dans le catalogue local (import Franime) : aucun appel réseau.
 * Chaque épisode sait déjà quelles langues il propose, d'après les lecteurs
 * réellement listés par Franime.
 */
function seasonsFromDocument(document: CatalogueDocument): AnimeSeason[] {
  const stored = Array.isArray(document.seasons) ? document.seasons : [];
  const ordered: Array<AnimeSeason & { number: number }> = [];
  for (const season of stored) {
    // Franime range parfois une édition hors-série en saison 0.5 (le live
    // action de One Piece, par exemple) : on ne garde que les saisons entières
    // positives et raisonnables, sinon « Saison 2023 » atterrit dans la liste.
    // `number` : fiches importées de TMDB/Franime. `index` : fiches créées par
    // la synchro Anime-Sama (`index: 0` = saison 1). Sans ce repli, une fiche
    // Anime-Sama n'avait aucune saison et sa page répondait « introuvable ».
    const rawNumber = Number(season.number);
    const number = Number.isInteger(rawNumber) && rawNumber > 0 ? rawNumber : Number(season.index) + 1;
    if (!Number.isInteger(number) || number <= 0 || number > 100) continue;
    const episodes: AnimeEpisode[] = (season.episodes ?? [])
      .map((episode) => ({ ...episode, number: Number(episode.number) }))
      .filter((episode) => Number.isInteger(episode.number) && episode.number > 0)
      .sort((a, b) => a.number - b.number)
      .map((episode) => {
        const hasVf = (episode.playersVf ?? []).length > 0;
        const hasVo = (episode.playersVo ?? []).length > 0;
        return {
          number: episode.number,
          absoluteNumber: Number(episode.absNumber ?? episode.number),
          titre: episode.title ? String(episode.title) : undefined,
          airDate: episode.airDate ? String(episode.airDate) : undefined,
          overview: episode.overview ? String(episode.overview) : undefined,
          still: episode.still ? String(episode.still) : null,
          runtime: null,
          availableLanguages: [...(hasVf ? (["vf"] as AnimeLanguage[]) : []), ...(hasVo ? (["vostfr"] as AnimeLanguage[]) : [])],
          vo: [],
          vf: [],
        };
      });
    if (episodes.length === 0) continue;
    // Les sagas de Franime arrivent dans le désordre (« Live Action 0.5 » en
    // tête) : on les range par leur numéro de saga, pas par l'ordre reçu.
    const label = String(season.name ?? season.titre ?? "");
    const sagaNumber = Number(/(\d+)\s*$/.exec(label)?.[1] ?? number);
    ordered.push({
      number: sagaNumber,
      name: label || `Saison ${sagaNumber}`,
      slug: `saison-${sagaNumber}`,
      affiche: document.affiche ?? null,
      year: document.year ? String(document.year) : undefined,
      episodes,
    });
  }
  return ordered.sort((a, b) => a.number - b.number).map(({ number, ...rest }) => ({
    name: rest.name,
    slug: rest.slug,
    affiche: rest.affiche,
    year: rest.year,
    episodes: rest.episodes,
  }));
}

export function toSeasonIndex(seasons: AnimeSeason[]): SeasonIndex[] {
  return seasons.map((season) => ({
    name: season.name,
    slug: season.slug,
    affiche: season.affiche,
    year: season.year,
    episodes: season.episodes.map((episode) => ({
      number: episode.number,
      titre: episode.titre,
      airDate: episode.airDate,
      still: episode.still,
      runtime: episode.runtime,
      // Langues réellement proposées : connues quand la saison vient du
      // catalogue local, inconnues (donc supposées présentes) sinon.
      hasVf: episode.availableLanguages ? episode.availableLanguages.includes("vf") : true,
      hasVo: episode.availableLanguages ? episode.availableLanguages.includes("vostfr") : true,
    })),
  }));
}

/** Applique les corrections admin aux saisons/épisodes (clé : `slug` et `slug:numéro`). */
function applySeasonOverrides(seasons: AnimeSeason[], override: AdminOverride | null): AnimeSeason[] {
  if (!override?.seasons && !override?.episodes && !override?.hiddenSeasons) return seasons;
  // Une saison supprimée dans l'administration ne doit pas revenir : sans ce
  // filtre, TMDB la renvoyait telle quelle au rechargement suivant.
  const kept = override.hiddenSeasons
    ? []
    : seasons.filter((season) => !override.seasons?.[season.slug]?.hidden);
  return kept.map((season) => {
    const so = override.seasons?.[season.slug];
    return {
      ...season,
      name: so?.name || season.name,
      affiche: so?.affiche || season.affiche,
      episodes: season.episodes.map((episode) => {
        const eo = override.episodes?.[`${season.slug}:${episode.number}`];
        if (!eo) return episode;
        return {
          ...episode,
          titre: eo.titre || episode.titre,
          airDate: eo.airDate || episode.airDate,
          overview: eo.overview ?? episode.overview,
          still: eo.still || episode.still,
          runtime: eo.runtime ?? episode.runtime,
          vo: eo.vo?.length ? eo.vo : episode.vo,
          vf: eo.vf?.length ? eo.vf : episode.vf,
          adminEdited: true,
        };
      }),
    };
  });
}

/** Document `catalogue` d'une fiche, retrouvé par son identifiant public. */
async function storedDocumentFor(id: string): Promise<CatalogueDocument | null> {
  await primeCatalogNumeros();
  const parsed = parseCatalogId(id);
  if (!parsed) return null;
  const candidates = [
    parsed.documentId,
    catalogId(parsed.mediaType, parsed.tmdbId),
    `${parsed.mediaType}-${parsed.tmdbId}`,
    String(parsed.tmdbId),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const found = await getCatalogueDocument(candidate).catch(() => null);
    if (found) return found;
  }
  return null;
}

/** Corrections admin déjà enregistrées sur une fiche (null si aucune). */
export async function getCatalogueOverride(id: string): Promise<AdminOverride | null> {
  const document = await storedDocumentFor(id);
  return document?.adminOverride ?? null;
}

/** Slugs des saisons que TMDB renvoie aujourd'hui pour cette fiche. */
export async function currentSeasonSlugs(id: string): Promise<string[] | null> {
  const anime = await getAnimeDetail(id).catch(() => null);
  return anime ? anime.seasons.map((season) => season.slug) : null;
}

/** Enregistre (ou efface, avec `null`) les corrections admin d'une fiche. */
export async function saveAdminOverride(id: string, override: AdminOverride | null): Promise<boolean> {
  const document = await storedDocumentFor(id);
  if (!document) return false;
  const col = await catalogueCollection();
  if (override) await col.updateOne({ id: document.id }, { $set: { adminOverride: override } });
  else await col.updateOne({ id: document.id }, { $unset: { adminOverride: "" } });
  clearAnimeCaches();
  return true;
}

export async function getAnimeDetail(id: string): Promise<AnimeDetail | null> {
  // Un numéro public (`/anime/12`) ne se lit qu'avec la table chargée.
  await primeCatalogNumeros();
  const parsed = parseCatalogId(id);
  if (!parsed) return null;

  // Fiche sans équivalent TMDB (import Anime-Sama) : le catalogue suffit, on
  // ne demande rien à TMDB qui ne la connaît pas.
  if (parsed.documentId) {
    const localDocument = await getCatalogueDocument(parsed.documentId).catch(() => null);
    if (localDocument) {
      const localDetail = await detailFromLocalDocument(localDocument);
      if (localDetail) return localDetail;
      // Saisons toutes supprimées : la fiche reste lisible (film vidé de ses
      // saisons), elle n'a simplement plus de liste d'épisodes.
      return detailFromLocalDocument(localDocument, { allowEmptySeasons: true });
    }
  }

  // Le découpage saisons/épisodes vient de TMDB : c'est lui qui donne les
  // titres, les images et les numéros attendus par le sélecteur. Le catalogue
  // Franime ne sert que pour les fiches que TMDB ne connaît pas.
  const detail = await tmdbCached<TmdbDetail>(
    `/${parsed.mediaType}/${parsed.tmdbId}`,
    { ...localeParams(), append_to_response: "alternative_titles,external_ids" },
    CATALOG_TTL,
  );
  if (!detail) {
    // Catalogue TMDB : plus de fiche locale de secours, l'identifiant est un
    // tmdbId. Une correction admin éventuelle reste appliquée plus bas.
    notFoundIds.add(catalogId(parsed.mediaType, parsed.tmdbId));
    return null;
  }

  // Le titre affiché (page détail, lecteur, métadonnées) est TOUJOURS celui de
  // la fiche catalogue, seule source de vérité : il distingue les arcs remakés
  // que TMDB nomme autrement. TMDB ne sert de repli que si la fiche n'a pas de
  // titre — jamais l'inverse, sinon un renommage du catalogue serait perdu.
  const tmdbSummary = toSummary({ ...detail, id: parsed.tmdbId }, parsed.mediaType);
  // La fiche est lue par son identifiant public (`tv-<tmdbId>` ou numéro) :
  // `catalogId()` la renvoie déjà sous la forme du numéro, `getCatalogueDocument`
  // ne connaît que `id` — on demande donc les deux formes.
  const storedDocument = (await getCatalogueDocument(catalogId(parsed.mediaType, parsed.tmdbId)).catch(() => null))
    ?? (await getCatalogueDocument(`${parsed.mediaType}-${parsed.tmdbId}`).catch(() => null));
  const catalogTitle = storedDocument?.title?.trim();
  const override = storedDocument?.adminOverride ?? null;
  const summary = applyFicheOverride(catalogTitle
    ? { ...tmdbSummary, titre: catalogTitle }
    : tmdbSummary, override);
  // Identifiant public : toujours `<type>-<tmdbId>` (catalogue TMDB direct).
  summary.id = catalogId(parsed.mediaType, parsed.tmdbId);
  const alternatives = (detail.alternative_titles?.titles ?? [])
    .map((entry) => text(entry.title))
    .filter((title) => title && normalize(title) !== normalize(summary.titre));
  if (!override?.autresNoms) summary.autresNoms = [...new Set([...summary.autresNoms, ...alternatives])].slice(0, 12);

  // Un film n'a pas de saisons : sa durée de lecture est le film lui-même. Sans
  // cette saison unique, la fiche répondait « Aucun lecteur disponible » et le
  // lecteur n'avait aucune URL à ouvrir.
  const seasons = parsed.mediaType === "movie"
    ? movieAsSeason(detail, parsed.tmdbId)
    : applySeasonOverrides(await buildSeasons(detail, parsed.mediaType, parsed.tmdbId), override);
  const episodeCount = seasons.reduce((sum, season) => sum + season.episodes.length, 0);
  // Correspondance TMDB ↔ sources, calculée sur les numéros ABSOLUS que rend
  // TMDB (One Piece : S23 commence à 1156, comme chez Anime-Sama et Franime).
  const numbering = numberingHints(seasons);

  return {
    ...summary,
    seasons,
    index: toSeasonIndex(seasons),
    episodeCount,
    // Langues réellement présentes dans le catalogue, toutes saisons confondues.
    languages: availableLanguages(seasons),
    absoluteEpisode: absoluteEpisodeResolver(seasons),
    // La correspondance TMDB ↔ sagas des sources vit dans `sources.ts`.
    ...numbering,
  };
}

/** Un film vu comme une saison unique d'un seul épisode (lecteur commun). */
function movieAsSeason(detail: TmdbDetail, tmdbId: number): AnimeSeason[] {
  const runtime = Number(detail.runtime) > 0 ? Number(detail.runtime) : null;
  return [{
    name: "Film",
    slug: "film",
    affiche: imageUrl(detail.poster_path, "w500"),
    year: yearOf(text(detail.release_date)) || undefined,
    episodes: [{
      number: 1,
      absoluteNumber: 1,
      titre: text(detail.title ?? detail.name) || undefined,
      airDate: text(detail.release_date) || undefined,
      overview: text(detail.overview) || undefined,
      still: imageUrl(detail.backdrop_path, "w780"),
      runtime,
      availableLanguages: ["vostfr", "vf"],
      vo: [],
      vf: [],
    }],
  }];
}

/**
 * Fiche lue directement dans le catalogue, sans TMDB : les animés importés
 * d'Anime-Sama n'ont pas (encore) d'identifiant TMDB, et sans cette lecture
 * `/anime/<numéro>` répondait « animé introuvable ».
 */
async function detailFromLocalDocument(
  document: CatalogueDocument,
  options: { allowEmptySeasons?: boolean } = {},
): Promise<AnimeDetail | null> {
  const seasons = applySeasonOverrides(seasonsFromDocument(document), document.adminOverride ?? null);
  if (seasons.length === 0 && !options.allowEmptySeasons) return null;
  const summary = summaryFromDocument(document);
  return {
    ...summary,
    seasons,
    index: toSeasonIndex(seasons),
    episodeCount: seasons.reduce((sum, season) => sum + season.episodes.length, 0),
    languages: availableLanguages(seasons),
    absoluteEpisode: absoluteEpisodeResolver(seasons),
  };
}

export async function getSummariesByIds(ids: string[]): Promise<AnimeSummary[]> {
  // Chaque identifiant `tv-…` / `movie-…` est une fiche TMDB : lues en
  // parallèle, les manquantes disparaissent (même contrat qu'avant).
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const summaries = await Promise.all(unique.map((id) => getCatalogueSummaryTmdb(id).catch(() => null)));
  return summaries.filter((item): item is AnimeSummary => item !== null);
}

export async function getSimilar(anime: AnimeSummary, limit = 10): Promise<AnimeSummary[]> {
  // Mêmes genres, servis par TMDB (le premier genre de la fiche en tête).
  const genre = (anime.genres ?? []).find((name) => name && !/animation/i.test(name)) ?? anime.genres?.[0];
  const items = await listCatalogueTmdb({ genre, limit: limit + 1, excludeIds: [anime.id] });
  return items.filter((item) => item.id !== anime.id).slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Accueil / nouveautés                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Le hero de l'accueil : ces trois séries d'abord, dans cet ordre.
 * Elles ne passent pas par `top` (classement par note, limité aux fiches
 * enrichies TMDB) pour ne jamais dépendre d'une note ou d'une pagination.
 */
const FEATURED_TITLES = ["one piece", "vinland saga", "attack on titan"];

export async function getRecentFrAnime(limit = 12): Promise<AnimeSummary[]> {
  return listCatalogueTmdb({ sort: "recent", limit });
}

/**
 * Données de l'accueil, gardées 60 s côté serveur : l'ouverture du site ne
 * repaie pas les requêtes Mongo + TMDB à chaque visite. Les sorties changent
 * lentement, 60 s de retard sont invisibles.
 */
export const getHomeData = unstable_cache(rawGetHomeData, ["home-data"], { revalidate: 60 });

async function rawGetHomeData(): Promise<HomeData> {
  const [recent, top] = await Promise.all([
    listCatalogueTmdb({ sort: "recent", limit: 12 }),
    listCatalogueTmdb({ sort: "note", limit: 60 }),
  ]);
  const featured: AnimeSummary[] = [];
  const push = (item: AnimeSummary | undefined) => {
    if (!item || featured.some((entry) => entry.id === item.id)) return;
    featured.push(item);
  };
  for (const target of FEATURED_TITLES) {
    const wanted = normalize(target);
    // 1. Recherche exacte dans TMDB (le titre doit être EXACTEMENT celui
    //    demandé : « Attack on Titan », pas « Junior High »).
    const exact = await queryCatalogueTmdb({ q: target, pageSize: 20 }).catch(() => null);
    const exactHit = exact?.items.find((item) => {
      const titles = [item.titre, ...item.autresNoms].map(normalize);
      return titles.includes(wanted);
    });
    if (exactHit) {
      push(exactHit);
      continue;
    }
    // 2. Repli : titre approché dans le classement déjà chargé.
    const match = top.find((item) => {
      const titles = [item.titre, ...item.autresNoms].map(normalize);
      return titles.some((title) => title === wanted || title.startsWith(`${wanted} `) || title.startsWith(`${wanted}:`));
    });
    push(match);
  }
  for (const item of top) {
    if (featured.length >= 3) break;
    push(item);
  }
  return { featured, recent, trending: top.slice(0, 12) };
}

/**
 * Derniers épisodes : les séries animées qui diffusent cette semaine, avec leur
 * dernier épisode déjà sorti (titre + image TMDB).
 */
/**
 * Derniers épisodes **sortis**, au sens de Franime et Anime-Sama : c'est la
 * fraîcheur du fournisseur qui décide, pas la date de diffusion TMDB (un site
 * peut mettre un épisode en ligne des mois après sa diffusion japonaise).
 *
 *  - Franime publie `updatedDate` (VO) et `updatedDateVF` (VF) par animé, plus
 *    le numéro de la dernière saison et du dernier épisode qu'il sert.
 *  - Anime-Sama est interrogé pour les animés que Franime n'a pas rafraîchis
 *    récemment, en une passe par animé (son HTML de catalogue).
 */
export async function getRecentEpisodes(limit = 12, animeIds?: string[]): Promise<RecentEpisode[]> {
  const requested = Math.max(0, Math.min(30, Math.floor(limit)));
  if (requested === 0) return [];

  const collection = await catalogueCollection();

  const query: Record<string, unknown> = { franimeUpdatedAt: { $type: "date" } };
  if (animeIds && animeIds.length > 0) query.id = { $in: animeIds.slice(0, 100) };

  // Les fiches les plus récemment servies par Franime, VO ou VF confondues.
  const documents = await collection
    .find(query, {
      projection: {
        id: 1, title: 1, originalTitle: 1, affiche: 1, banniere: 1, format: 1, franimeUpdatedAt: 1, franimeUpdatedAtVf: 1,
        latestSeason: 1, latestEpisode: 1, latestEpisodeTitle: 1, seasons: 1,
      },
    })
    .sort({ franimeUpdatedAt: -1 })
    .limit(Math.max(requested * 4, 40))
    .toArray();

  const episodes: RecentEpisode[] = [];
  for (const document of documents) {
    const updatedVo = document.franimeUpdatedAt ? new Date(document.franimeUpdatedAt).getTime() : 0;
    const updatedVf = document.franimeUpdatedAtVf ? new Date(document.franimeUpdatedAtVf).getTime() : 0;
    const updatedAt = Math.max(updatedVo, updatedVf);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue;

    const languages: Array<"vostfr" | "vf"> = [];
    if (updatedVo > 0) languages.push("vostfr");
    if (updatedVf > 0) languages.push("vf");

    // Le dernier épisode servi : le numéro annoncé par Franime (`latestEpisode`
    // du dernier contenu mis en ligne), pas la fin des saisons importées —
    // sinon une série dont le découpage s'arrête plus loin affichait un épisode
    // « à venir ».
    const seasons = Array.isArray(document.seasons) ? document.seasons : [];
    const lastSeason = seasons[seasons.length - 1];
    const lastEpisode = lastSeason?.episodes?.[lastSeason.episodes.length - 1];
    const number = Number(document.latestEpisode) || lastEpisode?.number || 0;
    if (!number) continue;
    // Une mise en ligne dans le futur n'est pas encore sortie.
    if (updatedAt > Date.now()) continue;
    // Les films ne sont pas des épisodes : pas de « dernier épisode » pour eux.
    if (document.format === "Film") continue;

    episodes.push({
      id: document.id,
      titre: document.title?.trim() || document.originalTitle?.trim() || "Anime",
      affiche: document.affiche ?? null,
      banniere: document.banniere ?? null,
      imageEpisode: lastEpisode?.still ?? null,
      season: lastSeason?.name ?? (document.latestSeason ? `Saison ${document.latestSeason}` : "Saison 1"),
      number,
      titreEpisode: lastEpisode?.title || document.latestEpisodeTitle || `Épisode ${number}`,
      language: updatedVf > updatedVo ? "vf" : "vostfr",
      availableLanguages: languages,
      updatedAt,
    });
  }

  const franimeList = episodes.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, requested);

  // Anime-Sama : les épisodes déjà vus sur le site, avec leur heure de
  // diffusion. Ils prennent le pas sur Franime quand ils sont plus récents
  // (Franime publie parfois plusieurs heures après le site).
  const animeSamaList = await animeSamaRecentEpisodes(collection, requested, animeIds);
  if (animeSamaList.length === 0) return franimeList;

  const merged = new Map<string, RecentEpisode>();
  for (const episode of [...franimeList, ...animeSamaList]) {
    const key = `${episode.id}:${episode.season}:${episode.number}:${episode.language}`;
    const previous = merged.get(key);
    if (!previous || episode.updatedAt > previous.updatedAt) merged.set(key, episode);
  }
  // Une même série ne montre qu'une fois, avec son épisode le plus récent.
  const byAnime = new Map<string, RecentEpisode>();
  for (const episode of [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!byAnime.has(episode.id)) byAnime.set(episode.id, episode);
  }
  return [...byAnime.values()].slice(0, requested);
}

/** Derniers épisodes vus sur Anime-Sama (champ `animeSamaEpisodes` des fiches). */
async function animeSamaRecentEpisodes(
  collection: Awaited<ReturnType<typeof catalogueCollection>>,
  limit: number,
  animeIds?: string[],
): Promise<RecentEpisode[]> {
  const query: Record<string, unknown> = { animeSamaEpisodes: { $type: "object" } };
  if (animeIds && animeIds.length > 0) query.id = { $in: animeIds.slice(0, 100) };
  const documents = await collection
    .find(query, {
      projection: {
        id: 1, title: 1, originalTitle: 1, affiche: 1, banniere: 1, format: 1, animeSamaEpisodes: 1, franimeUpdatedAt: 1, franimeUpdatedAtVf: 1,
      },
    })
    .limit(Math.max(limit * 4, 60))
    .toArray();

  const found: RecentEpisode[] = [];
  for (const document of documents) {
    if (document.format === "Film") continue;
    const entries = Object.entries(document.animeSamaEpisodes ?? {});
    for (const [key, value] of entries) {
      const episodeNumber = Number(value?.episode);
      const airsAt = value?.airsAt ? Date.parse(value.airsAt) : Number.NaN;
      if (!Number.isFinite(episodeNumber) || !Number.isFinite(airsAt)) continue;
      // « Derniers épisodes sortis » : une diffusion annoncée plus tard ne
      // s'affiche pas comme déjà sortie.
      if (airsAt > Date.now()) continue;
      // `key` = `slug:saison:langue`.
      const [, saison, langue] = key.split(":");
      const language: "vostfr" | "vf" = langue === "vf" ? "vf" : "vostfr";
      found.push({
        id: document.id,
        titre: document.title ?? "",
        affiche: document.affiche ?? null,
        banniere: document.banniere ?? null,
        imageEpisode: null,
        season: saison ? `Saison ${saison}` : "Saison 1",
        number: episodeNumber,
        titreEpisode: `Épisode ${episodeNumber}`,
        language,
        availableLanguages: [language],
        updatedAt: airsAt,
      });
    }
  }
  return found.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

/**
 * Retrouve une fiche à partir d'un titre (calendrier, liens externes).
 * Recherche TMDB restreinte aux animes, meilleure correspondance de titre.
 */
export async function findAnimeByTitle(title: string): Promise<AnimeSummary | null> {
  const wanted = text(title);
  if (!wanted) return null;
  const page = await queryCatalogueTmdb({ q: wanted, pageSize: 6 });
  const target = normalize(wanted);
  const exact = page.items.find((item) => normalize(item.titre) === target);
  return exact ?? page.items[0] ?? null;
}

/** Recherche rapide multi-types (utilisée par /api/animes?ids=… et l'admin). */
export async function searchSummaries(query: string, limit = 100): Promise<AnimeSummary[]> {
  const q = text(query);
  if (!q) return [];
  const page = await queryCatalogueTmdb({ q, pageSize: Math.min(60, limit) });
  return page.items.slice(0, limit);
}

/** Première page du catalogue animé (sélecteur de l'administration, collage). */
export async function getAllAnimesSnapshot(): Promise<AnimeSummary[]> {
  return listCatalogueTmdb({ sort: "note", limit: 200 });
}

/** Compatibilité : l'ancien code appelait clearAnimeCaches() après une écriture admin. */
export function clearAnimeCaches(): void {
  tvGenreCache = null;
}

export type { AnimeSource };
