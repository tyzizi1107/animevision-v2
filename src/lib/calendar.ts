import { getDb } from "./mongodb";
import { findAnimeByTitle, normalize, parseCatalogId } from "./animes";
import type { AnimeSummary } from "./anime-types";
import { hiddenIds } from "./availability";
import { catalogueCollection } from "./catalogue-db";

/** Collection existante (hors préfixe av_) : planning hebdomadaire VO/VF. */
export const CALENDAR_COLLECTION = "calendriers";

export const CALENDAR_DAYS = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
] as const;
const CALENDAR_CACHE_TTL = 5 * 60_000;

export type CalendarEntry = {
  id: string;
  titre: string;
  affiche: string | null;
  genres: string[];
  synopsis: string;
  season: string | null;
  episode: string | null;
  episodeTitle: string | null;
  episodeStill: string | null;
  time: string | null;
  startMinutes: number;
};

export type CalendarDay = {
  day: string;
  vo: CalendarEntry[];
  vf: CalendarEntry[];
};

export type WeekDay = {
  index: number;
  day: string;
  short: string;
  date: number;
  month: string;
  isToday: boolean;
};

type RawEntry = {
  _id?: unknown;
  titre?: string;
  affiche?: string;
  genre?: string[] | string;
  synopsis?: string;
  saison?: string;
  episode?: string;
  heures?: number | string;
  minutes?: number | string;
};

type RawDay = {
  jour?: string;
  vo?: RawEntry[];
  vf?: RawEntry[];
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanGenres(value: RawEntry["genre"]): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const genres = raw
    .flatMap((item) => (typeof item === "string" ? item.split(/[\n,]/) : []))
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(genres)).slice(0, 4);
}

function cleanNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanEpisode(value: unknown): string | null {
  const text = cleanText(value);
  if (!text || text === "?" || text === "0") return null;
  return text;
}

function toEntry(raw: RawEntry, day: string, index: number, version: "vo" | "vf"): CalendarEntry {
  const hours = cleanNumber(raw.heures);
  const minutes = cleanNumber(raw.minutes);
  // 00:00 sert d'horaire « inconnu » dans la collection d'origine.
  const hasTime =
    hours !== null && hours >= 0 && hours < 24 && !(hours === 0 && (minutes ?? 0) === 0);
  const time = hasTime
    ? `${String(hours).padStart(2, "0")}:${String(minutes ?? 0).padStart(2, "0")}`
    : null;

  return {
    id: raw._id ? String(raw._id) : `${day}-${version}-${index}`,
    // Certaines fiches importées n'ont pas de titre : le synopsis ou le
    // lien servent de repli, jamais « Sans titre ».
    titre: cleanText(raw.titre) || cleanText(raw.synopsis).slice(0, 60) || "Anime à venir",
    affiche: typeof raw.affiche === "string" && raw.affiche.startsWith("http") ? raw.affiche : null,
    genres: cleanGenres(raw.genre),
    synopsis: cleanText(raw.synopsis),
    season: cleanText(raw.saison) || null,
    episode: cleanEpisode(raw.episode),
    episodeTitle: null,
    episodeStill: null,
    time,
    startMinutes: hasTime ? hours * 60 + (minutes ?? 0) : Number.MAX_SAFE_INTEGER,
  };
}

function toEntries(list: RawEntry[] | undefined, day: string, version: "vo" | "vf"): CalendarEntry[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry, index) => toEntry(entry, day, index, version))
    .sort(
      (a, b) => a.startMinutes - b.startMinutes || a.titre.localeCompare(b.titre, "fr"),
    );
}

