/**
 * Anime-Sama → catalogue.
 *
 * Anime-Sama publie des animés que FrAnime n'a pas : sans cette synchro, une
 * série qui sort chez Anime-Sama n'existe pas dans le catalogue AnimeVision
 * (elle apparaît au calendrier sans fiche, sans affiche et sans lecteur).
 *
 * Ce script :
 *   1. parcourt le catalogue public d'Anime-Sama (pages paginées) ;
 *   2. garde les fiches qui ont au moins une saison d'animé (les scans et les
 *      fiches sans épisode sont écartés) ;
 *   3. écarte celles que le catalogue connaît déjà (même titre, même slug ou
 *      même identifiant TMDB) ;
 *   4. crée une fiche par animé manquant (`sources: ["anime-sama"]`,
 *      `animeSamaSlug`), avec affiche, saisons et langues disponibles.
 *
 * Les fiches créées sont marquées `needsTmdbEnrichment` : `enrich-anime-sama`
 * leur ajoute ensuite les métadonnées TMDB (synopsis, bannière, genres, date).
 *
 *   npm run sync:anime-sama                 (toute la synchro)
 *   npm run sync:anime-sama -- --limit=20   (les 20 premières nouveautés, test)
 *   npm run sync:anime-sama -- --dry-run    (aucune écriture)
 */
import { MongoClient } from "mongodb";
import { readFile } from "node:fs/promises";

const BASE_URLS = ["https://animes-sama.fr", "https://anime-sama.to"];
const DB_NAME = process.env.MONGODB_DB || "animevision";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const MAX_PAGES = 400;
const PAGE_GAP_MS = 120;
const DETAIL_WORKERS = 4;
const MAX_DETAIL_FETCHES = Number(process.env.ANIME_SAMA_MAX_DETAILS || 600);

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("MONGODB_URI absent de .env.local.");

const dryRun = process.argv.includes("--dry-run");
const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length)) || 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function decode(value) {
  return String(value ?? "")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

async function fetchText(url, { tries = 3, redirect = "follow" } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
        redirect,
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt === tries - 1) return null;
      await sleep(800 * (attempt + 1));
    }
  }
  return null;
}

/** Pages du catalogue public : { slug, titre, image }. */
async function cataloguePages() {
  const entries = new Map();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const html = await fetchText(`${BASE_URLS[0]}/catalogue?page=${page}`);
    if (!html) break;
    const cards = [...html.matchAll(/<div class="shrink-0 catalog-card card-base">([\s\S]*?)<\/a>\s*<\/div>/g)];
    if (cards.length === 0) break;
    for (const [, card] of cards) {
      const slug = /<a href="\/catalogue\/([^"/]+)\/"/.exec(card)?.[1];
      const titre = /<div class="card-title">([\s\S]*?)<\/div>/.exec(card)?.[1];
      const image = /<img class="card-image"\s*src="([^"]*)"/.exec(card)?.[1];
      if (!slug || !titre) continue;
      entries.set(slug, { slug, titre: decode(titre), image: image ? decode(image) : null });
    }
    if (page % 20 === 0) console.log(`Anime-Sama — ${page} pages, ${entries.size} fiches listées`);
    await sleep(PAGE_GAP_MS);
  }
  return [...entries.values()];
}

