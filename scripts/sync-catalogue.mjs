/**
 * Import complet du catalogue **depuis Franime**, enrichi par TMDB.
 *
 *  1. `GET https://api.franime.fr/api/animes` → 2 554 animés, avec leur
 *     **découpage réel en saisons et épisodes**, et pour chaque épisode la
 *     **liste des lecteurs disponibles** en VF et en VO.
 *  2. Ce découpage est ce qui sert à la lecture : Franime fait foi pour savoir
 *     combien de saisons et d'épisodes existent.
 *  3. TMDB n'habille que les fiches : synopsis FR, genres, visuels, note,
 *     année, casting. Rapprochement par titre + année (score ≥ 55).
 *  4. Résultat dans la collection `catalogue`, `id` = `tv-<tmdbId>` quand
 *     TMDB reconnaît l'animé, sinon `franime-<id franime>`.
 *
 * Reprise à la demande :
 *   node scripts/sync-catalogue.mjs                 # tout (≈ 15 min)
 *   node scripts/sync-catalogue.mjs --limit=200     # les 200 premiers
 *   node scripts/sync-catalogue.mjs --refresh-episodes=500  # rafraîchit les 500 fiches les plus anciennes
 *   node scripts/sync-catalogue.mjs --dry           # n'écrit rien
 */

import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";

const FRANIME_API = "https://api.franime.fr/api/animes";
const FRANIME_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://franime.fr/",
  Origin: "https://franime.fr",
};
const TMDB_ROOT = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";