/** Récupère le planning des 7 jours depuis MongoDB, dans l'ordre de la semaine. */
export async function getCalendar(): Promise<CalendarDay[]> {
  if (calendarCache && Date.now() - calendarCache.at < CALENDAR_CACHE_TTL) return calendarCache.days;
  if (calendarPromise) return calendarPromise;

  calendarPromise = (async () => {
  const db = await getDb();
  const docs = await db.collection<RawDay>(CALENDAR_COLLECTION).find({}).toArray();

  const byDay = new Map<string, RawDay>();
  for (const doc of docs) {
    const key = cleanText(doc.jour).toLowerCase();
    if (key) byDay.set(key, doc);
  }

  const days = CALENDAR_DAYS.map((day) => {
    const doc = byDay.get(day.toLowerCase());
    return {
      day,
      vo: toEntries(doc?.vo, day, "vo"),
      vf: toEntries(doc?.vf, day, "vf"),
    };
  });
    // Masquage : une entrée dont la fiche est déjà connue comme sans aucune
    // source n'est pas affichée. Purement local (cache mémoire).
    const ids = days.flatMap((day) => [...day.vo, ...day.vf].map((entry) => entry.id));
    const hidden = await hiddenIds(ids);
    const visible = hidden.size === 0
      ? days
      : days.map((day) => ({
        ...day,
        vo: day.vo.filter((entry) => !hidden.has(entry.id)),
        vf: day.vf.filter((entry) => !hidden.has(entry.id)),
      }));

    const enriched = await enrichCalendarEpisodes(visible);
    calendarCache = { at: Date.now(), days: enriched };
    return enriched;
  })();
  try {
    return await calendarPromise;
  } finally {
    calendarPromise = null;
  }
}

let calendarCache: { at: number; days: CalendarDay[] } | null = null;
let calendarPromise: Promise<CalendarDay[]> | null = null;

type TmdbEpisodeRecord = { name?: string; still_path?: string | null; episode_number?: number };
const tmdbSeasonCache = new Map<string, { expiresAt: number; promise: Promise<TmdbEpisodeRecord[]> }>();
const TMDB_IMAGE_ROOT = "https://image.tmdb.org/t/p/w500";

