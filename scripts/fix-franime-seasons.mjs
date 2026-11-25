/**
 * Réécrit `seasons[]` d'une fiche à partir des données Franime :
 *
 *   - le numéro d'épisode affiché (1..N dans la saga) reste relatif ;
 *   - `absNumber` porte le numéro absolu des données d'épisode (One Piece :
 *     1156…), c'est lui que le lecteur doit demander ;
 *   - `franimeSeasonIndex` porte l'index (1-based) de la saga dans
 *     `api/animes`, le s0 attendu par `/api/anime/{id}/{s0}/…` ;
 *   - les lecteurs (VF/VO) sont rechargés, sinon la fiche affiche
 *     « Aucun lecteur disponible » à tort.
 *
 * La correspondance saga ↔ saison de la fiche se fait par la PLAGE de numéros
 * absolus (les numéros de saga de Franime et les numéros de saison TMDB ne
 * coïncident pas : One Piece va de 1 à 23 chez TMDB, de 1 à 12 chez Franime).
 *
 * Usage : node scripts/fix-franime-seasons.mjs [--id=tv-37854] [--dry]
 */

import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";

const FRANIME_API = "https://api.franime.fr/api/";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://franime.fr/",
  Origin: "https://franime.fr",
};

function loadEnv() {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const ONLY = args.find((a) => a.startsWith("--id="))?.slice(5) ?? null;

const bySagaNumber = (title) => {
  const match = /(\d+)\s*$/.exec(String(title ?? ""));
  return match ? Number(match[1]) : null;
};

const readers = (list) =>
  [...new Set((Array.isArray(list) ? list : []).map((name) => String(name).trim()).filter((n) => n && n !== "INDISPONIBLE"))];

async function franimeCatalogue() {
  const response = await fetch(`${FRANIME_API}animes`, { headers: HEADERS });
  if (!response.ok) throw new Error(`api/animes ${response.status}`);
  return response.json();
}

/** Plages absolues de chaque saga, telles que le lecteur les connaît. */
async function absoluteRanges(kitsuId) {
  if (!kitsuId) return new Map();
  try {
    const response = await fetch(`${FRANIME_API}anime-seasons/${kitsuId}`, { headers: HEADERS });
    if (!response.ok) return new Map();
    const data = await response.json();
    const map = new Map();
    for (const season of data.episodeDetails ?? []) {
      const numbers = (season.episodes ?? []).map((e) => Number(e.number)).filter(Number.isFinite);
      if (numbers.length) map.set(Number(season.seasonNumber), { start: numbers[0], count: numbers.length });
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Saison de la fiche → index de saga Franime.
 *
 * L'ordre des arguments compte : la numérotation absolue enregistrée (`absNumber`)
 * est celle des données d'épisode de `anime-seasons` (One Piece : saga 2 =
 * 62…143), pas un compteur continu. Elle ne sert donc que de repli.
 */
function resolveIndex(season, entries, ranges, position) {
  // Le titre Franime porte le numéro de saga, SAUF quand les sagas portent des
  // noms d'arc sans numéro (« East Blue Saga 1 » → oui, « Elbaf 12 » → oui).
  const byNumber = entries.filter((item) => bySagaNumber(item.raw.title) === Number(season.number));
  // Le nombre d'épisodes doit coller : deux sagas peuvent porter le même numéro.
  const exact = byNumber.filter((item) => (item.raw.episodes ?? []).length === (season.episodes ?? []).length);
  if (exact.length === 1) return exact[0].index;
  if (byNumber.length === 1) return byNumber[0].index;

  // Sinon : une plage absolue enregistrée qui couvre TOUS les épisodes de la
  // saison désigne la bonne saga.
  const first = Number(season.episodes?.[0]?.absNumber);
  const last = Number(season.episodes?.at(-1)?.absNumber);
  const covers = Number.isFinite(first) && Number.isFinite(last) && last - first + 1 === season.episodes.length;
  if (covers) {
    for (const [seasonNumber, range] of ranges) {
      const end = range.start + range.count - 1;
      if (first >= range.start && last <= end) {
        const entry = entries.find((item) => Number(item.raw.seasonNumber) === seasonNumber);
        if (entry) return entry.index;
      }
    }
  }

  // Dernier recours : la position dans la fiche est celle chez Franime.
  const ordered = [...entries].sort((a, b) => a.index - b.index);
  return ordered[Math.min(position, ordered.length - 1)]?.index ?? null;
}

/**
 * Réécrit une saga de la fiche.
 *
 * Le numéro ABSOLU de chaque épisode est lu dans le titre que publie le
 * catalogue (« Episode 1156 »). C'est la seule numérotation continue de
 * Franime : elle traverse les sagas, contrairement aux `absNumber` de
 * `anime-seasons` qui repartent à 1 à chaque saga (Water Seven 1..130 alors
 * que l'épisode 207 est le 207e de la série).
 */
function rewriteSeason(season, entry, range) {
  const rawEpisodes = entry?.raw?.episodes ?? [];
  if (!rawEpisodes.length) return season;
  const titles = rawEpisodes.map((episode) => String(episode?.title ?? ""));
  const parsed = titles.map((title) => Number(/episode\s*(\d+)/i.exec(title)?.[1] ?? NaN));
  const firstAbsolute = parsed.find((value) => Number.isFinite(value));
  // Repli : la plage absolue de la fiche, sinon un compteur depuis le début.
  const absStart = Number.isFinite(firstAbsolute) ? firstAbsolute : (range?.start ?? season.absStart ?? 1);
  const episodes = rawEpisodes.map((episode, position) => {
    const previous = season.episodes?.[position];
    const absolute = Number.isFinite(parsed[position]) ? parsed[position] : absStart + position;
    const ownTitle = titles[position];
    // « Episode 1156 » porte le numéro absolu : on le garde. Un titre générique
    // (« Épisode 1 ») ne dit rien, on préfère celui des données d'épisode.
    const title = /episode\s*\d{3,}/i.test(ownTitle)
      ? ownTitle
      : (previous?.title ?? (ownTitle || `Épisode ${position + 1}`));
    return {
      number: position + 1,
      absNumber: absolute,
      franimeSeasonIndex: entry.index,
      title,
      airDate: previous?.airDate ?? null,
      still: previous?.still ?? null,
      playersVf: readers(episode?.lang?.vf?.lecteurs),
      playersVo: readers(episode?.lang?.vo?.lecteurs),
    };
  });
  return { ...season, absStart, franimeSeasonIndex: entry.index, episodes };
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const collection = client.db(process.env.MONGODB_DB || "animevision").collection("catalogue");

const filter = { franimeId: { $ne: null } };
const projection = { id: 1, title: 1, franimeId: 1, kitsuUrl: 1, seasons: 1 };
const documents = ONLY
  ? [await collection.findOne({ id: ONLY }, { projection })].filter(Boolean)
  : await collection.find(filter, { projection }).toArray();
console.log(`${documents.length} fiche(s) à traiter.`);

const catalogue = await franimeCatalogue();
const byFranimeId = new Map(catalogue.map((entry) => [entry.id, entry]));

let touched = 0;
let episodes = 0;
const queue = [...documents];

async function worker() {
  for (;;) {
    const document = queue.shift();
    if (!document) return;
    const franime = byFranimeId.get(document.franimeId);
    if (!franime) continue;
    const kitsu = /\/anime\/(\d+)/.exec(String(document.kitsuUrl ?? franime.source_url ?? ""))?.[1];
    const ranges = await absoluteRanges(kitsu);

    const entries = (franime.saisons ?? []).map((raw, position) => ({ raw, index: position + 1 }));
    const ordered = [...(document.seasons ?? [])].sort((a, b) => Number(a.number) - Number(b.number));
    let changed = false;
    const seasons = ordered.map((season, position) => {
      const index = resolveIndex(season, entries, ranges, position);
      if (!index) return season;
      const entry = entries.find((item) => item.index === index);
      const range = ranges.get(Number(entry?.raw?.seasonNumber)) ?? null;
      const next = rewriteSeason(season, entry, range);
      if (JSON.stringify(next) === JSON.stringify(season)) return season;
      changed = true;
      episodes += next.episodes.length;
      return next;
    });

    if (changed) {
      touched += 1;
      if (!DRY) await collection.updateOne({ _id: document._id }, { $set: { seasons, episodesUpdatedAt: new Date() } });
    }
  }
}

await Promise.all(Array.from({ length: 6 }, worker));
console.log(`${DRY ? "[à blanc] " : ""}${touched} fiche(s) corrigée(s), ${episodes} épisode(s) réécrit(s).`);
await client.close();