/** Fiche du site : saisons d'animé (scans écartés) et langues. */
async function animeSamaDetails(slug) {
  for (const base of BASE_URLS) {
    const html = await fetchText(`${base}/catalogue/${slug}`);
    if (!html) continue;
    const links = [...html.matchAll(/href="\/catalogue\/[^"']+\/(saison\d+)\/([a-z]+)"/g)];
    const seasons = new Map();
    for (const [, segment, language] of links) {
      const number = Number(segment.replace(/\D+/g, ""));
      if (!number) continue;
      if (!seasons.has(number)) seasons.set(number, new Set());
      seasons.get(number).add(language === "vf" ? "VF" : "VOSTFR");
    }
    if (seasons.size === 0) return { seasons: [], languages: [] };
    const languages = new Set();
    for (const set of seasons.values()) for (const language of set) languages.add(language);
    return {
      base,
      seasons: [...seasons.keys()].sort((a, b) => a - b),
      languages: [...languages],
    };
  }
  return { seasons: [], languages: [] };
}

async function episodeNumbers(base, slug, season, language) {
  const html = await fetchText(`${base}/catalogue/${slug}/saison${season}/${language}`);
  if (!html) return [];
  const match = /window\.__EPISODE_NUMBERS\s*=\s*(\[[^\]]*\])/.exec(html);
  if (!match) return [];
  try {
    const numbers = JSON.parse(match[1]);
    return Array.isArray(numbers) ? numbers.filter((value) => Number.isSafeInteger(value) && value > 0) : [];
  } catch {
    return [];
  }
}

async function main() {
  const listed = await cataloguePages();
  if (listed.length === 0) throw new Error("Le catalogue Anime-Sama n’a renvoyé aucune fiche.");
  console.log(`Anime-Sama — ${listed.length} fiches listées.`);

  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const catalogue = db.collection("catalogue");

    const existing = await catalogue.find({}, {
      projection: { id: 1, title: 1, originalTitle: 1, titles: 1, synonyms: 1, tmdbId: 1, animeSamaSlug: 1 },
    }).toArray();
    const known = new Set();
    for (const document of existing) {
      const titles = document.titles ?? {};
      for (const value of [document.title, document.originalTitle, titles.fr, titles.en, titles.en_jp, titles.romaji, titles.ja_jp, ...(document.synonyms ?? []), document.animeSamaSlug]) {
        const key = normalize(value);
        if (key) known.add(key);
      }
    }
    console.log(`Catalogue — ${existing.length} fiches, ${known.size} titres connus.`);

    const candidates = listed.filter((entry) => !known.has(normalize(entry.slug)) && !known.has(normalize(entry.titre)));
    console.log(`Anime-Sama — ${candidates.length} fiches absentes du catalogue.`);

    const queue = limit > 0 ? candidates.slice(0, limit) : candidates;
    const maxNumber = await catalogue.find({ numero: { $gt: 0 } }, { projection: { numero: 1 }, sort: { numero: -1 }, limit: 1 }).next();
    let nextNumero = (Number(maxNumber?.numero) || 0) + 1;

    const created = [];
    let cursor = 0;
    let detailsFetched = 0;

    async function worker() {
      while (cursor < queue.length && detailsFetched < MAX_DETAIL_FETCHES) {
        const entry = queue[cursor++];
        detailsFetched += 1;
        const details = await animeSamaDetails(entry.slug);
        // Pas de saison d'animé : scan, film ou fiche vide → on ne crée rien.
        if (details.seasons.length === 0) continue;
        const seasons = [];
        for (const number of details.seasons) {
          const language = details.languages.includes("VOSTFR") ? "vostfr" : "vf";
          const numbers = await episodeNumbers(details.base, entry.slug, number, language);
          seasons.push({
            index: number - 1,
            titre: `Saison ${number}`,
            episodes: numbers.map((value) => ({ number: value, titre: null, availableLanguages: details.languages })),
          });
        }
        const episodes = seasons.flatMap((season) => season.episodes);
        const latest = episodes.reduce((best, episode) => (episode.number > best ? episode.number : best), 0);
        const numero = nextNumero++;
        created.push({
          id: entry.slug,
          numero,
          title: entry.titre,
          originalTitle: null,
          titles: {},
          synonyms: [],
          affiche: entry.image,
          afficheSmall: entry.image,
          banniere: null,
          genres: [],
          synopsis: "",
          startDate: null,
          format: "TV",
          sources: ["anime-sama"],
          animeSamaSlug: entry.slug,
          seasonsCount: seasons.length,
          seasons,
          latestSeason: seasons.length > 0 ? `Saison ${seasons[seasons.length - 1].index + 1}` : null,
          latestEpisode: latest || null,
          availableLanguages: details.languages,
          needsTmdbEnrichment: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        if (created.length % 25 === 0) console.log(`Anime-Sama — ${created.length} fiches créées (${detailsFetched} fiches examinées)`);
      }
    }
    await Promise.all(Array.from({ length: DETAIL_WORKERS }, worker));

    console.log(`Anime-Sama — ${created.length} fiches à créer (${detailsFetched} fiches examinées).`);
    if (dryRun) {
      console.log("--dry-run : aucune écriture.");
      console.log(created.slice(0, 15).map((fiche) => `${fiche.numero} · ${fiche.title} (${fiche.seasons.length} saison(s))`).join("\n"));
      return;
    }
    let inserted = 0;
    for (let offset = 0; offset < created.length; offset += 200) {
      const batch = created.slice(offset, offset + 200);
      const result = await catalogue.bulkWrite(batch.map((document) => ({
        updateOne: {
          filter: { id: document.id, sources: "anime-sama" },
          update: { $setOnInsert: document },
          upsert: true,
        },
      })), { ordered: false });
      inserted += result.upsertedCount;
    }
    console.log(`Anime-Sama — ${inserted} fiches ajoutées à ${DB_NAME}.catalogue.`);
  } finally {
    await client.close();
  }
}

await main();
