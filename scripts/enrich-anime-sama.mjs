/**
 * Anime-Sama → TMDB.
 *
 * `sync-anime-sama` crée des fiches avec l'affiche, les saisons et les
 * épisodes d'Anime-Sama, mais sans métadonnées : ni synopsis, ni bannière, ni
 * genres, ni année. Ce script retrouve la fiche TMDB correspondante et la
 * complète. L'identifiant TMDB est ensuite la clé interne de la fiche, comme
 * pour les animés importés de FrAnime.
 *
 * Le découpage saisons/épisodes d'Anime-Sama est CONSERVÉ : c'est lui qui
 * décrit ce que le site sait lire. TMDB n'apporte que les métadonnées et les
 * titres d'épisodes (rattachés par numéro absolu).
 *
 *   npm run catalogue:anime-sama:tmdb
 *   npm run catalogue:anime-sama:tmdb -- --limit=20
 *   npm run catalogue:anime-sama:tmdb -- --dry-run
 */
import { MongoClient } from "mongodb";

const API_ROOT = "https://api.themoviedb.org/3";
const IMAGE_ROOT = "https://image.tmdb.org/t/p";
const API_KEY = process.env.TMDB_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "animevision";
const WORKERS = 4;
const REQUEST_GAP_MS = 180;

if (!API_KEY) throw new Error("TMDB_API_KEY absent de .env.local.");
if (!MONGODB_URI) throw new Error("MONGODB_URI absent de .env.local.");

