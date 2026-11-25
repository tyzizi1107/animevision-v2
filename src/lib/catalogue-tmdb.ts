/**
 * Catalogue lu DIRECTEMENT dans TMDB (avec la clé API du `.env.local`).
 *
 * Il remplace la collection Mongo `catalogue` : plus de synchronisation à
 * lancer, les fiches, la recherche, les genres et les pages sont demandés à
 * TMDB à la volée. Les réponses passent par `tmdbCached()` (cache mémoire +
 * copie Mongo `tmdbCache`), donc une même page ne coûte qu'un appel.
 *
 * Identifiants : `<type>-<tmdbId>` (`tv-37854`, `movie-1726`). C'est déjà la
 * forme que comprend `parseCatalogId()` et que construisent les liens du site.
 */

import type { AnimeSummary } from "./anime-types";
import {
  ANIMATION_GENRE_ID,
  JAPAN_COUNTRY,
  imageUrl,
  localeParams,
  tmdbCached,
  tmdbTry,
  type MediaType,
} from "./tmdb";

/** Durée de fraîcheur des listes (les sorties changent lentement). */
const LIST_TTL = 30 * 60_000;
/** Une fiche change rarement : 12 h de cache. */
const DETAIL_TTL = 12 * 60 * 60_000;
const MAX_PAGE = 500;

type RawItem = {
  id?: number;
  name?: string;
  title?: string;
  original_name?: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: Array<{ id?: number; name?: string }>;
  genre_ids?: number[];
  vote_average?: number;
  first_air_date?: string;
  release_date?: string;
  origin_country?: string[];
  original_language?: string;
};

type RawList = {
  results?: RawItem[];
  total_pages?: number;
  total_results?: number;
};

export type TmdbCatalogueQuery = {
  q?: string;
  genre?: string;
  sort?: string | null;
  page?: number;
  pageSize?: number;
};

