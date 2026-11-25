import { MongoClient } from "mongodb";
import { readFile } from "node:fs/promises";

const API_URL = "https://api.franime.fr/api/animes";
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "animevision";

if (!MONGODB_URI) throw new Error("MONGODB_URI absent de .env.local.");

function episodeNumber(episode, fallback) {
  const label = String(episode?.title || episode?.name || "");
  const namedNumber = label.match(/(?:épisode|episode|ep)\s*#?\s*(\d+)/i);
  if (namedNumber) return Number(namedNumber[1]);
  const explicit = Number(episode?.number);
  return Number.isSafeInteger(explicit) && explicit > 0 ? explicit : fallback;
}

function isLiveAction(season) {
  return /\blive[\s-]*action\b/i.test(String(season?.title ?? ""));
}

function seasonOrder(season, index) {
  const title = String(season?.title ?? "");
  if (/\bsaison\s+\d+/i.test(title)) return Number(title.match(/\bsaison\s+(\d+)/i)?.[1]);
  const trailingNumber = title.match(/(\d+(?:[.,]\d+)?)\s*$/)?.[1];
  return trailingNumber ? Number(trailingNumber.replace(",", ".")) : 10_000 + index;
}

function episodeKeys(seasons = []) {
  return new Set(seasons.flatMap((season) => (season.episodes ?? []).map((episode, index) => {
    const number = episodeNumber(episode, index + 1);
    return `${String(season.title ?? "").trim().toLocaleLowerCase("fr-FR")}::${number}`;
  })));
}

function hasNewEpisodes(previous, next) {
  if (!previous) return next.franimeSeasons.some((season) => season.episodes.length > 0);
  const oldSeasons = previous.franimeSeasons ?? previous.seasons ?? [];
  const oldEpisodes = episodeKeys(oldSeasons);
  const nextEpisodes = episodeKeys(next.franimeSeasons);
  if ([...nextEpisodes].some((key) => !oldEpisodes.has(key))) return true;
  return Number(previous.franimeUpdatedDate ?? 0) !== next.franimeUpdatedDate
    || Number(previous.franimeUpdatedDateVF ?? 0) !== next.franimeUpdatedDateVF;
}

function metadataOnly(anime, syncedAt, cataloguePosition) {
  const sourceSeasons = (anime.saisons ?? [])
    .map((season, index) => ({ season, index }))
    .filter(({ season }) => !isLiveAction(season))
    .sort((a, b) => seasonOrder(a.season, a.index) - seasonOrder(b.season, b.index) || a.index - b.index)
    .map(({ season }) => season);
  const seasons = sourceSeasons.map((season, seasonIndex) => ({
    index: seasonIndex,
    titre: season.title || `Saison ${seasonIndex + 1}`,
    episodes: (season.episodes ?? []).map((episode, index) => {
      const langs = episode?.lang ?? {};
      const availableLanguages = [];
      if (langs.vf?.lecteurs) availableLanguages.push("VF");
      if (langs.vo?.lecteurs) availableLanguages.push("VOSTFR");
      return {
        number: episodeNumber(episode, index + 1),
        titre: episode?.title || episode?.name || null,
        availableLanguages,
      };
    }),
  }));

  const latestSourceEpisode = (language, updatedAt) => {
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
    for (let seasonIndex = sourceSeasons.length - 1; seasonIndex >= 0; seasonIndex -= 1) {
      const season = sourceSeasons[seasonIndex];
      const episodes = season?.episodes ?? [];
      for (let episodeIndex = episodes.length - 1; episodeIndex >= 0; episodeIndex -= 1) {
        const episode = episodes[episodeIndex];
        const readers = episode?.lang?.[language]?.lecteurs;
        if (!readers || (Array.isArray(readers) && readers.length === 0)) continue;
        return {
          season: season.title || `Saison ${seasonIndex + 1}`,
          number: episodeNumber(episode, episodeIndex + 1),
          titre: null,
          language,
          updatedAt,
        };
      }
    }
    return null;
  };
  const latestEpisodes = [
    latestSourceEpisode("vo", Number(anime.updatedDate)),
    latestSourceEpisode("vf", Number(anime.updatedDateVF)),
  ].filter(Boolean);

  return {
    animeId: anime.id,
    // Keep FrAnime's data in a dedicated namespace. TMDB remains the source
    // shown by the app; FrAnime contributes episode existence and availability.
    franimeTitle: anime.title ?? null,
    franimeTitleOriginal: anime.titleO ?? null,
    franimeTitles: anime.titles ?? {},
    franimeSeasons: seasons,
    franimeOrder: cataloguePosition,
    franimeUpdatedDate: Number(anime.updatedDate) || 0,
    franimeUpdatedDateVF: Number(anime.updatedDateVF) || 0,
    franimeLatestEpisodes: latestEpisodes,
    source: "franime",
    syncedAt,
  };
}

const catalogueFile = process.argv.find((arg) => arg.startsWith("--catalogue-file="))?.slice("--catalogue-file=".length);
let catalogue;
if (catalogueFile) {
  catalogue = JSON.parse(await readFile(catalogueFile, "utf8"));
} else {
  const response = await fetch(API_URL, {
    headers: { Accept: "application/json", "User-Agent": "AnimeVision catalogue sync/1.0" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`FrAnime HTTP ${response.status}.`);
  catalogue = await response.json();
}
if (!Array.isArray(catalogue) || catalogue.length === 0) {
  throw new Error("Le catalogue FrAnime est vide ou a un format inattendu ; aucune donnée n’a été modifiée.");
}

const syncedAt = new Date();
const documents = catalogue
  .map((anime, index) => ({ anime, index }))
  .filter(({ anime }) => anime && anime.id !== undefined && anime.id !== null)
  .map(({ anime, index }) => metadataOnly(anime, syncedAt, index));
if (!documents.length) throw new Error("Aucune fiche FrAnime valide n’a été reçue.");

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
try {
  await client.connect();
  await client.db("admin").command({ ping: 1 });
  const collection = client.db(DB_NAME).collection("franime");
  await collection.createIndex({ animeId: 1 }, { unique: true, name: "anime_id_unique" });
  await collection.createIndex({ source: 1, franimeOrder: -1 }, { name: "franime_catalogue_order" });
  const existing = await collection.find(
    { animeId: { $in: documents.map((document) => document.animeId) } },
    { projection: { animeId: 1, franimeSeasons: 1, seasons: 1, franimeUpdatedDate: 1, franimeUpdatedDateVF: 1 } },
  ).toArray();
  const existingById = new Map(existing.map((anime) => [anime.animeId, anime]));
  let newOrUpdatedEpisodes = 0;
  const updates = documents.map((document) => {
  const previous = existingById.get(document.animeId);
  if (!previous || hasNewEpisodes(previous, document)) {
    newOrUpdatedEpisodes += 1;
    return { ...document, frAnimeNeedsTmdbRefresh: true };
  }
  return document;
  });

  let inserted = 0;
  let updated = 0;
  for (let offset = 0; offset < updates.length; offset += 500) {
    const batch = updates.slice(offset, offset + 500);
    const result = await collection.bulkWrite(batch.map((document) => ({
      updateOne: {
        filter: { animeId: document.animeId },
        update: { $set: document, $setOnInsert: { franimeAddedAt: syncedAt } },
        upsert: true,
      },
    })), { ordered: false });
    inserted += result.upsertedCount;
    updated += result.modifiedCount;
  }
  console.log(`FrAnime — ${documents.length} fiches vérifiées, ${newOrUpdatedEpisodes} nouvelles ou avec nouveauté, ${inserted} ajoutées et ${updated} mises à jour dans ${DB_NAME}.franime.`);
} finally {
  await client.close();
}

if (!process.argv.includes("--defer-post-sync")) {
  await import("./sync-calendar.mjs");
  if (!process.argv.includes("--metadata-only")) {
    process.env.FRANIME_CHANGED_ONLY = "1";
    await import("./enrich-franime.mjs");
  }
}
