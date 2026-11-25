/**
 * Veille des nouveautés (Franime + Anime-Sama) et mise à jour automatique des
 * fiches du catalogue.
 *
 *  - `GET https://api.franime.fr/api/animes` donne, pour chaque animé, l'heure
 *    de mise en ligne de la VO (`updatedDate`) et de la VF (`updatedDateVF`)
 *    en millisecondes, ainsi que le découpage saisons/épisodes et les lecteurs.
 *    Une valeur qui change = du nouveau contenu.
 *  - `https://animes-sama.fr/planning` publie le planning de la semaine, avec
 *    l'heure de diffusion de chaque épisode. Sert à faire apparaître un épisode
 *    dès sa sortie quand Franime n'a pas encore été mis à jour.
 *
 * La passe est idempotente : elle relit les sources, réécrit la fraîcheur de
 * chaque fiche touchée et met à jour la liste des derniers épisodes. Elle peut
 * donc tourner toutes les quelques minutes sans rien abîmer.
 */

// `mongodb` est importé uniquement pour ses types : le chargement à
// l'exécution est fait dynamiquement (voir `openWatchClient`). Sinon le
// bundler suit `mongodb` depuis l'instrumentation et échoue sur `net`,
// `crypto`, `os`…
import type { Db } from "mongodb";
import { catalogueCollection, catalogueCollectionFor } from "./catalogue-db";
import { COLLECTIONS } from "./mongodb";
import { clearAnimeCaches, getAnimeDetail } from "./animes";

const FRANIME_API = "https://api.franime.fr/api/";
const ANIME_SAMA_PLANNING = "https://animes-sama.fr/planning";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const FRANIME_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  Accept: "application/json, text/plain, */*",
  Referer: "https://franime.fr/",
  Origin: "https://franime.fr",
};
const ANIME_SAMA_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
};

/** Fiches Franime réécrites à chaque passe quand leur date a bougé. */
const MAX_REFRESH_PER_RUN = 40;
/** Nouveautés Anime-Sama affichées : au-delà, on ne garde que le plus récent. */
const ANIME_SAMA_LIMIT = 60;

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type FranimeAnime = {
  id: number;
  title?: string;
  updatedDate?: number;
  updatedDateVF?: number;
  saisons?: Array<{ title?: string; episodes?: Array<{ title?: string; lang?: Record<string, { lecteurs?: unknown }> }> }>;
};

export type FranimeSnapshot = {
  fetchedAt: Date;
  animes: Map<number, FranimeAnime>;
  /** Empreinte stable du catalogue Franime (titre + dates), pour détecter un ajout. */
  fingerprint: string;
};

export type AnimeSamaNewEpisode = {
  /** Identifiant stable de la nouveauté (slug + saison + langue + numéro). */
  key: string;
  slug: string;
  title: string;
  saison: string;
  episode: number;
  language: "vostfr" | "vf";
  /** Horodatage de diffusion annoncé par le site (ISO). */
  airsAt: string;
  /** Jour de diffusion, en minuscules. */
  day: string;
  time: string | null;
  affiche: string | null;
  /** Fiche du catalogue correspondante, si elle existe. */
  animeId: string | null;
  /** Titre du catalogue, quand la correspondance est faite. */
  catalogueTitle: string | null;
  url: string;
};

/** Une case du calendrier des sorties, avant regroupement par jour. */
export type CalendarSourceEntry = {
  source: "franime" | "anime-sama";
  /** Titre tel que publié par la source (sert à retrouver la fiche). */
  title: string;
  /** Jour de diffusion, en minuscules : `lundi`…`dimanche`. */
  day: string;
  language: "vo" | "vf";
  saison: string | null;
  episode: string | null;
  time: string | null;
  /** ISO 8601 : prochaine diffusion annoncée. */
  airsAt: string;
  url: string | null;
};

export type FreshnessState = {
  _id: "veille";
  /** Empreinte Franime de la dernière passe. */
  franimeFingerprint: string | null;
  franimeFetchedAt: Date | null;
  /** Date de mise en ligne Franime de la dernière passe, par identifiant Franime. */
  franimeDates: Record<string, number>;
  animeSamaFetchedAt: Date | null;
  /** Épisodes Anime-Sama vus au moins une fois (pour ne montrer que les vrais nouveaux). */
  animeSamaSeen: Record<string, string>;
  lastRunAt: Date | null;
  lastRunMs: number | null;
  lastError: string | null;
  /** Nombre de fiches réécrites à la dernière passe. */
  lastRefreshed: number;
  /** Titres dont la fiche a été réécrite à la dernière passe. */
  lastRefreshedTitles: string[];
};