// --- configuration -------------------------------------------------------
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
// TMDB est optionnel : sans clé, le catalogue est importé sans habillage.
const API_KEY = process.env.TMDB_API_KEY ?? "";
if (!MONGODB_URI) throw new Error("MONGODB_URI absent de .env.local.");

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "1"];
  }),
);
const LIMIT = Number.parseInt(args.get("limit") ?? "0", 10);
const REFRESH_EPISODES = Number.parseInt(args.get("refresh-episodes") ?? "0", 10);
const DRY = args.has("dry");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextCallAt = 0;
async function tmdb(path, params = {}) {
  if (!API_KEY) return null;
  const wait = nextCallAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextCallAt = Date.now() + 50;
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

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Saison 2" → 2 ; "Saison 1 (OAV)" → 1 ; "Film" → 1. */
function seasonNumberFromTitle(title, index) {
  const match = /saison\s*(\d{1,4})/i.exec(String(title ?? ""));
  if (match) return Number(match[1]);
  const digits = /^(\d{1,4})$/.exec(String(title ?? "").trim());
  if (digits) return Number(digits[1]);
  return index + 1;
}

function slugForSeason(number, title) {
  const clean = String(title ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || `saison-${number}`;
}

/**
 * Découpage Franime → saisons et épisodes stockés.
 * Chaque épisode garde les lecteurs réellement proposés, en VF et en VO.
 */
function extractSeasons(entry) {
  const rawSeasons = Array.isArray(entry.saisons) ? entry.saisons : [];
  const seasons = [];
  for (const [index, rawSeason] of rawSeasons.entries()) {
    const episodesRaw = Array.isArray(rawSeason?.episodes) ? rawSeason.episodes : [];
    const number = seasonNumberFromTitle(rawSeason?.title, index);
    const episodes = [];
    for (const [position, rawEpisode] of episodesRaw.entries()) {
      const lang = rawEpisode?.lang ?? {};
      const players = (key) => {
        const list = lang?.[key]?.lecteurs;
        if (!Array.isArray(list)) return [];
        return [...new Set(list.map((name) => String(name).trim()).filter((name) => name && name !== "INDISPONIBLE"))];
      };
      const vf = players("vf");
      const vo = players("vo");
      // Un épisode sans aucun lecteur n'a rien à jouer : il n'est pas stocké.
      if (vf.length === 0 && vo.length === 0) continue;
      episodes.push({
        number: position + 1,
        title: String(rawEpisode?.title ?? `Épisode ${position + 1}`).slice(0, 200),
        playersVf: vf,
        playersVo: vo,
      });
    }
    if (episodes.length === 0) continue;
    seasons.push({
      number,
      name: String(rawSeason?.title ?? `Saison ${number}`).slice(0, 120),
      slug: slugForSeason(number, rawSeason?.title),
      episodes,
    });
  }
  // Saisons 0 (spéciaux) masquées, comme sur la fiche.
  return seasons.filter((season) => season.number > 0).sort((a, b) => a.number - b.number);
}

// --- rapprochement TMDB --------------------------------------------------
function scoreResult(result, entry) {
  const candidates = [entry.title, entry.titleO, ...Object.values(entry.titles ?? {})]
    .filter(Boolean)
    .map(normalize);
  const name = normalize(result.name ?? result.title ?? "");
  if (!name) return 0;
  let score = candidates.includes(name)
    ? 100
    : candidates.some((c) => c && (name.startsWith(`${c} `) || c.startsWith(`${name} `)))
      ? 70
      : candidates.some((c) => c && name.includes(c))
        ? 55
        : 0;
  if (score === 0) return 0;
  const franimeYear = Number.parseInt(String(entry.startDate ?? "").slice(0, 4), 10);
  const tmdbYear = Number.parseInt(String(result.first_air_date ?? result.release_date ?? "").slice(0, 4), 10);
  if (franimeYear && tmdbYear) {
    const gap = Math.abs(franimeYear - tmdbYear);
    if (gap === 0) score += 25;
    else if (gap <= 1) score += 10;
    else if (gap > 5) score -= 30;
  }
  return score;
}

async function searchTmdb(entry) {
  if (!API_KEY) return null;
  const query = entry.titleO || entry.title;
  if (!query) return null;
  const data = await tmdb("/search/tv", { query, include_adult: "false" });
  const results = data?.results ?? [];
  if (results.length === 0) return null;
  const best = results
    .map((result) => ({ result, score: scoreResult(result, entry) }))
    .sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 55) return null;
  return best.result;
}

async function decorate(entry, match) {
  const detail = match ? await tmdb(`/tv/${match.id}`) : null;
  const credits = match ? await tmdb(`/tv/${match.id}/credits`) : null;
  return {
    synopsis: entry.description || detail?.overview || "",
    genres: (detail?.genres ?? []).map((genre) => genre.name),
    tmdbRating: detail?.vote_average ?? null,
    popularite: detail?.popularity ?? 0,
    tmdbSeasonsCount: Array.isArray(detail?.seasons)
      ? detail.seasons.filter((season) => Number(season.season_number) > 0).length
      : null,
    affiche: detail?.poster_path
      ? `${TMDB_IMG}/w500${detail.poster_path}`
      : (entry.affiche_small ?? entry.affiche ?? null),
    banniere: detail?.backdrop_path
      ? `${TMDB_IMG}/original${detail.backdrop_path}`
      : (entry.banner ?? null),
    cast: (credits?.cast ?? []).slice(0, 8).map((actor) => ({
      id: actor.id,
      name: actor.name,
      role: actor.character ?? null,
      photo: actor.profile_path ? `${TMDB_IMG}/w185${actor.profile_path}` : null,
    })),
  };
}

// --- exécution -----------------------------------------------------------
console.log("Lecture du catalogue Franime (avec saisons et lecteurs)…");
const franimeResponse = await fetch(FRANIME_API, { headers: FRANIME_HEADERS, signal: AbortSignal.timeout(120_000) });
if (!franimeResponse.ok) throw new Error(`Franime a répondu ${franimeResponse.status}.`);
const franime = await franimeResponse.json();
console.log(`  ${franime.length} animés reçus.`);

const client = new MongoClient(MONGODB_URI);
await client.connect();
const collection = client.db(DB_NAME).collection("catalogue");
await collection.createIndex({ id: 1 }, { unique: true });
await collection.createIndex({ tmdbId: 1 });
await collection.createIndex({ franimeId: 1 });
await collection.createIndex({ updatedAt: -1 });
await collection.createIndex({ "seasons.episodes.number": 1 });

// Mode « rafraîchir les épisodes » : on ne réenrichit pas TMDB, on remet à
// jour le découpage et les lecteurs des fiches déjà en base.
const existing = new Set(
  REFRESH_EPISODES > 0
    ? (await collection.find({}, { projection: { franimeId: 1 } }).sort({ updatedAt: 1 }).limit(REFRESH_EPISODES).toArray()).map((doc) => doc.franimeId)
    : [],
);

const entries = LIMIT > 0 ? franime.slice(0, LIMIT) : franime;
let written = 0;
let unmatched = 0;
let episodesTotal = 0;
let skipped = 0;
const startedAt = Date.now();

for (const [index, entry] of entries.entries()) {
  if (REFRESH_EPISODES > 0 && !existing.has(entry.id)) continue;

  const seasons = extractSeasons(entry);
  episodesTotal += seasons.reduce((sum, season) => sum + season.episodes.length, 0);
  if (seasons.length === 0) skipped += 1;

  const match = REFRESH_EPISODES > 0 ? null : await searchTmdb(entry);
  const base = {
    franimeId: entry.id,
    kitsuUrl: entry.source_url ?? null,
    title: entry.title ?? entry.titleO ?? null,
    originalTitle: entry.titleO ?? null,
    titles: entry.titles ?? {},
    themes: entry.themes ?? [],
    year: Number.parseInt(String(entry.startDate ?? "").slice(0, 4), 10) || null,
    startDate: entry.startDate ?? null,
    endDate: entry.endDate ?? null,
    status: entry.status ?? null,
    format: entry.format ?? null,
    nsfw: Boolean(entry.nsfw),
    rating: entry.note === undefined ? null : String(entry.note),
    afficheSmall: entry.affiche_small ?? entry.affiche ?? null,
    /** Découpage Franime : source de vérité pour la lecture. */
    seasons,
    seasonsCount: seasons.length,
    sources: ["franime"],
    episodesUpdatedAt: new Date(),
  };

  if (REFRESH_EPISODES > 0) {
    if (!DRY) await collection.updateOne({ franimeId: entry.id }, { $set: base });
    written += 1;
  } else if (!match) {
    unmatched += 1;
    if (!DRY) {
      await collection.updateOne(
        { franimeId: entry.id },
        {
          $set: {
            ...base,
            id: `franime-${entry.id}`,
            synopsis: entry.description ?? "",
            affiche: entry.affiche_small ?? entry.affiche ?? null,
            banniere: entry.banner ?? null,
            tmdbMatch: false,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }
  } else {
    const decor = await decorate(entry, match);
    const document = { ...base, ...decor, id: `tv-${match.id}`, tmdbId: match.id, tmdbMatch: true, updatedAt: new Date() };
    if (!DRY) await collection.updateOne({ id: document.id }, { $set: document }, { upsert: true });
    written += 1;
  }

  if ((index + 1) % 100 === 0) {
    const rate = (Date.now() - startedAt) / (index + 1);
    const remaining = Math.round((rate * (entries.length - index - 1)) / 1000);
    console.log(
      `  ${index + 1}/${entries.length} — enrichis ${written}, sans TMDB ${unmatched}, sans épisodes ${skipped}, reste ~${remaining} s`,
    );
  }
}

console.log(
  `Terminé : ${written} enrichis TMDB, ${unmatched} sans TMDB, ${skipped} sans épisode, ${episodesTotal} épisodes indexés${DRY ? " (dry run)" : ""}.`,
);
await client.close();
