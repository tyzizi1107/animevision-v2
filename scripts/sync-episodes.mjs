/**
 * Réimport des saisons et épisodes **depuis l'API anime-seasons de Franime**,
 * puis alignement sur TMDB pour les titres, les dates et les images.
 *
 * Pourquoi ce script remplace `sync-catalogue.mjs` pour les épisodes :
 *
 *  - `GET /api/animes` donne les lecteurs mais numérote les épisodes de façon
 *    **relative** (chaque saga repart à 1) et ne fournit ni titre, ni date, ni
 *    image.
 *  - `GET /api/anime-seasons/{kitsuId}` donne la **numérotation absolue**
 *    (saison 2 = épisodes 62..143), les titres FR, les dates et les
 *    miniatures Kitsu. C'est cette numérotation que les endpoints lecteurs
 *    attendent : c'est elle qui rend `saison-1/1` et `saison-2/62` corrects.
 *
 * L'alignement TMDB se fait **épisode par épisode, par date de diffusion**
 * (jamais par numéro de saison : TMDB découpe One Piece en 23 saisons, Franime
 * en 12 sagas, les deux numérotations ne se correspondent pas).
 *
 * Usage :
 *   node scripts/sync-episodes.mjs              # tout le catalogue
 *   node scripts/sync-episodes.mjs --limit=20   # les 20 premiers
 *   node scripts/sync-episodes.mjs --id=tv-37854
 *   node scripts/sync-episodes.mjs --dry
 */

import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";

const FRANIME_API = "https://api.franime.fr/api/";
const FRANIME_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://franime.fr/",
  Origin: "https://franime.fr",
};
const TMDB_ROOT = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";

function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n")) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        const value = match[2].replace(/^["']|["']$/g, "");
        if (!process.env[match[1]]) process.env[match[1]] = value;
      }
    } catch {
      // fichier absent
    }
  }
}
loadEnvFiles();