export type TmdbCataloguePage = {
  items: AnimeSummary[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  genres: Array<{ name: string; count: number }>;
  totalCatalog: number;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** `<type>-<tmdbId>`, la seule forme d'identifiant public du catalogue. */
export function tmdbCatalogId(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType === "movie" ? "movie" : "tv"}-${tmdbId}`;
}

/** Vrai pour un identifiant de fiche TMDB (`tv-123`, `movie-123`). */
export function isTmdbCatalogId(value: unknown): boolean {
  return typeof value === "string" && /^(tv|movie)-\d{1,9}$/i.test(value.trim());
}

function summaryOf(item: RawItem, mediaType: MediaType): AnimeSummary | null {
  const tmdbId = Number(item.id);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;
  const title = text(item.name ?? item.title) || text(item.original_name ?? item.original_title) || "Sans titre";
  // TMDB mélange télé-réalité et animation dans les mêmes genres : on ne garde
  // que ce qui a la forme d'un animé (genre Animation côté série/film).
  const isAnimation = (item.genre_ids ?? []).includes(ANIMATION_GENRE_ID)
    || (item.genres ?? []).some((genre) => Number(genre.id) === ANIMATION_GENRE_ID || /animation/i.test(text(genre.name)));
  if (!isAnimation) return null;
  const original = text(item.original_name ?? item.original_title);
  const date = text(item.first_air_date ?? item.release_date);
  return {
    id: tmdbCatalogId(mediaType, tmdbId),
    titre: title,
    autresNoms: [...new Set([original].filter((alias) => alias && normalize(alias) !== normalize(title)))].slice(0, 10),
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

/** Genre TMDB (nom FR ou EN) → identifiant, sinon null. */
let genreCache: { at: number; list: Array<{ id: number; name: string }> } | null = null;

export async function tmdbGenres(): Promise<Array<{ id: number; name: string }>> {
  if (genreCache && Date.now() - genreCache.at < 24 * 60 * 60_000) return genreCache.list;
  const [tv, movie] = await Promise.all([
    tmdbTry<{ genres?: Array<{ id?: number; name?: string }> }>("/genre/tv/list", localeParams(), 24 * 60 * 60_000),
    tmdbTry<{ genres?: Array<{ id?: number; name?: string }> }>("/genre/movie/list", localeParams(), 24 * 60 * 60_000),
  ]);
  const byId = new Map<number, string>();
  for (const entry of [...(tv?.genres ?? []), ...(movie?.genres ?? [])]) {
    const id = Number(entry.id);
    const name = text(entry.name);
    if (id > 0 && name && !byId.has(id)) byId.set(id, name);
  }
  const list = [...byId].map(([id, name]) => ({ id, name }));
  genreCache = { at: Date.now(), list };
  return list;
}

async function genreIdFromName(name: string): Promise<number | null> {
  const wanted = normalize(name);
  if (!wanted) return null;
  const list = await tmdbGenres();
  const hit = list.find((genre) => normalize(genre.name) === wanted)
    ?? list.find((genre) => normalize(genre.name).includes(wanted) || wanted.includes(normalize(genre.name)));
  return hit ? hit.id : null;
}

/** Genres animés avec un nombre de fiches (une requête discover par genre). */
export async function tmdbGenreStats(limit = 16): Promise<Array<{ name: string; count: number }>> {
  const cached = await tmdbCached<Array<{ name: string; count: number }>>(
    "/animevision/genres",
    {},
    LIST_TTL,
  );
  if (cached && cached.length) return cached;
  const list = await tmdbGenres();
  const stats = await Promise.all(
    list
      .filter((genre) => genre.id !== ANIMATION_GENRE_ID)
      .slice(0, limit)
      .map(async (genre) => {
        const data = await tmdbTry<RawList>(
          "/discover/tv",
          {
            ...localeParams(),
            with_genres: `${ANIMATION_GENRE_ID},${genre.id}`,
            with_origin_country: JAPAN_COUNTRY,
            page: 1,
          },
          LIST_TTL,
        );
        return { name: genre.name, count: Number(data?.total_results) || 0 };
      }),
  );
  const result = stats.filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count);
  return result;
}

/** Paramètres `discover` : animés japonais, séries et films selon `type`. */
function discoverParams(mediaType: MediaType, options: { sort?: string | null; genreId?: number | null; page?: number }) {
  const sort = options.sort ?? "note";
  const dateField = mediaType === "movie" ? "primary_release_date" : "first_air_date";
  const sortBy = sort === "az"
    ? (mediaType === "movie" ? "original_title.asc" : "name.asc")
    : sort === "recent"
      ? `${dateField}.desc`
      : "popularity.desc";
  return {
    ...localeParams(),
    page: Math.min(Math.max(1, options.page ?? 1), MAX_PAGE),
    sort_by: sortBy,
    // Le genre Animation de TMDB inclut la télé-réalité (fausses jaquettes
    // animées) : on restreint au Japon, patrie des animés.
    with_genres: options.genreId ? `${ANIMATION_GENRE_ID},${options.genreId}` : String(ANIMATION_GENRE_ID),
    with_origin_country: JAPAN_COUNTRY,
    ...(sort === "note" ? { "vote_count.gte": 10 } : {}),
  };
}

async function discover(mediaType: MediaType, options: { sort?: string | null; genreId?: number | null; page?: number }) {
  const data = await tmdbTry<RawList>(`/discover/${mediaType}`, discoverParams(mediaType, options), LIST_TTL);
  const items = (data?.results ?? [])
    .map((item) => summaryOf(item, mediaType))
    .filter((item): item is AnimeSummary => item !== null);
  return {
    items,
    total: Number(data?.total_results) || items.length,
    pages: Math.min(Number(data?.total_pages) || 1, MAX_PAGE),
  };
}

function sortItems(items: AnimeSummary[], sort: string | null | undefined): AnimeSummary[] {
  const sorted = [...items];
  if (sort === "az") sorted.sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
  else if (sort === "recent") sorted.sort((a, b) => b.date.localeCompare(a.date) || b.score - a.score);
  else sorted.sort((a, b) => b.score - a.score || a.titre.localeCompare(b.titre, "fr"));
  return sorted;
}

async function searchTmdb(query: string, page: number): Promise<{ items: AnimeSummary[]; total: number; pages: number }> {
  // Recherche multi : séries et films en une requête, puis on ne garde que
  // l'animation japonaise.
  const data = await tmdbTry<{ results?: Array<RawItem & { media_type?: string }>; total_pages?: number; total_results?: number }>(
    "/search/multi",
    { ...localeParams(), query, page: Math.min(Math.max(1, page), MAX_PAGE), include_adult: "false" },
    LIST_TTL,
  );
  const items = (data?.results ?? [])
    .filter((item) => {
      const type = item.media_type;
      if (type !== "tv" && type !== "movie") return false;
      const countries = item.origin_country ?? [];
      const isJapanese = countries.includes(JAPAN_COUNTRY) || item.original_language === "ja";
      const isAnimation = (item.genre_ids ?? []).includes(ANIMATION_GENRE_ID);
      return isJapanese && isAnimation;
    })
    .map((item) => summaryOf(item, item.media_type === "movie" ? "movie" : "tv"))
    .filter((item): item is AnimeSummary => item !== null);
  return {
    items,
    total: Number(data?.total_results) || items.length,
    pages: Math.min(Number(data?.total_pages) || 1, MAX_PAGE),
  };
}

/** Une page de catalogue : recherche, genre, tri et pagination, servis par TMDB. */
export async function queryCatalogueTmdb(query: TmdbCatalogueQuery = {}): Promise<TmdbCataloguePage> {
  const pageSize = Math.max(1, Math.min(60, Math.floor(query.pageSize ?? 24)));
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const genres = await tmdbGenreStats();
  const genreId = query.genre ? await genreIdFromName(query.genre) : null;

  const wanted = text(query.q ?? "");
  if (wanted) {
    // TMDB pagine par 20 : on demande juste ce qu'il faut pour remplir la page.
    const result = await searchTmdb(wanted, page);
    return {
      items: sortItems(result.items, query.sort),
      total: result.total,
      page,
      pages: Math.max(1, result.pages),
      pageSize: result.items.length || pageSize,
      genres,
      totalCatalog: result.total,
    };
  }

  // Séries et films en parallèle : la page mélange les deux, comme avant.
  const [series, movies] = await Promise.all([
    discover("tv", { sort: query.sort, genreId, page }),
    discover("movie", { sort: query.sort, genreId, page }),
  ]);
  const items = sortItems([...series.items, ...movies.items], query.sort).slice(0, pageSize);
  const total = series.total + movies.total;
  return {
    items,
    total,
    page,
    pages: Math.max(1, Math.max(series.pages, movies.pages)),
    pageSize,
    genres,
    totalCatalog: total,
  };
}

/** Listes « à voir » : plus récents, mieux notés, ou par genre. */
export async function listCatalogueTmdb(options: {
  sort?: "note" | "recent" | "az";
  limit?: number;
  genre?: string;
  excludeIds?: string[];
} = {}): Promise<AnimeSummary[]> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 24));
  const genreId = options.genre ? await genreIdFromName(options.genre) : null;
  const wantedPages = Math.ceil(limit / 20) + 1;
  const requests: Array<Promise<{ items: AnimeSummary[] }>> = [];
  for (let page = 1; page <= wantedPages; page += 1) {
    requests.push(discover("tv", { sort: options.sort, genreId, page }));
    requests.push(discover("movie", { sort: options.sort, genreId, page }));
  }
  const pages = await Promise.all(requests);
  const excluded = new Set(options.excludeIds ?? []);
  const seen = new Set<string>();
  const items: AnimeSummary[] = [];
  for (const entry of pages) {
    for (const item of entry.items) {
      if (seen.has(item.id) || excluded.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length >= limit) break;
    }
    if (items.length >= limit) break;
  }
  return items;
}

type TmdbFullDetail = RawItem & {
  genres?: Array<{ id?: number; name?: string }>;
  seasons?: Array<{ season_number?: number; name?: string; episode_count?: number }>;
  number_of_seasons?: number;
  number_of_episodes?: number;
};

/**
 * Fiche complète (titre FR, affiche, bannière, genres, note) pour un
 * identifiant `tv-…` / `movie-…`. Sert au repli quand la fiche détaillée
 * n'a pas pu être construite.
 */
export async function getCatalogueSummaryTmdb(id: string): Promise<AnimeSummary | null> {
  const match = /^(tv|movie)-(\d{1,9})$/i.exec(id.trim());
  if (!match) return null;
  const mediaType: MediaType = match[1].toLowerCase() === "movie" ? "movie" : "tv";
  const tmdbId = Number(match[2]);
  const detail = await tmdbCached<TmdbFullDetail>(`/${mediaType}/${tmdbId}`, localeParams(), DETAIL_TTL);
  if (!detail) return null;
  return summaryOf({ ...detail, id: tmdbId }, mediaType);
}

/** Détail TMDB brut, pour les pages qui ont besoin des saisons. */
export async function getTmdbDetail<T>(id: string, append = ""): Promise<T | null> {
  const match = /^(tv|movie)-(\d{1,9})$/i.exec(id.trim());
  if (!match) return null;
  const mediaType: MediaType = match[1].toLowerCase() === "movie" ? "movie" : "tv";
  const params: Record<string, string> = { ...localeParams() };
  if (append) params.append_to_response = append;
  return tmdbCached<T>(`/${mediaType}/${Number(match[2])}`, params, DETAIL_TTL);
}