const dryRun = process.argv.includes("--dry-run");
const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length)) || 0;
const force = process.argv.includes("--force");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextRequestAt = 0;

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function frenchSynopsis(value) {
  const words = String(value ?? "").toLocaleLowerCase("fr-FR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z]+/g) ?? [];
  if (words.length < 8) return "";
  const french = new Set("le la les de des du un une et est dans pour par sur avec qui que son sa ses ce cette ces il elle ils elles mais comme plus ne pas sans leur leurs dont ou alors après avant lorsque quand parce très tout tous toute entre vers depuis lui sous être été avoir aussi chaque même afin notamment aux".split(" "));
  const english = new Set("the and a an is are of to in for with who that his her they he she it as but from on by be was were this these those which their its have has".split(" "));
  const f = words.filter((word) => french.has(word)).length;
  const e = words.filter((word) => english.has(word)).length;
  return f >= 2 && f > e ? String(value).trim() : "";
}

async function tmdb(path, params = {}) {
  const url = new URL(`${API_ROOT}${path}`);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("language", "fr-FR");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wait = Math.max(0, nextRequestAt - Date.now());
    nextRequestAt = Math.max(Date.now(), nextRequestAt) + REQUEST_GAP_MS;
    if (wait) await sleep(wait);
    let response;
    try {
      response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    } catch {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (response.ok) return response.json();
    if (response.status === 404) return null;
    if (response.status === 429 || response.status >= 500) {
      await sleep(Math.min((Number(response.headers.get("retry-after")) || 2 ** attempt) * 1000, 60_000));
      continue;
    }
    throw new Error(`TMDB HTTP ${response.status} sur ${path}.`);
  }
  throw new Error(`TMDB indisponible sur ${path}.`);
}

function image(path, size) {
  return typeof path === "string" && path.startsWith("/") ? `${IMAGE_ROOT}/${size}${path}` : null;
}

function likelyAnime(item) {
  return (item.genre_ids ?? []).includes(16) || item.original_language === "ja" || (item.origin_country ?? []).includes("JP");
}

function matchExactTitle(title, results) {
  const expected = normalize(title);
  if (!expected) return null;
  const candidates = (results ?? []).filter((item) => ["tv", "movie"].includes(item.media_type)
    && likelyAnime(item)
    && [item.name, item.title, item.original_name, item.original_title].some((name) => normalize(name) === expected));
  const unique = new Map(candidates.map((item) => [`${item.media_type}:${item.id}`, item]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

/** Variantes de recherche : Anime-Sama écrit parfois le titre autrement. */
function searchVariants(title) {
  const clean = String(title ?? "").replace(/\s+/g, " ").trim();
  const variants = new Set([clean]);
  variants.add(clean.replace(/\s*[-–:]\s*(saison|season)\s*\d+.*$/i, ""));
  variants.add(clean.replace(/\s*\([^)]*\)\s*$/, ""));
  variants.add(clean.replace(/\s*[²³]$/, ""));
  variants.add(clean.replace(/\s+(?:the\s+)?(?:movie|film|oav|ova)$/i, ""));
  return [...variants].filter((value) => value && value.length >= 2);
}

/** Repli : la recherche TMDB est floue, on accepte le premier animé plausible. */
async function fuzzyMatch(title) {
  const results = await tmdb("/search/tv", { query: title, include_adult: false });
  const candidates = (results?.results ?? []).filter(likelyAnime);
  if (candidates.length === 0) return null;
  const expected = normalize(title);
  const scored = candidates.map((item) => {
    const names = [item.name, item.original_name].map(normalize);
    const distance = Math.min(...names.map((name) => (name === expected ? 0 : name.startsWith(expected) || expected.startsWith(name) ? 1 : 2)));
    return { item: { id: item.id, media_type: "tv" }, score: distance };
  }).filter((entry) => entry.score <= 1);
  if (scored.length !== 1) return null;
  return { item: scored[0].item, matchedTitle: title };
}

async function findMatch(fiche) {
  const aliases = [...new Set([fiche.title, fiche.originalTitle, ...Object.values(fiche.titles ?? {}), ...(fiche.synonyms ?? [])].filter((value) => typeof value === "string" && value.trim()))];
  for (const alias of aliases) {
    for (const title of searchVariants(alias)) {
      const results = await tmdb("/search/multi", { query: title, include_adult: false });
      const item = matchExactTitle(title, results?.results);
      if (item) return { item, matchedTitle: title };
    }
  }
  for (const alias of aliases) {
    for (const title of searchVariants(alias)) {
      const item = await fuzzyMatch(title);
      if (item) return item;
    }
  }
  return null;
}

/** Titres d'épisodes TMDB par numéro absolu, pour habiller la liste Anime-Sama. */
async function tmdbEpisodes(details, mediaType) {
  if (mediaType !== "tv") return new Map();
  const metadata = new Map();
  const seasons = (details.seasons ?? [])
    .filter((season) => Number.isSafeInteger(season.season_number) && season.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number)
    .slice(0, 20);
  let absolute = 1;
  for (const season of seasons) {
    const data = await tmdb(`/tv/${details.id}/season/${season.season_number}`);
    const episodes = (data?.episodes ?? []).slice().sort((a, b) => a.episode_number - b.episode_number);
    for (const episode of episodes) {
      metadata.set(absolute, {
        titre: episode.name || null,
        airDate: episode.air_date || null,
        overview: frenchSynopsis(episode.overview) || null,
        still: image(episode.still_path, "w500"),
        runtime: episode.runtime ?? null,
      });
      absolute += 1;
    }
  }
  return metadata;
}

const client = new MongoClient(MONGODB_URI, { maxPoolSize: WORKERS + 2, serverSelectionTimeoutMS: 10_000 });
try {
  await client.connect();
  const collection = client.db(DB_NAME).collection("catalogue");
  // Par défaut on repasse aussi sur les fiches laissées « sans correspondance »
  // par une passe précédente : le repli flou a été ajouté après elles.
  const query = force
    ? { sources: "anime-sama" }
    : { sources: "anime-sama", $or: [{ needsTmdbEnrichment: true }, { tmdbMatch: { $exists: false } }, { "tmdbMatch.status": "no-exact-title-match" }] };
  let fiches = await collection.find(query, {
    projection: { id: 1, numero: 1, title: 1, originalTitle: 1, titles: 1, synonyms: 1, seasons: 1, affiche: 1 },
  }).toArray();
  if (limit > 0) fiches = fiches.slice(0, limit);
  if (fiches.length === 0) {
    console.log("Aucune fiche Anime-Sama à enrichir.");
  } else {
    console.log(`Anime-Sama + TMDB — ${fiches.length} fiche(s) à traiter.`);
  }

  let cursor = 0;
  let matched = 0;
  let unmatched = 0;
  let failures = 0;
  let processed = 0;

  async function worker() {
    while (cursor < fiches.length) {
      const fiche = fiches[cursor++];
      try {
        const match = await findMatch(fiche);
        if (!match) {
          unmatched += 1;
          if (!dryRun) {
            await collection.updateOne({ _id: fiche._id }, {
              $set: { tmdbMatch: { status: "no-exact-title-match", method: "anime-sama-title" }, needsTmdbEnrichment: false, tmdbEnrichedAt: new Date() },
            });
          }
          continue;
        }
        const mediaType = match.item.media_type;
        const details = await tmdb(`/${mediaType}/${match.item.id}`, {
          append_to_response: "external_ids,keywords,content_ratings,alternative_titles,images,credits",
          include_image_language: "fr,null",
        });
        if (!details) {
          unmatched += 1;
          continue;
        }
        const title = details.name || details.title || fiche.title;
        const frenchOverview = frenchSynopsis(details.overview);
        const episodes = await tmdbEpisodes(details, mediaType);
        // Saisons Anime-Sama conservées ; on y ajoute les titres d'épisodes TMDB.
        let absolute = 1;
        const seasons = (fiche.seasons ?? []).map((season) => ({
          ...season,
          episodes: (season.episodes ?? []).map((episode) => {
            const extra = episodes.get(absolute++);
            return {
              ...episode,
              titre: extra?.titre ?? episode.titre ?? null,
              airDate: extra?.airDate ?? episode.airDate ?? null,
              still: extra?.still ?? episode.still ?? null,
              runtime: extra?.runtime ?? episode.runtime ?? null,
            };
          }),
        }));
        const fields = {
          tmdbSource: mediaType,
          tmdbId: details.id,
          tmdbMatch: { status: "matched", method: "anime-sama-title", matchedTitle: match.matchedTitle, confidence: 1 },
          // Le titre du site Anime-Sama reste le titre affiché : c'est celui que
          // l'utilisateur voit sur sa source, et le catalogue le référence.
          originalTitle: details.original_name || details.original_title || fiche.originalTitle || null,
          titles: {
            ...(fiche.titles ?? {}),
            ...(details.name ? { fr: details.name } : {}),
            ...(details.original_name ? { en_jp: details.original_name } : {}),
          },
          synopsis: frenchOverview || details.overview || "",
          affiche: image(details.poster_path, "w500") || fiche.affiche || null,
          afficheSmall: image(details.poster_path, "w342") || fiche.affiche || null,
          banniere: image(details.backdrop_path, "w1280") || null,
          genres: (details.genres ?? []).map((genre) => genre.name).filter(Boolean),
          startDate: details.first_air_date || details.release_date || null,
          year: Number(String(details.first_air_date || details.release_date || "").slice(0, 4)) || null,
          format: mediaType === "movie" ? "Film" : "TV",
          status: details.status ?? null,
          rating: typeof details.vote_average === "number" ? details.vote_average : 0,
          tmdbRating: typeof details.vote_average === "number" ? details.vote_average : 0,
          popularite: details.popularity ?? 0,
          tmdb: {
            id: details.id,
            mediaType,
            title,
            originalName: details.original_name ?? details.original_title ?? null,
            overview: frenchOverview,
            status: details.status ?? null,
            firstAirDate: details.first_air_date ?? details.release_date ?? null,
            numberOfSeasons: details.number_of_seasons ?? null,
            numberOfEpisodes: details.number_of_episodes ?? null,
            voteAverage: details.vote_average ?? 0,
            genres: details.genres ?? [],
            keywords: details.keywords?.results ?? [],
            externalIds: details.external_ids ?? {},
            cast: (details.credits?.cast ?? []).slice(0, 20).map((person) => ({
              id: person.id,
              name: person.name,
              character: person.character || undefined,
              profile: image(person.profile_path, "w185"),
            })),
            images: {
              backdrops: (details.images?.backdrops ?? []).slice(0, 8).map((item) => image(item.file_path, "w1280")),
              posters: (details.images?.posters ?? []).slice(0, 8).map((item) => image(item.file_path, "w500")),
            },
          },
          seasons,
          seasonsCount: seasons.length,
          latestSeason: seasons.length > 0 ? seasons[seasons.length - 1].titre : null,
          latestEpisode: seasons.flatMap((season) => season.episodes ?? []).reduce((best, episode) => Math.max(best, Number(episode.number) || 0), 0) || null,
          needsTmdbEnrichment: false,
          tmdbEnrichedAt: new Date(),
          updatedAt: new Date(),
        };
        if (!dryRun) await collection.updateOne({ _id: fiche._id }, { $set: fields, $unset: { tmdbError: "" } });
        matched += 1;
        if (matched % 10 === 0) console.log(`Anime-Sama + TMDB — ${matched} fiche(s) enrichie(s)`);
      } catch (error) {
        failures += 1;
        console.error(`Échec sur ${fiche.title} : ${error.message}`);
        if (!dryRun) {
          await collection.updateOne({ _id: fiche._id }, { $set: { tmdbError: String(error.message).slice(0, 300) } }).catch(() => undefined);
        }
      }
      processed += 1;
      if (processed % 25 === 0 || processed === fiches.length) console.log(`Anime-Sama + TMDB — ${processed}/${fiches.length} examinées`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(WORKERS, Math.max(fiches.length, 1)) }, worker));
  console.log(`Anime-Sama + TMDB terminé — ${matched} enrichies, ${unmatched} sans correspondance exacte, ${failures} erreurs.${dryRun ? " (--dry-run : aucune écriture)" : ""}`);
} finally {
  await client.close();
}
