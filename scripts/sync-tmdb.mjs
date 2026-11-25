/**
 * Import du catalogue **depuis TMDB seul**, puis écriture dans MongoDB.
 *
 * Le site ne dépend plus de Franime ni d'Anime-Sama pour savoir ce qui existe :
 * TMDB fournit la liste, les fiches, **et le découpage saisons / épisodes**.
 *
 *   1. `discover/movie` + `discover/tv` triés par popularité (toutes langues,
 *      tous pays) : on récupère les N fiches les plus connues.
 *   2. Pour chaque fiche, `append_to_response=alternative_titles,external_ids`
 *      (et `season/<n>` pour chaque saison d'une série).
 *   3. Écriture dans `catalogue` avec `id` = `movie-<tmdbId>` / `tv-<tmdbId>`,
 *      `tmdbMatch: true`, et `seasons[]` = saisons + épisodes TMDB.
 *
 * Utilisation :
 *   node scripts/sync-tmdb.mjs                 # 1 000 fiches (500 films + 500 séries)
 *   node scripts/sync-tmdb.mjs --limit=5000    # plus large
 *   node scripts/sync-tmdb.mjs --pages=50      # 50 pages de 20 par type
 *   node scripts/sync-tmdb.mjs --dry           # n'écrit rien
 *   node scripts/sync-tmdb.mjs --reset         # supprime d'abord les fiches non-TMDB
 */

