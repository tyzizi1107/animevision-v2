/**
 * Source de vérité du catalogue : la collection MongoDB `catalogue`, alimentée
 * par `scripts/sync-catalogue.mjs` depuis Franime (qui existe, combien de
 * saisons) puis enrichie par TMDB (synopsis, genres, visuels, casting).
 *
 * Aucune requête réseau ici : TMDB n'est plus interrogé à l'exécution.
 * Les épisodes, eux, ne sont pas stockés — ils viennent toujours de TMDB au
 * moment d'ouvrir la fiche / le lecteur (voir `getAnimeDetail` dans animes.ts).
 */

import type { AnimeSummary } from "@/lib/anime-types";
import type { Db } from "mongodb";
import { COLLECTIONS, getDb } from "@/lib/mongodb";

/** Document tel qu'écrit par `scripts/sync-catalogue.mjs`. */
/** Corrections saisies dans l'administration, appliquées par-dessus TMDB. */
export type AdminOverride = {
  titre?: string;
  synopsis?: string;
  affiche?: string;
  banniere?: string;
  logo?: string;
  genres?: string[];
  autresNoms?: string[];
  date?: string;
  /**
   * Saisons masquées : l'admin a supprimé ces saisons, elles ne doivent pas
   * revenir au rechargement. `hiddenSeasons: true` = toutes (fiche vidée).
   */
  hiddenSeasons?: boolean;
  seasons?: Record<string, { name?: string; affiche?: string; hidden?: boolean }>;
  episodes?: Record<string, {
    titre?: string;
    airDate?: string;
    overview?: string;
    still?: string;
    runtime?: number;
    vo?: Array<{ lecteur: string; lien: string }>;
    vf?: Array<{ lecteur: string; lien: string }>;
  }>;
};

export type CatalogueDocument = {
  adminOverride?: AdminOverride | null;
  /** Numéro public alphabétique (`/anime/12`), attribué une seule fois. */
  numero?: number;
  id: string;
  tmdbId?: number | null;
  tmdbMatch?: boolean;
  franimeId?: number | null;
  title: string;
  originalTitle?: string | null;
  titles?: Record<string, string> | null;
  synopsis?: string | null;
  genres?: string[] | null;
  themes?: string[] | null;
  year?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  rating?: number | null;
  tmdbRating?: number | null;
  popularite?: number | null;
  affiche?: string | null;
  afficheSmall?: string | null;
  banniere?: string | null;
  format?: string | null;
  nsfw?: boolean;
  seasonsCount?: number | null;
  tmdbSeasonsCount?: number | null;
  /** Découpage Franime importé : saisons, épisodes et lecteurs disponibles. */
  seasons?: StoredSeason[] | null;
  episodesUpdatedAt?: Date | string | null;
  /** Épisodes vus sur Anime-Sama : `slug:saison:langue` → numéro du dernier épisode. */
  animeSamaEpisodes?: Record<string, { episode: number; airsAt?: string; checkedAt?: string }> | null;
  /** Fraîcheur côté Franime : dernière mise en ligne VO et VF. */
  franimeUpdatedAt?: Date | string | null;
  franimeUpdatedAtVf?: Date | string | null;
  latestSeason?: number | null;
  latestEpisode?: number | null;
  latestEpisodeTitle?: string | null;
  kitsuUrl?: string | null;
  cast?: Array<{ id: number; name: string; role?: string | null; photo?: string | null }>;
  sources?: string[];
  updatedAt?: Date | string | null;
};

export type StoredEpisode = {
  number: number;
  /** Numérotation absolue Franime (One Piece : saga 2 = 62..143), celle qu'attend le lecteur. */
  absNumber?: number | null;
  title?: string | null;
  airDate?: string | null;
  still?: string | null;
  overview?: string | null;
  /** Épisode TMDB correspondant (aligné par date de diffusion). */
  tmdbSeason?: number | null;
  tmdbEpisode?: number | null;
  playersVf?: string[] | null;
  playersVo?: string[] | null;
};