const API_KEY = process.env.TMDB_API_KEY ?? "";
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "animevision";
if (!MONGODB_URI) throw new Error("MONGODB_URI absent de .env.local.");

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "1"];
  }),
);
const LIMIT = Number.parseInt(args.get("limit") ?? "0", 10);
const ONLY_ID = args.get("id") ?? null;
const DRY = args.has("dry");
/** Fiches traitées en parallèle (TMDB plafonne à ~40 req/s, on reste prudent). */
const CONCURRENCY = Math.max(1, Math.min(8, Number.parseInt(args.get("concurrency") ?? "4", 10) || 4));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextCallAt = 0;
async function tmdb(path, params = {}) {
  if (!API_KEY) return null;
  const wait = nextCallAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextCallAt = Date.now() + 60;
  const url = new URL(`${TMDB_ROOT}${path}`);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("language", "fr-FR");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function franimeSeasons(kitsuId) {
  try {
    const response = await fetch(`${FRANIME_API}anime-seasons/${kitsuId}`, {
      headers: FRANIME_HEADERS,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

/** Miniatures Franime : Kitsu sert du « original », on garde l'URL telle quelle. */
function stillOf(url) {
  const value = String(url ?? "").trim();
  return value.startsWith("http") ? value : null;
}

/**
 * Découpage Franime → saisons stockées.
 * Numérotation ABSOLUE conservée : l'épisode garde son numéro de saga, qui est
 * celui attendu par les endpoints lecteurs.
 */
function extractSeasons(payload) {
  const details = Array.isArray(payload?.episodeDetails) ? payload.episodeDetails : [];
  const seasons = [];
  for (const raw of details) {
    const number = Number(raw?.seasonNumber);
    // Saisons 0 et éditions hors-série (0.5 = live action) écartées, et
    // plafond à 100 : Franime range parfois une saison « 2023 ».
    if (!Number.isFinite(number) || number <= 0 || number > 100) continue;
    if (!Number.isInteger(number)) continue;
    const seen = new Map();
    for (const episode of raw.episodes ?? []) {
      const episodeNumber = Number(episode?.number);
      if (!Number.isInteger(episodeNumber) || episodeNumber <= 0) continue;
      const airDate = typeof episode.airDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(episode.airDate)
        ? episode.airDate
        : null;
      const entry = {
        number: episodeNumber,
        title: typeof episode.title === "string" ? episode.title.trim() : "",
        airDate,
        still: stillOf(episode.thumbnail),
      };
      // Un même épisode peut apparaître dans deux sagas (746 est dans la 8 et
      // la 9 chez Franime) : on garde celui qui porte une date de diffusion.
      const previous = seen.get(episodeNumber);
      if (!previous || (!previous.airDate && entry.airDate)) seen.set(episodeNumber, entry);
    }
    const episodes = [...seen.values()].sort((a, b) => a.number - b.number);
    if (episodes.length === 0) continue;
    seasons.push({ number, name: `Saison ${number}`, episodes });
  }
  return seasons.sort((a, b) => a.number - b.number);
}

/** Toutes les saisons TMDB d'une série : indexées par date de diffusion. */
async function tmdbEpisodesByDate(tmdbId) {
  const detail = await tmdb(`/tv/${tmdbId}`);
  const seasons = (detail?.seasons ?? [])
    .filter((season) => Number(season.season_number) > 0 && Number(season.episode_count) > 0)
    .sort((a, b) => Number(a.season_number) - Number(b.season_number));
  const byDate = new Map();
  const byAbsolute = new Map();
  let absolute = 0;
  for (const season of seasons) {
    const data = await tmdb(`/tv/${tmdbId}/season/${Number(season.season_number)}`);
    for (const episode of data?.episodes ?? []) {
      absolute += 1;
      const record = {
        seasonNumber: Number(season.season_number),
        episodeNumber: Number(episode.episode_number),
        absolute,
        name: typeof episode.name === "string" ? episode.name.trim() : "",
        airDate: typeof episode.air_date === "string" ? episode.air_date : null,
        still: episode.still_path ? `${TMDB_IMG}/w300${episode.still_path}` : null,
        overview: typeof episode.overview === "string" ? episode.overview : "",
      };
      if (record.airDate) byDate.set(record.airDate, record);
      byAbsolute.set(absolute, record);
    }
  }
  return { byDate, byAbsolute };
}

// --- exécution -----------------------------------------------------------
const client = new MongoClient(MONGODB_URI);
await client.connect();
const collection = client.db(DB_NAME).collection("catalogue");

/**
 * Fraîcheur côté Franime : `updatedDate` / `updatedDateVF` du catalogue
 * `api/animes` disent QUAND un animé a reçu du nouveau contenu, ce que
 * `anime-seasons` ne fournit pas. C'est cette date qui alimente les
 * « derniers épisodes sortis ».
 */
async function franimeFreshness() {
  try {
    const response = await fetch(`${FRANIME_API}animes`, {
      headers: FRANIME_HEADERS,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) return new Map();
    const list = await response.json();
    const map = new Map();
    for (const entry of list) {
      const id = Number(entry?.id);
      if (!Number.isFinite(id)) continue;
      const vo = Number(entry.updatedDate) || null;
      const vf = Number(entry.updatedDateVF) || null;
      // Saison et épisode du dernier contenu annoncé (numérotation Franime).
      const lastSeason = Array.isArray(entry.saisons) ? entry.saisons[entry.saisons.length - 1] : null;
      const lastEpisode = Array.isArray(lastSeason?.episodes) ? lastSeason.episodes[lastSeason.episodes.length - 1] : null;
      map.set(id, {
        vo,
        vf,
        latestSeason: Number(/(\d+)/.exec(String(lastSeason?.title ?? ""))?.[1] ?? 0) || null,
        latestEpisode: Array.isArray(lastSeason?.episodes) ? lastSeason.episodes.length : null,
        latestTitle: typeof lastEpisode?.title === "string" ? lastEpisode.title : null,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

console.log("Lecture de la fraîcheur Franime…");
const freshness = await franimeFreshness();
console.log(`  ${freshness.size} animés datés.`);

const filter = ONLY_ID ? { id: ONLY_ID } : { franimeId: { $type: "number" } };
const documents = await collection
  .find(filter, { projection: { id: 1, tmdbId: 1, franimeId: 1, title: 1 } })
  .sort({ popularite: -1 })
  .toArray();
const targets = LIMIT > 0 ? documents.slice(0, LIMIT) : documents;
console.log(`${targets.length} fiches à traiter (${documents.length} en base).`);

let done = 0;
let enriched = 0;
let episodesTotal = 0;
let matchedByDate = 0;
let matchedByAbsolute = 0;
const startedAt = Date.now();

let processed = 0;
async function processOne(document) {
  const payload = await franimeSeasons(document.franimeId);
  if (!payload) return;
  const seasons = extractSeasons(payload);
  if (seasons.length === 0) return;
  const freshnessEntry = freshness.get(Number(document.franimeId)) ?? null;

  // Alignement TMDB : date d'abord (fiable), numéro absolu en secours.
  const tmdbIndex = document.tmdbId ? await tmdbEpisodesByDate(document.tmdbId) : { byDate: new Map(), byAbsolute: new Map() };
  let absolute = 0;
  let localEpisodes = 0;
  for (const season of seasons) {
    for (const episode of season.episodes) {
      absolute += 1;
      localEpisodes += 1;
      const match = (episode.airDate ? tmdbIndex.byDate.get(episode.airDate) : null)
        ?? tmdbIndex.byAbsolute.get(absolute)
        ?? null;
      if (match) {
        if (episode.airDate && tmdbIndex.byDate.get(episode.airDate)) matchedByDate += 1;
        else matchedByAbsolute += 1;
      }
      episode.tmdbSeason = match?.seasonNumber ?? null;
      episode.tmdbEpisode = match?.episodeNumber ?? null;
      if (!episode.title && match?.name) episode.title = match.name;
      if (!episode.airDate && match?.airDate) episode.airDate = match.airDate;
      if (!episode.still && match?.still) episode.still = match.still;
      if (match?.overview) episode.overview = match.overview;
    }
  }
  episodesTotal += localEpisodes;

  if (!DRY) {
    await collection.updateOne(
      { _id: document._id },
      {
        $set: {
          seasons,
          seasonsCount: seasons.length,
          episodesUpdatedAt: new Date(),
          ...(freshnessEntry
            ? {
                franimeUpdatedAt: freshnessEntry.vo ? new Date(freshnessEntry.vo) : null,
                franimeUpdatedAtVf: freshnessEntry.vf ? new Date(freshnessEntry.vf) : null,
                latestSeason: freshnessEntry.latestSeason,
                latestEpisode: freshnessEntry.latestEpisode,
                latestEpisodeTitle: freshnessEntry.latestTitle,
              }
            : {}),
        },
      },
    );
  }
  done += 1;
  if (tmdbIndex.byDate.size > 0) enriched += 1;
}

// Plusieurs fiches en parallèle : l'attente est du réseau (TMDB), pas du CPU.
const queue = [...targets];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length > 0) {
    const document = queue.shift();
    if (!document) break;
    try {
      await processOne(document);
    } catch (error) {
      console.warn(`  ${document.id} : ${error instanceof Error ? error.message : String(error)}`);
    }
    processed += 1;
    if (processed % 50 === 0) {
      const rate = (Date.now() - startedAt) / processed;
      console.log(
        `  ${processed}/${targets.length} — ${episodesTotal} épisodes, ${enriched} alignés TMDB, reste ~${Math.round((rate * (targets.length - processed)) / 1000)} s`,
      );
    }
  }
}));

console.log(
  `Terminé : ${done} fiches réécrites, ${episodesTotal} épisodes, ${enriched} fiches alignées TMDB `
  + `(${matchedByDate} par date, ${matchedByAbsolute} par numéro)${DRY ? " (dry run)" : ""}.`,
);
await client.close();