/* -------------------------------------------------------------------------- */
/* Lecture des sources                                                        */
/* -------------------------------------------------------------------------- */

async function fetchJson<T>(url: string, headers: Record<string, string>, timeoutMs: number): Promise<T | null> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Catalogue Franime complet (≈ 11 Mo, 2 500 animés). */
export async function fetchFranimeSnapshot(): Promise<FranimeSnapshot | null> {
  const list = await fetchJson<FranimeAnime[]>(`${FRANIME_API}animes`, FRANIME_HEADERS, 120_000);
  if (!Array.isArray(list)) return null;
  const animes = new Map<number, FranimeAnime>();
  const parts: string[] = [];
  for (const entry of list) {
    const id = Number(entry?.id);
    if (!Number.isFinite(id)) continue;
    animes.set(id, entry);
    parts.push(`${id}:${Number(entry.updatedDate) || 0}:${Number(entry.updatedDateVF) || 0}`);
  }
  parts.sort();
  // Empreinte légère : une somme de hachage simple, stable pour une même liste.
  let hash = 0;
  const joined = parts.join("|");
  for (let index = 0; index < joined.length; index += 1) {
    hash = (hash * 31 + joined.charCodeAt(index)) % 2_147_483_647;
  }
  return { fetchedAt: new Date(), animes, fingerprint: `${parts.length}-${hash}` };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

const FRENCH_DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** Calendrier Franime (`api/calendrier_data`) : jour, heure et prochain épisode. */
export async function fetchFranimeCalendar(): Promise<CalendarSourceEntry[] | null> {
  const payload = await fetchJson<{ success?: boolean; data?: Array<Record<string, unknown>> }>(
    `${FRANIME_API}calendrier_data`,
    FRANIME_HEADERS,
    45_000,
  );
  const rows = Array.isArray(payload?.data) ? payload.data : null;
  if (!rows || rows.length === 0) return null;
  const entries: CalendarSourceEntry[] = [];
  for (const row of rows) {
    const title = String(row.title_anime ?? "").trim();
    const day = String(row.jour ?? "").trim().toLowerCase();
    const language = String(row.lang ?? "").toLowerCase() === "vf" ? "vf" : "vo";
    if (!title || !FRENCH_DAYS.includes(day)) continue;
    const hours = Number(row.heures);
    const minutes = Number(row.minutes);
    const hasTime = Number.isFinite(hours) && hours >= 0 && hours < 24 && !(hours === 0 && (Number(minutes) || 0) === 0);
    const saison = row.saison == null ? null : String(row.saison);
    const episode = row.prochain_ep == null ? null : String(row.prochain_ep);
    entries.push({
      source: "franime",
      title,
      day,
      language,
      saison,
      episode: episode && episode !== "0" ? episode : null,
      time: hasTime ? `${String(hours).padStart(2, "0")}:${String(Number(minutes) || 0).padStart(2, "0")}` : null,
      // `updatedDate` = dernière mise en ligne : sert d'horodatage de référence.
      airsAt: new Date(Number(row.updatedDate ?? row.updatedDateVF) || Date.now()).toISOString(),
      url: typeof row.url_access_anime_page === "string" ? row.url_access_anime_page : null,
    });
  }
  return entries;
}

/** Le planning Anime-Sama : jour → cartes avec heure, saison et langue. */
export async function fetchAnimeSamaPlanning(): Promise<AnimeSamaNewEpisode[] | null> {
  let html: string;
  try {
    const response = await fetch(ANIME_SAMA_PLANNING, {
      headers: ANIME_SAMA_HEADERS,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    html = await response.text();
  } catch {
    return null;
  }

  const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const found = new Map<string, AnimeSamaNewEpisode>();
  const dayPattern = /(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)<\/h2>[\s\S]{0,300}?(\d{1,2})\/(\d{1,2})/gi;
  const dayMatches = [...html.matchAll(dayPattern)];
  const year = new Date().getFullYear();

  dayMatches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < dayMatches.length ? dayMatches[index + 1].index ?? html.length : html.length;
    const block = html.slice(start, end);
    const day = Number(match[2]);
    const month = Number(match[3]);
    if (!(day >= 1 && day <= 31) || !(month >= 1 && month <= 12)) return;
    // Année : le planning couvre la semaine courante ; décembre → janvier.
    const monthDate = new Date(Date.UTC(year, month - 1, day, 12));
    if (monthDate.getMonth() !== month - 1) return;
    if (month === 1 && new Date().getMonth() === 11) monthDate.setUTCFullYear(year + 1);

    for (const card of block.split("planning-card").slice(1)) {
      const title = decodeEntities(/data-title="([^"]*)"/i.exec(card)?.[1]?.trim() ?? "");
      const href = /href="(\/catalogue\/[^"]+)"/i.exec(card)?.[1] ?? "";
      if (!title || !href) continue;
      const slug = href.split("/")[2] ?? "";
      const seasonRaw = /saison(\d+)/i.exec(href)?.[1] ?? "";
      const language: "vostfr" | "vf" = /\/vf\b/i.test(href) ? "vf" : "vostfr";
      const time = /<span class="info-text[^"]*">\s*(\d{1,2})[H:]\s*(\d{2})\s*<\/span>/i.exec(card);
      const hours = time ? Number(time[1]) : null;
      const minutes = time ? Number(time[2]) : null;
      const airs = new Date(monthDate);
      if (hours !== null && minutes !== null) airs.setUTCHours(hours, minutes, 0, 0);
      const image = /<img class="card-image" src="([^"]+)"/i.exec(card)?.[1] ?? null;
      // La carte ne dit pas toujours la saison (fréquent pour les VF) : on
      // garde la partie du lien avant `/vostfr` ou `/vf`.
      const edition = /\/catalogue\/([^/]+)\/([^/]+)\/(?:vostfr|vf)/i.exec(href);
      const editionSlug = edition?.[2] ?? "saison1";
      // Scans et films ne sont pas des épisodes : hors veille.
      if (!/^saison\d+$/i.test(editionSlug)) return;
      const key = `${slug}:${editionSlug}:${language}`;
      found.set(key, {
        key,
        slug,
        title,
        saison: seasonRaw,
        episode: 0,
        language,
        airsAt: airs.toISOString(),
        day: match[1].toLowerCase(),
        time: hours !== null && minutes !== null ? `${String(hours).padStart(2, "0")}h${String(minutes).padStart(2, "0")}` : null,
        affiche: image,
        animeId: null,
        catalogueTitle: null,
        url: `https://animes-sama.fr${href}`,
      });
    }
  });

  return [...found.values()]
    .sort((a, b) => Date.parse(a.airsAt) - Date.parse(b.airsAt))
    .slice(-ANIME_SAMA_LIMIT);
}