export type StoredSeason = {
  /** Absent des fiches créées par la synchro Anime-Sama (voir `index`). */
  number?: number;
  /** Rang de la saison (0 = saison 1) pour les fiches importées d'Anime-Sama. */
  index?: number;
  titre?: string;
  /** Premier numéro absolu de la saison, repris de `anime-seasons`. */
  absStart?: number | null;
  name: string;
  slug: string;
  episodes: StoredEpisode[];
};

export type CatalogueSort = "note" | "recent" | "az";

export type CatalogueQuery = {
  q?: string;
  genre?: string;
  sort?: string | null;
  page?: number;
  /** Nombre de fiches par page (24 par défaut). */
  pageSize?: number;
  /** Restreint aux fiches qui ont une correspondance TMDB (liens jouables). */
  tmdbOnly?: boolean;
};

export type CataloguePage = {
  items: AnimeSummary[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  genres: Array<{ name: string; count: number }>;
  totalCatalog: number;
};

const DEFAULT_PAGE_SIZE = 24;

function collection() {
  return getDb().then((db) => db.collection<CatalogueDocument>(COLLECTIONS.catalogue));
}

/** Même collection, sur une connexion déjà ouverte (veille hors serveur). */
export function catalogueCollectionFor(db: Db) {
  return db.collection<CatalogueDocument>(COLLECTIONS.catalogue);
}

/** Accès direct à la collection (derniers épisodes, scripts de contrôle). */
export function catalogueCollection() {
  return collection();
}

/** Document `catalogue` → `AnimeSummary`, la forme qu'attendent toutes les cartes. */
export function summaryFromDocument(document: CatalogueDocument): AnimeSummary {
  const titles = document.titles ?? {};
  const autresNoms = [
    document.originalTitle,
    titles.en,
    titles.ja_jp,
    titles.ja,
    titles.romaji,
    titles.fr,
  ].filter((value): value is string => Boolean(value && value.trim()));

  const o = document.adminOverride ?? {};
  const base: AnimeSummary = {
    // Identifiant public : le numéro alphabétique (`/anime/12`) dès qu'il
    // existe ; l'ancien `tv-<tmdbId>` sert de repli avant migration.
    id: Number((document as { numero?: unknown }).numero) > 0 ? String((document as { numero?: unknown }).numero) : document.id,
    // 102 fiches importées ont un titre vide : le titre original (ou le
    // premier titre étranger) prend le relais au lieu d'un titre vide.
    titre: document.title?.trim() || document.originalTitle?.trim() || titles.fr || titles.en || titles.en_jp || titles.romaji || "Anime",
    autresNoms: [...new Set(autresNoms)].filter((name) => name.toLowerCase() !== document.title.toLowerCase()),
    // `format` arrive de plusieurs imports ("Film", "movie", "FILM") : on
    // normalise, sinon un film gardait le badge « Série animée ».
    type: /^film$/i.test(String(document.format ?? "").trim()) || /^movie$/i.test(String(document.format ?? "").trim()) ? "movie" : "tv",
    synopsis: document.synopsis ?? "",
    affiche: document.affiche ?? document.afficheSmall ?? null,
    banniere: document.banniere ?? document.affiche ?? null,
    logo: null,
    genres: document.genres ?? [],
    // Franime renvoie la note en texte ("8.02") : on la convertit toujours en nombre,
    // sinon les cartes plantent sur `score.toFixed()`.
    score: displayScore(document),
    date: document.startDate ?? (document.year ? `${document.year}-01-01` : ""),
  };
  return applyFicheOverride(base, o);
}

/** Champs de la fiche corrigés par un administrateur (vides = inchangés). */
export function applyFicheOverride<T extends AnimeSummary>(summary: T, o: AdminOverride | null | undefined): T {
  if (!o) return summary;
  return {
    ...summary,
    titre: o.titre || summary.titre,
    synopsis: o.synopsis ?? summary.synopsis,
    affiche: o.affiche || summary.affiche,
    banniere: o.banniere || summary.banniere,
    logo: o.logo || summary.logo,
    genres: o.genres ?? summary.genres,
    autresNoms: o.autresNoms ?? summary.autresNoms,
    date: o.date || summary.date,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Note affichable : Frankime en texte, TMDB en nombre, 0 si absente. */
function displayScore(document: { rating?: unknown; tmdbRating?: unknown }): number {
  return Number(document.rating ?? document.tmdbRating ?? 0) || 0;
}

function sortToOrder(sort: CatalogueSort): Record<string, 1 | -1> {
  if (sort === "az") return { title: 1 };
  if (sort === "recent") return { startDate: -1, year: -1, tmdbRating: -1 };
  // « Les mieux notés » = la note réellement affichée sur les cartes, qui est
  // `tmdbRating` (le champ `rating` n'est jamais rempli par l'import). Trier
  // sur `tmdbMatch` d'abord casait toutes les fiches importées du catalogue
  // en fin de liste, quel que soit leur note.
  return { tmdbRating: -1, rating: -1, popularite: -1, title: 1 };
}

function normalizeSort(value: string | null | undefined): CatalogueSort {
  return value === "recent" ? "recent" : value === "az" ? "az" : "note";
}

/** Filtre Mongo commun à toutes les lectures. */
function buildFilter(query: CatalogueQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const searched = query.q?.trim();
  if (searched) {
    const regex = new RegExp(escapeRegex(searched), "i");
    filter.$or = [
      { title: regex },
      { originalTitle: regex },
      { "titles.en": regex },
      { "titles.ja_jp": regex },
      { "titles.fr": regex },
      { "titles.romaji": regex },
    ];
  }
  if (query.genre?.trim()) filter.genres = query.genre.trim();
  if (query.tmdbOnly) filter.tmdbMatch = true;
  // Le catalogue n'est plus filtré : tout ce que TMDB connaît est servi —
  // films, séries et animés, avec ou sans affiche. Seules les versions
  // « sans fillers » et « Kaï » (doublons d'une même série) restent écartées.
  const excludedTitles = {
    $and: [
      { title: { $not: /sans\s+fillers?/i } },
      { title: { $not: /no\s+fillers?/i } },
      { title: { $not: /\bka[iï]\b/i } },
    ],
  };
  filter.$and = filter.$and ? [...(filter.$and as unknown[]), excludedTitles] : [excludedTitles];
  return filter;
}

/** Une page du catalogue : recherche, genre, tri et pagination. */
export async function queryCatalogue(query: CatalogueQuery = {}): Promise<CataloguePage> {
  const col = await collection();
  // Une fiche sans numéro public n'a pas d'URL : on ne la montre pas (elle
  // n'a ni titre ni affiche exploitables, elle serait une carte vide).
  const filter = { $and: [buildFilter(query), { numero: { $gt: 0 } }] };
  const sort = normalizeSort(query.sort);
  const pageSize = Math.max(1, Math.min(60, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE)));
  const page = Math.max(1, Math.floor(query.page ?? 1));

  // Tri « note » : la valeur triée doit être EXACTEMENT celle des cartes.
  // Mongo ne sait pas fusionner deux champs (`rating` en texte, `tmdbRating`
  // en nombre), on trie donc en mémoire — le catalogue tient largement.
  if (sort === "note") {
    const [all, totalCatalog, facettes] = await Promise.all([
      col.find(filter, { projection: { seasons: 0, cast: 0 } }).toArray(),
      col.estimatedDocumentCount(),
      col
        .aggregate<{ _id: string; count: number }>([
          { $match: { numero: { $gt: 0 }, genres: { $type: "array" } } },
          { $unwind: "$genres" },
          { $group: { _id: "$genres", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 30 },
        ])
        .toArray(),
    ]);
    all.sort((a, b) => displayScore(b) - displayScore(a) || String(a.title ?? "").localeCompare(String(b.title ?? ""), "fr"));
    return {
      items: all.slice((page - 1) * pageSize, page * pageSize).map(summaryFromDocument),
      total: all.length,
      totalCatalog,
      genres: facettes.map((entry) => ({ name: entry._id, count: entry.count })),
      page,
      pages: Math.max(1, Math.ceil(all.length / pageSize)),
      pageSize,
    };
  }

  const [documents, total, totalCatalog, genreFacets] = await Promise.all([
    col.find(filter).sort(sortToOrder(sort)).skip((page - 1) * pageSize).limit(pageSize).toArray(),
    col.countDocuments(filter),
    col.estimatedDocumentCount(),
    col
      .aggregate<{ _id: string; count: number }>([
        { $match: { genres: { $type: "array" } } },
        { $unwind: "$genres" },
        { $group: { _id: "$genres", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 30 },
      ])
      .toArray(),
  ]);

  return {
    items: documents.map(summaryFromDocument),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    pageSize,
    genres: genreFacets.map((entry) => ({ name: entry._id, count: entry.count })),
    totalCatalog,
  };
}

/** Listes « à voir » : plus récents, mieux notés, ou décalage aléatoire stable. */
export async function listCatalogue(options: {
  sort?: CatalogueSort;
  limit?: number;
  genre?: string;
  excludeIds?: string[];
  tmdbOnly?: boolean;
} = {}): Promise<AnimeSummary[]> {
  const col = await collection();
  const filter = buildFilter({ genre: options.genre, tmdbOnly: options.tmdbOnly });
  if (options.excludeIds?.length) filter.id = { $nin: options.excludeIds };
  const documents = await col
    .find(filter)
    .sort(sortToOrder(options.sort ?? "note"))
    .limit(Math.max(1, Math.min(200, options.limit ?? 24)))
    .toArray();
  return documents.map(summaryFromDocument);
}

export async function getCatalogueDocument(id: string): Promise<CatalogueDocument | null> {
  const col = await collection();
  return col.findOne({ id: id.trim() });
}

export async function getCatalogueDocuments(ids: string[]): Promise<CatalogueDocument[]> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const col = await collection();
  return col.find({ id: { $in: unique } }).toArray();
}

/** Recherche par titre exact puis approché (utilisée par le calendrier). */
export async function findCatalogueByTitle(title: string): Promise<AnimeSummary | null> {
  const wanted = title.trim();
  if (!wanted) return null;
  const col = await collection();
  const exact = await col.findOne({
    $or: [{ title: wanted }, { originalTitle: wanted }, { "titles.en": wanted }],
  });
  if (exact) return summaryFromDocument(exact);
  const loose = await col
    .find({
      $or: [
        { title: new RegExp(`^${escapeRegex(wanted)}`, "i") },
        { originalTitle: new RegExp(`^${escapeRegex(wanted)}`, "i") },
      ],
    })
    .limit(1)
    .next();
  return loose ? summaryFromDocument(loose) : null;
}

/** Nombre total de fiches, pour l'affichage « X animés ». */
export async function countCatalogue(): Promise<number> {
  const col = await collection();
  return col.estimatedDocumentCount();
}

/** Genres avec leur nombre de fiches (page recherche). */
export async function catalogueGenres(): Promise<Array<{ name: string; count: number }>> {
  const col = await collection();
  const rows = await col
    .aggregate<{ _id: string; count: number }>([
      { $match: { genres: { $type: "array" } } },
      { $unwind: "$genres" },
      { $group: { _id: "$genres", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 30 },
    ])
    .toArray();
  return rows.map((row) => ({ name: row._id, count: row.count }));
}

/** Fiches du même genre, pour « Dans le même esprit ». */
export async function similarFromCatalogue(anime: AnimeSummary, limit = 12): Promise<AnimeSummary[]> {
  const col = await collection();
  const genres = (anime.genres ?? []).filter(Boolean).slice(0, 3);
  if (genres.length === 0) return [];
  const documents = await col
    .find({ genres: { $in: genres }, numero: { $gt: 0, $ne: Number(anime.id) || -1 }, tmdbMatch: true })
    .sort({ rating: -1 })
    .limit(Math.max(1, Math.min(30, limit)))
    .toArray();
  return documents.map(summaryFromDocument);
}