import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";

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

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "animevision";
const API_KEY = process.env.TMDB_API_KEY;
if (!MONGODB_URI) throw new Error("MONGODB_URI absent de .env.local.");
if (!API_KEY) throw new Error("TMDB_API_KEY absent de .env.local.");

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "1"];
  }),
);
const LIMIT = Number.parseInt(args.get("limit") ?? "1000", 10);
const PAGES = Number.parseInt(args.get("pages") ?? String(Math.ceil(LIMIT / 2 / 20)), 10);
const DRY = args.has("dry");
const RESET = args.has("reset");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** TMDB autorise ~50 req/s ; on reste sous la limite et on réessaie une fois. */
let nextCallAt = 0;
async function tmdb(path, params = {}) {
  const wait = nextCallAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextCallAt = Date.now() + 60;
  const url = new URL(`${TMDB_ROOT}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("language", "fr-FR");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (response.status === 429) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!response.ok) return null;
      return await response.json();
    } catch {
      await sleep(800);
    }
  }
  return null;
}

const img = (path, size = "w500") => (path ? `${TMDB_IMG}/${size}${path}` : "");

function normalizeTitle(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Fiche `catalogue` à partir d'un détail TMDB (film ou série). */
async function buildDocument(detail, mediaType) {
  const isMovie = mediaType === "movie";
  const tmdbId = Number(detail.id);
  const title = detail.title ?? detail.name ?? detail.original_title ?? detail.original_name ?? "Sans titre";
  const originalTitle = detail.original_title ?? detail.original_name ?? title;
  const date = detail.release_date ?? detail.first_air_date ?? "";

  const aliases = new Set();
  for (const entry of detail.alternative_titles?.titles ?? detail.alternative_titles?.results ?? []) {
    const value = entry.title ?? entry.name;
    if (value && normalizeTitle(value) !== normalizeTitle(title)) aliases.add(value);
  }

  const genres = (detail.genres ?? []).map((genre) => genre.name).filter(Boolean);
  const runtimes = [detail.runtime, ...(detail.episode_run_time ?? [])].filter((value) => Number(value) > 0);

  // Saisons + épisodes : TMDB est la seule source de ce découpage.
  const seasons = [];
  if (!isMovie) {
    const list = (detail.seasons ?? []).filter((season) => Number(season.season_number) > 0 && Number(season.episode_count) > 0);
    for (const season of list) {
      const number = Number(season.season_number);
      const full = await tmdb(`/tv/${tmdbId}/season/${number}`);
      const episodes = (full?.episodes ?? []).map((episode) => ({
        number: Number(episode.episode_number),
        title: episode.name ?? "",
        overview: episode.overview ?? "",
        airDate: episode.air_date ?? "",
        still: img(episode.still_path, "w300"),
        runtime: Number(episode.runtime) || 0,
        rating: Number(episode.vote_average) || 0,
      }));
      seasons.push({
        name: season.name ?? `Saison ${number}`,
        slug: `saison-${number}`,
        number,
        overview: season.overview ?? "",
        affiche: img(season.poster_path, "w342"),
        airDate: season.air_date ?? "",
        episodes: episodes.length > 0 ? episodes : undefined,
        episodeCount: episodes.length || Number(season.episode_count) || 0,
      });
    }
  }

  return {
    id: `${mediaType}-${tmdbId}`,
    tmdbId,
    tmdbMatch: true,
    mediaType,
    format: isMovie ? "film" : "serie",
    title,
    originalTitle,
    titles: {
      fr: title,
      en: detail.original_language === "en" ? originalTitle : undefined,
      ja_jp: detail.original_language === "ja" ? originalTitle : undefined,
    },
    overview: detail.overview ?? "",
    affiche: img(detail.poster_path, "w500"),
    afficheSmall: img(detail.poster_path, "w342"),
    banniere: img(detail.backdrop_path, "w1280"),
    genres,
    rating: detail.vote_average ? String(detail.vote_average.toFixed(1)) : "",
    tmdbRating: Number(detail.vote_average) || 0,
    voteCount: Number(detail.vote_count) || 0,
    year: date ? String(date).slice(0, 4) : "",
    date,
    runtime: runtimes[0] ?? 0,
    originCountry: detail.origin_country ?? [],
    originalLanguage: detail.original_language ?? "",
    status: detail.status ?? "",
    aliases: [...aliases].slice(0, 10),
    seasons: isMovie ? [] : seasons,
    updatedAt: new Date(),
  };
}

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db(DB_NAME);
  const collection = db.collection("catalogue");

  if (RESET && !DRY) {
    const removed = await collection.deleteMany({ tmdbMatch: { $ne: true } });
    console.log(`Fiches non-TMDB supprimées : ${removed.deletedCount}`);
  }

  // 1. Liste : les fiches les plus populaires de TMDB, tous types confondus.
  const wanted = [];
  for (let page = 1; page <= PAGES; page += 1) {
    const [movies, shows] = await Promise.all([
      tmdb("/discover/movie", { sort_by: "popularity.desc", page }),
      tmdb("/discover/tv", { sort_by: "popularity.desc", page }),
    ]);
    for (const item of movies?.results ?? []) wanted.push({ id: item.id, mediaType: "movie" });
    for (const item of shows?.results ?? []) wanted.push({ id: item.id, mediaType: "tv" });
    process.stdout.write(`\rliste : page ${page}/${PAGES} — ${wanted.length} fiches`);
    if (!movies?.results?.length && !shows?.results?.length) break;
  }
  console.log("");

  const unique = new Map(wanted.map((entry) => [`${entry.mediaType}-${entry.id}`, entry]));
  const targets = [...unique.values()].slice(0, LIMIT);
  console.log(`Fiches à importer : ${targets.length}`);

  let done = 0;
  let written = 0;
  for (const target of targets) {
    done += 1;
    const detail = await tmdb(`/${target.mediaType}/${target.id}`, {
      append_to_response: "alternative_titles,external_ids",
    });
    if (!detail?.id) continue;
    const document = await buildDocument(detail, target.mediaType);
    if (!DRY) {
      // `replaceOne` : le document est ENTIÈREMENT celui de TMDB, aucun champ
      // d'un ancien import (Franime, Anime-Sama) ne survit.
      await collection.replaceOne({ id: document.id }, document, { upsert: true });
      written += 1;
    }
    if (done % 20 === 0 || done === targets.length) {
      process.stdout.write(`\rimport : ${done}/${targets.length} — ${written} écrites`);
    }
  }
  console.log("");

  // 2. Numérotation publique (`/anime/12`) : `numero` est unique, donc on
  // retire l'ancien numéro de TOUTES les fiches avant d'en réattribuer un.
  if (!DRY) {
    await collection.updateMany({ numero: { $exists: true } }, { $unset: { numero: "" } });
    const documents = await collection.find({}, { projection: { id: 1 } }).toArray();
    documents.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let numero = 0;
    const operations = documents.map((document) => {
      numero += 1;
      return { updateOne: { filter: { _id: document._id }, update: { $set: { numero } } } };
    });
    for (let index = 0; index < operations.length; index += 500) {
      await collection.bulkWrite(operations.slice(index, index + 500), { ordered: false });
    }
    console.log(`Numéros attribués : ${numero}`);
  }

  const total = await collection.countDocuments({});
  console.log(`Total dans la collection « catalogue » : ${total}`);
  await client.close();
}

await main();