/** Nombre d'épisodes publiés sur une page de saison Anime-Sama. */
async function animeSamaEpisodeCount(url: string): Promise<number> {
  try {
    const response = await fetch(url, {
      headers: ANIME_SAMA_HEADERS,
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
      cache: "no-store",
    });
    if (!response.ok) return 0;
    const html = await response.text();
    const raw = /window\.__EPISODE_NUMBERS\s*=\s*\[([^\]]*)\]/i.exec(html)?.[1];
    if (raw) {
      return raw.split(",").map((value) => Number(value.trim().replace(/^["']|["']$/g, ""))).filter((value) => Number.isFinite(value)).length;
    }
    const list = /var\s+eps1\s*=\s*\[([\s\S]*?)\]/.exec(html)?.[1] ?? "";
    return list.split(",").filter((value) => value.trim().length > 2).length;
  } catch {
    return 0;
  }
}

/* -------------------------------------------------------------------------- */
/* État de la veille                                                          */
/* -------------------------------------------------------------------------- */

async function stateCollection(db: Db) {
  return db.collection<FreshnessState>(COLLECTIONS.freshness);
}

export async function getFreshnessState(db?: Db): Promise<FreshnessState | null> {
  const target = db ?? (await (await import("./mongodb")).getDb());
  return (await stateCollection(target)).findOne({ _id: "veille" });
}

async function saveState(db: Db, patch: Partial<FreshnessState>): Promise<void> {
  const col = await stateCollection(db);
  await col.updateOne({ _id: "veille" }, { $set: patch as Record<string, unknown> }, { upsert: true });
}

/* -------------------------------------------------------------------------- */
/* Application au catalogue                                                   */
/* -------------------------------------------------------------------------- */

/** Écrit la fraîcheur Franime d'une fiche dans son document `catalogue`. */
async function applyFranimeFreshness(
  col: Awaited<ReturnType<typeof catalogueCollection>>,
  franimeId: number,
  entry: FranimeAnime,
): Promise<void> {
  const vo = Number(entry.updatedDate) || 0;
  const vf = Number(entry.updatedDateVF) || 0;
  const saisons = Array.isArray(entry.saisons) ? entry.saisons : [];
  const lastSeason = saisons[saisons.length - 1];
  const episodes = Array.isArray(lastSeason?.episodes) ? lastSeason.episodes : [];
  const lastEpisode = episodes[episodes.length - 1];
  const seasonNumber = Number(/(\d+)/.exec(String(lastSeason?.title ?? ""))?.[1] ?? 0) || null;
  await col.updateOne(
    { franimeId },
    {
      $set: {
        franimeUpdatedAt: vo > 0 ? new Date(vo) : null,
        franimeUpdatedAtVf: vf > 0 ? new Date(vf) : null,
        latestSeason: seasonNumber,
        latestEpisode: episodes.length > 0 ? episodes.length : null,
        latestEpisodeTitle: typeof lastEpisode?.title === "string" ? lastEpisode.title : null,
      },
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Passe de veille                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Écrit le calendrier des sorties dans la collection `calendriers` : un
 * document par jour, `vo` et `vf`, avec l'affiche de la série (jamais l'image
 * de l'épisode) et le lien de la fiche.
 */
type StoredSeason = {
  number?: number;
  index?: number;
  titre?: string;
  name?: string;
  slug?: string;
  absStart?: number | null;
  episodes?: Array<{ number?: number; absNumber?: number | null }>;
};

/**
 * Nom de série, de saison et numéro d'épisode **tels que le site les affiche**,
 * à partir de la fiche du catalogue et non du planning brut de la source :
 * - le titre est celui de la fiche (`title`) ;
 * - la saison se lit dans `seasons[].number` / `index` / `titre`, et son nom
 *   est celui du catalogue (« Saison 2 », « Arc 3 »…) ;
 * - le numéro d'épisode devient le numéro **absolu** de la série, celui que
 *   montre la fiche (One Piece : 1084, pas le 7 de la saison en cours).
 * Faute de fiche, on rend les valeurs de la source, nettoyées.
 */
async function catalogueNaming(
  document: { id?: string; seasons?: StoredSeason[] } | undefined,
  entry: CalendarSourceEntry,
  cache: Map<string, StoredSeason[]>,
): Promise<{ saison: string; episode: string }> {
  const fallback = {
    saison: (entry.saison ?? "").trim(),
    // Franime envoie parfois « 0 » pour « prochain épisode annoncé ».
    episode: entry.episode && entry.episode !== "0" ? entry.episode.trim() : "",
  };
  const id = document?.id;
  if (!id) return fallback;

  let seasons = cache.get(id);
  if (!seasons) {
    const stored = (document as { seasons?: StoredSeason[] }).seasons;
    seasons = Array.isArray(stored) ? stored : [];
    cache.set(id, seasons);
  }
  if (seasons.length === 0) return fallback;

  // Numéro de saison de la source (1 par défaut) et de l'épisode dans celle-ci.
  const wantedSeason = Number(fallback.saison) || 1;
  const wantedEpisode = Number(fallback.episode);
  const season =
    seasons.find((item) => Number(item.number) === wantedSeason) ??
    seasons.find((item) => Number(item.index) + 1 === wantedSeason) ??
    seasons[0];
  if (!season) return fallback;

  const seasonNumber = Number(season.number) || Number(season.index) + 1 || wantedSeason;
  const seasonLabel = String(season.name ?? season.titre ?? "").trim() || `Saison ${seasonNumber}`;
  const episodes = Array.isArray(season.episodes) ? season.episodes : [];

  if (Number.isFinite(wantedEpisode) && wantedEpisode > 0) {
    const found = episodes.find((item) => Number(item.number) === wantedEpisode)
      ?? episodes.find((item) => Number(item.absNumber) === wantedEpisode);
    const absolute = Number(found?.absNumber);
    if (Number.isFinite(absolute) && absolute > 0 && Number(found?.number) !== absolute) {
      // Épisode trouvé : son numéro absolu est celui de la fiche.
      return { saison: seasonLabel, episode: String(absolute) };
    }
    if (found) return { saison: seasonLabel, episode: String(Number(found.number) || wantedEpisode) };
  }

  // Épisode encore inconnu du catalogue (diffusion à venir) : on extrapose à
  // partir du début absolu de la saison, pour rester dans la numérotation de
  // la série (la saison 1 démarre au début absolu de la série).
  const absStart = Number(season.absStart);
  const first = Number(episodes[0]?.absNumber);
  const start = Number.isFinite(absStart) && absStart > 0 ? absStart : first;
  if (Number.isFinite(start) && start > 0 && Number.isFinite(wantedEpisode) && wantedEpisode > 0) {
    return { saison: seasonLabel, episode: String(start + wantedEpisode - 1) };
  }
  return { saison: seasonLabel, episode: fallback.episode };
}

async function writeCalendar(
  db: Db,
  col: Awaited<ReturnType<typeof catalogueCollectionFor>>,
  entries: CalendarSourceEntry[],
): Promise<number> {
  const calendar = db.collection<Record<string, unknown>>(COLLECTIONS.calendar);

  // Affichage : la fiche du catalogue (affiche, genres, synopsis) est la
  // référence ; les sources ne fournissent que le planning.
  const titles = [...new Set(entries.map((entry) => entry.title))];
  const projection = { id: 1, title: 1, originalTitle: 1, titles: 1, affiche: 1, afficheSmall: 1, banniere: 1, genres: 1, synopsis: 1, seasons: 1 };
  const documents = await col.find({ title: { $in: titles } }, { projection }).toArray();
  type PosterDocument = (typeof documents)[number];
  const byTitle = new Map<string, PosterDocument>();
  for (const document of documents) byTitle.set(document.title.trim().toLowerCase(), document);
  // Repli : les sources écrivent parfois le titre autrement (« Black Clover »
  // chez Franime, « Black Clover (2017) » au catalogue) — titre approché.
  for (const entry of entries) {
    const key = entry.title.trim().toLowerCase();
    if (byTitle.has(key)) continue;
    const found = await col
      .findOne(
        { $or: [{ title: new RegExp(`^${escapeRegex(entry.title.trim())}`, "i") }, { originalTitle: new RegExp(`^${escapeRegex(entry.title.trim())}$`, "i") }] },
        { projection },
      )
      .catch(() => null);
    if (found) byTitle.set(key, found);
  }
  // Fiche sans titre : on retrouve la source par le titre original.
  for (const entry of entries) {
    const key = entry.title.trim().toLowerCase();
    if (byTitle.has(key)) continue;
    const found = await col
      .findOne({ originalTitle: new RegExp(`^${escapeRegex(entry.title.trim())}$`, "i") }, { projection })
      .catch(() => null);
    if (found) byTitle.set(key, found);
  }

  const FRENCH = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  const grouped = new Map<string, { vo: Array<Record<string, unknown>>; vf: Array<Record<string, unknown>> }>();
  for (const day of FRENCH) grouped.set(day, { vo: [], vf: [] });

  // Saisons de chaque fiche, lues une seule fois pour toute la passe : c'est
  // elles qui donnent le nom de la saison et le numéro d'épisode du site.
  const seasonsCache = new Map<string, StoredSeason[]>();

  const seen = new Set<string>();
  for (const entry of entries) {
    const bucket = grouped.get(entry.day);
    if (!bucket) continue;
    const document = byTitle.get(entry.title.trim().toLowerCase());
    const key = `${entry.day}:${entry.language}:${document?.id ?? entry.title}:${entry.saison ?? ""}:${entry.episode ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [hours, minutes] = (entry.time ?? "").split(":").map((value) => Number(value));

    // La source ne dit pas toujours la saison (le planning Anime-Sama la perd
    // souvent en VF) et donne des numéros relatifs à leur découpage : on les
    // relit dans la fiche du catalogue, seule référence du site.
    const naming = await catalogueNaming(document, entry, seasonsCache);
    bucket[entry.language].push({
      _id: key,
      animeId: document?.id ?? null,
      // Titre : celui du catalogue, sinon celui de la source (des fiches
      // importées ont un titre vide).
      titre: document?.title?.trim() || entry.title,
      // Affiche de la série : c'est elle que montrent le calendrier et les
      // cartes, jamais une image d'épisode.
      affiche: document?.affiche ?? document?.afficheSmall ?? "",
      banniere: document?.banniere ?? "",
      genre: document?.genres ?? [],
      synopsis: document?.synopsis ?? "",
      saison: naming.saison,
      episode: naming.episode,
      heures: Number.isFinite(hours) ? hours : null,
      minutes: Number.isFinite(minutes) ? minutes : null,
      sources: [entry.source],
      lien: entry.url ?? "",
      airsAt: entry.airsAt,
    });
  }

  // Fusion : on n'écrase jamais une entrée d'une autre source, on la complète.
  const labels = new Map(FRENCH.map((day) => [day, `${day[0].toUpperCase()}${day.slice(1)}`]));
  const syncedAt = new Date();
  let written = 0;
  for (const [day, bucket] of grouped) {
    const values = {
      jour: labels.get(day) ?? day,
      vo: bucket.vo,
      vf: bucket.vf,
      source: "veille",
      syncedAt,
    };
    // Pas de `$set` dans un upsert : MongoDB refuse alors les opérateurs de
    // mise à jour mêlés à la création du document. On remplace la ligne du
    // jour, entièrement recalculée à chaque passe.
    await calendar.replaceOne(
      { jour: { $regex: `^${day}$`, $options: "i" } },
      values,
      { upsert: true },
    );
    written += bucket.vo.length + bucket.vf.length;
  }
  return written;
}

export type WatchRunResult = {
  ranAt: string;
  franimeChanged: boolean;
  franimeFetched: boolean;
  animeSamaFetched: boolean;
  refreshed: Array<{ id: string; titre: string }>;
  newAnimeSama: AnimeSamaNewEpisode[];
  /** Nombre d'entrées écrites dans le calendrier des sorties. */
  calendarEntries: number;
  errors: string[];
  durationMs: number;
};

/**
 * Une passe complète : lire les deux sources, mettre à jour la fraîcheur des
 * fiches touchées, réécrire leurs saisons/épisodes, relever les nouveautés
 * Anime-Sama. Ne jette jamais : les erreurs sont rendues dans le résultat.
 */
export async function runWatch(db: Db, options: { refreshLimit?: number } = {}): Promise<WatchRunResult> {
  const startedAt = Date.now();
  const errors: string[] = [];
  const result: WatchRunResult = {
    ranAt: new Date().toISOString(),
    franimeChanged: false,
    franimeFetched: false,
    animeSamaFetched: false,
    refreshed: [],
    newAnimeSama: [],
    calendarEntries: 0,
    errors,
    durationMs: 0,
  };
  const state = (await getFreshnessState(db)) ?? null;
  const col = await catalogueCollectionFor(db);
  const calendarEntries: CalendarSourceEntry[] = [];

  // --- Franime ------------------------------------------------------------
  const snapshot = await fetchFranimeSnapshot();
  if (!snapshot) {
    errors.push("Franime : catalogue injoignable.");
  } else {
    result.franimeFetched = true;
    const previous = state?.franimeDates ?? {};
    const changed: number[] = [];
    const nextDates: Record<string, number> = {};
    for (const [id, entry] of snapshot.animes) {
      const vo = Number(entry.updatedDate) || 0;
      const vf = Number(entry.updatedDateVF) || 0;
      nextDates[String(id)] = Math.max(vo, vf);
      const before = previous[String(id)] ?? 0;
      if (Math.max(vo, vf) > before) changed.push(id);
    }
    const isFirstRun = !state?.franimeFingerprint;
    result.franimeChanged = !isFirstRun && changed.length > 0;

    // À la première passe on ne réécrit rien : on ne note que l'état.
    const toRefresh = isFirstRun
      ? []
      : changed.slice(0, Math.max(1, options.refreshLimit ?? MAX_REFRESH_PER_RUN));

    // 1. Fraîcheur (rapide, sans TMDB) pour tous les animés dont la date a bougé.
    const freshnessTargets = isFirstRun ? [...snapshot.animes.keys()] : changed;
    for (let index = 0; index < freshnessTargets.length; index += 200) {
      const slice = freshnessTargets.slice(index, index + 200);
      await Promise.all(slice.map(async (id) => {
        const entry = snapshot.animes.get(id);
        if (entry) await applyFranimeFreshness(col, id, entry).catch(() => undefined);
      }));
    }

    // 2. Saisons/épisodes des fiches touchées : `getAnimeDetail` réunit TMDB
    //    (titres, dates, images) et Franime, puis on réécrit le découpage.
    for (const franimeId of toRefresh) {
      try {
        const document = await col.findOne({ franimeId }, { projection: { id: 1, title: 1 } });
        if (!document) continue;
        const detail = await getAnimeDetail(document.id);
        if (!detail) continue;
        const seasons = detail.seasons.map((season, seasonIndex) => ({
          number: seasonIndex + 1,
          absStart: season.episodes[0]?.absoluteNumber ?? null,
          name: season.name,
          slug: season.slug,
          episodes: season.episodes.map((episode) => ({
            number: episode.number,
            absNumber: episode.absoluteNumber ?? null,
            title: episode.titre ?? null,
            airDate: episode.airDate ?? null,
            still: episode.still ?? null,
            overview: episode.overview ?? null,
            playersVo: [],
            playersVf: [],
          })),
        }));
        if (seasons.length === 0) continue;
        await col.updateOne(
          { _id: (document as { _id?: unknown })._id },
          { $set: { seasons, seasonsCount: seasons.length, episodesUpdatedAt: new Date() } },
        );
        result.refreshed.push({ id: document.id, titre: document.title ?? "" });
      } catch (error) {
        errors.push(`Franime ${franimeId} : ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await saveState(db, {
      franimeFingerprint: snapshot.fingerprint,
      franimeFetchedAt: snapshot.fetchedAt,
      franimeDates: nextDates,
    });
  }

  // --- Anime-Sama ---------------------------------------------------------
  const planning = await fetchAnimeSamaPlanning();
  if (!planning) {
    errors.push("Anime-Sama : planning injoignable.");
  } else {
    result.animeSamaFetched = true;
    const seen = { ...(state?.animeSamaSeen ?? {}) };
    const fresh = planning.filter((entry) => !seen[entry.key]);
    for (const entry of fresh.slice(-20)) {
      entry.episode = await animeSamaEpisodeCount(entry.url);
    }
    // Correspondance avec le catalogue (titre exact, sans la casse) : sert à
    // savoir sur quelle fiche écrire l'épisode.
    for (const entry of planning) {
      const document = await col
        .findOne({ title: new RegExp(`^${escapeRegex(entry.title)}$`, "i") }, { projection: { id: 1, title: 1 } })
        .catch(() => null);
      if (document) {
        entry.animeId = document.id;
        entry.catalogueTitle = document.title;
      }
    }

    // Écriture : l'épisode vu prend sa place sur la fiche, avec l'heure de
    // diffusion. C'est ce champ que lit `getRecentEpisodes`.
    const now = new Date();
    for (const entry of fresh) {
      if (!entry.animeId || entry.episode <= 0) continue;
      await col.updateOne(
        { id: entry.animeId },
        {
          $set: {
            [`animeSamaEpisodes.${entry.key}`]: {
              episode: entry.episode,
              airsAt: entry.airsAt,
              checkedAt: now.toISOString(),
            },
            // La fraîcheur Franime ne doit pas masquer une sortie plus récente.
            ...(Date.parse(entry.airsAt) > 0 ? { franimeUpdatedAt: new Date(entry.airsAt) } : {}),
          },
        },
      ).catch(() => undefined);
    }

    result.newAnimeSama = fresh;
    // Le planning sert aussi au calendrier des sorties.
    for (const entry of planning) {
      calendarEntries.push({
        source: "anime-sama",
        title: entry.title,
        day: entry.day,
        language: entry.language === "vf" ? "vf" : "vo",
        saison: entry.saison || null,
        episode: entry.episode > 0 ? String(entry.episode) : null,
        time: entry.time,
        airsAt: entry.airsAt,
        url: entry.url,
      });
    }
    for (const entry of planning) seen[entry.key] = entry.airsAt;
    // Purge : on ne garde que les clés encore au planning.
    const alive = new Set(planning.map((entry) => entry.key));
    for (const key of Object.keys(seen)) if (!alive.has(key)) delete seen[key];
    await saveState(db, { animeSamaFetchedAt: new Date(), animeSamaSeen: seen });
  }

  // --- Calendrier des sorties (Franime + Anime-Sama) ----------------------
  const franimeCalendar = await fetchFranimeCalendar();
  if (!franimeCalendar) {
    errors.push("Calendrier Franime : source injoignable.");
  } else {
    calendarEntries.push(...franimeCalendar);
  }
  if (calendarEntries.length > 0) {
    try {
      result.calendarEntries = await writeCalendar(db, col, calendarEntries);
    } catch (error) {
      // Un échec du calendrier ne doit pas masquer le reste : on journalise
      // et on continue, la passe suivante réessaiera.
      console.error("[veille] calendrier :", error);
      errors.push("Calendrier : écriture impossible.");
    }
  }

  clearAnimeCaches();
  result.durationMs = Date.now() - startedAt;
  await saveState(db, {
    lastRunAt: new Date(),
    lastRunMs: result.durationMs,
    lastError: errors.length > 0 ? errors.join(" · ") : null,
    lastRefreshed: result.refreshed.length,
    lastRefreshedTitles: result.refreshed.map((entry) => entry.titre).slice(0, 20),
  });
  return result;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* -------------------------------------------------------------------------- */
/* Boucle de fond (serveur Node de `next start`)                              */
/* -------------------------------------------------------------------------- */

type LoopCache = { timer: NodeJS.Timeout | null; running: boolean; last: WatchRunResult | null };
declare global {
  // eslint-disable-next-line no-var
  var __animevisionWatch: LoopCache | undefined;
}

/** Intervalle en minutes (`VEILLE_MINUTES`, 10 par défaut, 0 = désactivé). */
export function watchIntervalMinutes(): number {
  const raw = Number(process.env.VEILLE_MINUTES ?? "10");
  return Number.isFinite(raw) && raw >= 0 ? raw : 10;
}

/**
 * Démarre la veille en tâche de fond, une fois par processus. Désactivée par
 * `VEILLE_AUTO=0` (le cron `scripts/veille.mjs` prend alors le relais).
 */
/**
 * Démarre la veille depuis le serveur : appelé au premier accès à MongoDB
 * (`mongodb.ts`), ce qui évite de charger `mongodb` depuis l'instrumentation
 * (bundle séparé, qui ne connaît pas les modules Node comme `net`).
 */
export function ensureWatchLoop(): void {
  try {
    startWatchLoop();
  } catch (error) {
    console.error("[veille] démarrage impossible :", error);
  }
}

export function startWatchLoop(): void {
  if (process.env.VEILLE_AUTO === "0") return;
  const minutes = watchIntervalMinutes();
  if (minutes <= 0) return;
  if (globalThis.__animevisionWatch?.timer) return;
  const cache: LoopCache = globalThis.__animevisionWatch ?? { timer: null, running: false, last: null };
  globalThis.__animevisionWatch = cache;

  const tick = async () => {
    if (cache.running) return;
    cache.running = true;
    try {
      const { getDb } = await import("./mongodb");
      cache.last = await runWatch(await getDb());
      console.log(
        `[veille] ${cache.last.refreshed.length} fiche(s) mise(s) à jour, `
        + `${cache.last.newAnimeSama.length} nouveauté(s) Anime-Sama, ${Math.round(cache.last.durationMs / 1000)} s`,
      );
    } catch (error) {
      console.error("[veille] passe impossible :", error);
    } finally {
      cache.running = false;
    }
  };

  cache.timer = setInterval(() => void tick(), minutes * 60_000);
  cache.timer.unref?.();
  // Première passe peu après le démarrage, sans bloquer le serveur.
  setTimeout(() => void tick(), 20_000).unref?.();
}

/* -------------------------------------------------------------------------- */
/* Hors serveur (script `npm run veille`)                                     */
/* -------------------------------------------------------------------------- */

/** Ouvre une connexion Mongo hors du serveur (script `npm run veille`). */
export async function openWatchClient(): Promise<{ client: import("mongodb").MongoClient; db: Db }> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI absent de .env.local.");
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);
  await client.connect();
  return { client, db: client.db(process.env.MONGODB_DB || "animevision") };
}