function episodeNumber(value: string | null): number | null {
  const match = value?.match(/\d+/);
  const parsed = match ? Number(match[0]) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function fetchTmdbSeason(tmdbId: number, seasonNumber: number): Promise<TmdbEpisodeRecord[]> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return [];
  const key = `${tmdbId}:${seasonNumber}`;
  const cached = tmdbSeasonCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?language=fr-FR&api_key=${encodeURIComponent(apiKey)}`, {
    next: { revalidate: 1800 },
    signal: AbortSignal.timeout(3500),
  }).then(async (response) => {
    if (!response.ok) return [];
    const data = await response.json() as { episodes?: TmdbEpisodeRecord[] };
    return Array.isArray(data.episodes) ? data.episodes : [];
  }).catch(() => []);
  tmdbSeasonCache.set(key, { expiresAt: Date.now() + 30 * 60_000, promise });
  return promise;
}

type TmdbSeasonSummary = { season_number?: number; episode_count?: number };

const tmdbTvCache = new Map<string, { expiresAt: number; promise: Promise<{ seasons: TmdbSeasonSummary[] }> }>();

async function fetchTmdbTv(tmdbId: number): Promise<{ seasons: TmdbSeasonSummary[] }> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return { seasons: [] };
  const key = String(tmdbId);
  const cached = tmdbTvCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?language=fr-FR&api_key=${encodeURIComponent(apiKey)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(3500),
  }).then(async (response) => {
    if (!response.ok) return { seasons: [] };
    const data = await response.json() as { seasons?: TmdbSeasonSummary[] };
    return { seasons: Array.isArray(data.seasons) ? data.seasons : [] };
  }).catch(() => ({ seasons: [] }));
  tmdbTvCache.set(key, { expiresAt: Date.now() + 30 * 60_000, promise });
  return promise;
}

/** Titre + image d'un épisode TMDB (saison explicite, sinon numérotation absolue). */
async function futureTmdbEpisode(tmdbId: number | null, number: number, seasonLabel: string | null): Promise<{ title: string | null; still: string | null }> {
  if (!tmdbId) return { title: null, still: null };
  const { seasons: rawSeasons } = await fetchTmdbTv(tmdbId);
  const seasons = rawSeasons
    .filter((season) => Number(season.season_number) > 0 && Number(season.episode_count) > 0)
    .slice()
    .sort((a, b) => Number(a.season_number) - Number(b.season_number));
  const explicitSeason = /^(?:saison\s*)?(\d+)$/i.exec(cleanText(seasonLabel));
  let target: { seasonNumber: number; episodeNumber: number } | null = null;
  if (explicitSeason) {
    const seasonNumber = Number(explicitSeason[1]);
    if (seasons.some((season) => Number(season.season_number) === seasonNumber && number <= Number(season.episode_count))) {
      target = { seasonNumber, episodeNumber: number };
    }
  }
  if (!target) {
    let firstAbsoluteEpisode = 1;
    for (const season of seasons) {
      const count = Number(season.episode_count);
      if (number >= firstAbsoluteEpisode && number < firstAbsoluteEpisode + count) {
        target = { seasonNumber: Number(season.season_number), episodeNumber: number - firstAbsoluteEpisode + 1 };
        break;
      }
      firstAbsoluteEpisode += count;
    }
  }
  if (!target) return { title: null, still: null };
  const episode = (await fetchTmdbSeason(tmdbId, target.seasonNumber))
    .find((item) => Number(item.episode_number) === target!.episodeNumber);
  return {
    title: cleanText(episode?.name) || null,
    still: typeof episode?.still_path === "string" && episode.still_path.startsWith("/")
      ? `${TMDB_IMAGE_ROOT}${episode.still_path}`
      : null,
  };
}

/**
 * La saison affichée est le **nom** de saison de la fiche (« Saison 1 »,
 * « Arc 3 »…), pour que le calendrier parle la même langue que le catalogue.
 * Une fiche sans saison garde le numéro de la source.
 */
async function seasonLabelsFor(days: CalendarDay[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(days.flatMap((day) => [...day.vo, ...day.vf]).map((entry) => entry.id))];
  const labels = new Map<string, string | null>();
  if (ids.length === 0) return labels;
  const collection = await catalogueCollection().catch(() => null);
  if (!collection) return labels;
  const rows = await collection
    .find({ id: { $in: ids } }, { projection: { id: 1, seasons: 1 } })
    .toArray()
    .catch(() => [] as Array<{ id?: string; seasons?: Array<{ number?: number; index?: number; titre?: string; name?: string }> }>);
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id) continue;
    const seasons = Array.isArray(row.seasons) ? row.seasons : [];
    const first = seasons[0];
    const label = String(first?.name ?? first?.titre ?? "").trim();
    labels.set(id, label || null);
  }
  return labels;
}

async function enrichCalendarEpisodes(days: CalendarDay[]): Promise<CalendarDay[]> {
  const entries = days.flatMap((day) => [...day.vo, ...day.vf]);
  if (entries.length === 0) return days;

  // Aucune collection `franime` : chaque entrée du planning est résolue sur TMDB
  // (recherche par titre, une seule fois par titre distinct) pour récupérer
  // l'identifiant `tv-<id>` et le titre/image de l'épisode.
  const uniqueTitles = [...new Set(entries.map((entry) => normalize(entry.titre)).filter(Boolean))].slice(0, 40);
  const resolved = new Map<string, AnimeSummary | null>();
  await Promise.all(uniqueTitles.map(async (title) => {
    resolved.set(title, await findAnimeByTitle(title));
  }));

  await Promise.all(entries.map(async (entry) => {
    const anime = resolved.get(normalize(entry.titre));
    const parsed = anime ? parseCatalogId(anime.id) : null;
    const number = episodeNumber(entry.episode);
    if (!anime || !parsed) return;
    entry.id = anime.id;
    entry.genres = entry.genres.length > 0 ? entry.genres : anime.genres.slice(0, 4);
    entry.synopsis = entry.synopsis || anime.synopsis;
    entry.affiche = entry.affiche ?? anime.affiche;
    if (!number) return;
    const ahead = await futureTmdbEpisode(parsed.mediaType === "tv" ? parsed.tmdbId : null, number, entry.season);
    // Le titre de l'épisode sert de libellé ; son image, non : le calendrier
    // montre l'affiche de la série.
    entry.episodeTitle = ahead.title;
    entry.episodeStill = null;
  }));

  // Nom de saison du catalogue (et non le numéro brut de la source).
  const labels = await seasonLabelsFor(days);
  for (const entry of entries) {
    const label = labels.get(entry.id);
    if (label) entry.season = label;
  }

  return days;
}

/** Semaine courante (lundi → dimanche) et index du jour actuel (0 = lundi). */
export function getWeekInfo(now: Date = new Date()): { todayIndex: number; week: WeekDay[] } {
  const jsDay = now.getDay(); // 0 = dimanche
  const todayIndex = (jsDay + 6) % 7;

  const monday = new Date(now);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - todayIndex);

  const week: WeekDay[] = CALENDAR_DAYS.map((day, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return {
      index,
      day,
      short: day.slice(0, 3),
      date: date.getDate(),
      month: date.toLocaleDateString("fr-FR", { month: "short" }).replace(".", ""),
      isToday: index === todayIndex,
    };
  });

  return { todayIndex, week };
}
