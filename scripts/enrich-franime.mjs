import { MongoClient } from "mongodb";

const API_ROOT = "https://api.themoviedb.org/3";
const IMAGE_ROOT = "https://image.tmdb.org/t/p";
const API_KEY = process.env.TMDB_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "animevision";
const WORKERS = 5;
const REQUEST_GAP_MS = 180;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MATCH_VERSION = 4;
const EPISODE_MAPPING_VERSION = 7;
const TMDB_DISPLAY_VERSION = 3;
const FRENCH_WORDS = new Set("le la les de des du un une et est dans pour par sur avec qui que son sa ses ce cette ces il elle ils elles mais comme plus ne pas sans leur leurs dont ou alors après avant lorsque quand parce très tout tous toute entre vers depuis lui sous être été avoir aussi chaque même afin notamment aux".split(" "));
const ENGLISH_WORDS = new Set("the and a an is are of to in for with who that his her they he she it as but from on by be was were this these those which their its have has".split(" "));

if (!API_KEY) throw new Error("TMDB_API_KEY absent de .env.local.");
if (!MONGODB_URI) throw new Error("MONGODB_URI absent de .env.local.");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextRequestAt = 0;

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function frenchSynopsis(value) {
  const words = String(value ?? "")
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z]+/g) ?? [];
  if (words.length < 8) return "";
  const french = words.filter((word) => FRENCH_WORDS.has(word)).length;
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length;
  return french >= 2 && french > english ? String(value).trim() : "";
}

async function tmdb(path, params = {}) {
  const url = new URL(`${API_ROOT}${path}`);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("language", "fr-FR");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const wait = Math.max(0, nextRequestAt - Date.now());
    nextRequestAt = Math.max(Date.now(), nextRequestAt) + REQUEST_GAP_MS;
    if (wait) await sleep(wait);

    let response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (attempt === 5) throw new Error("Erreur réseau lors de l’appel TMDB.");
      await sleep(1000 * (attempt + 1));
      continue;
    }

    if (response.ok) return response.json();
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after")) || 2 ** attempt;
      await sleep(Math.min(retryAfter * 1000, 60_000));
      continue;
    }
    if (response.status === 404) return null;
    throw new Error(`TMDB HTTP ${response.status} sur ${path}.`);
  }
  throw new Error(`TMDB indisponible après plusieurs essais sur ${path}.`);
}

function sourceTitle(anime) {
  return String(anime.franimeTitle ?? anime.title ?? "").trim();
}

function sourceAliases(anime) {
  const values = [
    anime.franimeTitle,
    anime.franimeTitleOriginal,
    ...Object.values(anime.franimeTitles ?? {}),
    anime.title,
    anime.titleOriginal,
    ...Object.values(anime.titles ?? {}),
    ...(Array.isArray(anime.autresNoms) ? anime.autresNoms : [anime.autresNoms]),
    ...(Array.isArray(anime.animeSamaAlternateTitles) ? anime.animeSamaAlternateTitles : []),
    ...(Array.isArray(anime.alternateTitles) ? anime.alternateTitles : []),
    ...(Array.isArray(anime.alternativeTitles) ? anime.alternativeTitles : []),
  ];
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function mediaTitle(item) {
  return item.media_type === "movie" ? item.title : item.name;
}

function likelyAnime(item) {
  return (item.genre_ids ?? []).includes(16)
    || item.original_language === "ja"
    || (item.origin_country ?? []).includes("JP");
}

function matchExactTitle(title, results) {
  const expected = normalize(title);
  if (!expected) return null;
  const candidates = (results ?? []).filter(
    (item) => ["tv", "movie"].includes(item.media_type)
      && likelyAnime(item)
      && [item.name, item.title, item.original_name, item.original_title].some((name) => normalize(name) === expected),
  );
  const unique = new Map(candidates.map((item) => [`${item.media_type}:${item.id}`, item]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

async function findTmdbMatch(anime) {
  const aliases = sourceAliases(anime);
  // Prefer a previously verified identifier when present; revalidate it against
  // FrAnime's exact titles so transient search results cannot break a match.
  if (anime.tmdbMatch?.status === "matched" && anime.tmdbId && ["tv", "movie"].includes(anime.tmdbSource)
    && anime.tmdbMatchedTitle === sourceTitle(anime)) {
    return { item: { id: anime.tmdbId, media_type: anime.tmdbSource }, matchedTitle: anime.tmdbMatch.matchedTitle || sourceTitle(anime) };
  }
  if (anime.tmdbId && ["tv", "movie"].includes(anime.tmdbSource)) {
    const details = await tmdb(`/${anime.tmdbSource}/${anime.tmdbId}`);
    const matchedTitle = aliases.find((alias) =>
      [details?.name, details?.title, details?.original_name, details?.original_title]
        .some((candidate) => normalize(candidate) === normalize(alias)),
    );
    if (details && matchedTitle && likelyAnime({
      genre_ids: (details.genres ?? []).map((genre) => genre.id),
      original_language: details.original_language,
      origin_country: details.origin_country,
    })) {
      return { item: { id: details.id, media_type: anime.tmdbSource }, matchedTitle };
    }
  }
  for (const title of [...new Set(aliases)]) {
    const results = await tmdb("/search/multi", { query: title, include_adult: false });
    const item = matchExactTitle(title, results?.results);
    if (item) return { item, matchedTitle: title };
  }
  return null;
}

function image(path, size = "original") {
  return typeof path === "string" && path.startsWith("/") ? `${IMAGE_ROOT}/${size}${path}` : null;
}

function topPeople(list, limit = 15) {
  return (list ?? []).slice(0, limit).map((person) => ({
    id: person.id,
    name: person.name,
    character: person.character || undefined,
    job: person.job || undefined,
    department: person.department || undefined,
    profile: image(person.profile_path, "w185"),
  }));
}

function seriesMetadata(details, mediaType) {
  const keywordList = details.keywords?.results ?? details.keywords?.keywords ?? [];
  const franceRating = details.content_ratings?.results?.find((rating) => rating.iso_3166_1 === "FR");
  const logo = (details.images?.logos ?? []).find((item) => item.iso_639_1 === "fr")
    ?? (details.images?.logos ?? []).find((item) => item.iso_639_1 === null)
    ?? (details.images?.logos ?? [])[0];
  const originalName = details.original_name ?? details.original_title ?? null;
  const title = details.name ?? details.title ?? null;

  return {
    id: details.id,
    mediaType,
    title,
    originalName,
    originalLanguage: details.original_language ?? null,
    overview: frenchSynopsis(details.overview),
    tagline: details.tagline ?? "",
    status: details.status ?? null,
    type: details.type ?? (mediaType === "movie" ? "Film" : null),
    homepage: details.homepage ?? null,
    firstAirDate: details.first_air_date ?? details.release_date ?? null,
    lastAirDate: details.last_air_date ?? null,
    runtime: details.runtime ?? null,
    episodeRuntime: details.episode_run_time ?? [],
    numberOfSeasons: details.number_of_seasons ?? null,
    numberOfEpisodes: details.number_of_episodes ?? null,
    seasons: (details.seasons ?? []).map((season) => ({
      seasonNumber: season.season_number,
      title: season.name ?? null,
      episodeCount: season.episode_count ?? 0,
      firstAirDate: season.air_date ?? null,
      poster: image(season.poster_path, "w500"),
    })),
    inProduction: details.in_production ?? false,
    popularity: details.popularity ?? 0,
    voteAverage: details.vote_average ?? 0,
    voteCount: details.vote_count ?? 0,
    originCountry: details.origin_country ?? [],
    spokenLanguages: details.spoken_languages ?? [],
    genres: details.genres ?? [],
    networks: details.networks ?? [],
    productionCompanies: details.production_companies ?? [],
    productionCountries: details.production_countries ?? [],
    createdBy: details.created_by ?? [],
    keywords: keywordList,
    externalIds: details.external_ids ?? {},
    franceRating: franceRating?.rating ?? null,
    cast: topPeople(details.credits?.cast, 20),
    crew: topPeople(details.credits?.crew, 20),
    videos: (details.videos?.results ?? [])
      .filter((video) => video.site === "YouTube")
      .slice(0, 12)
      .map(({ id, key, name, type, official, published_at }) => ({ id, key, name, type, official, publishedAt: published_at })),
    images: {
      posters: (details.images?.posters ?? []).slice(0, 8).map((item) => image(item.file_path, "w500")),
      backdrops: (details.images?.backdrops ?? []).slice(0, 8).map((item) => image(item.file_path, "w1280")),
      logos: (details.images?.logos ?? []).slice(0, 8).map((item) => image(item.file_path, "w500")),
    },
    logo: image(logo?.file_path, "w500"),
  };
}

function namedSourceEpisodeNumber(episode) {
  const label = String(episode?.title || episode?.name || "");
  const namedNumber = label.match(/(?:épisode|episode|ep)\s*#?\s*(\d+)/i);
  if (namedNumber) return Number(namedNumber[1]);
  return null;
}

function sourceEpisodeNumbers(sourceSeason, fallbackStart = 1) {
  const episodes = Array.isArray(sourceSeason?.episodes) ? sourceSeason.episodes : [];
  const anchors = episodes.map((episode, index) => {
    const named = namedSourceEpisodeNumber(episode);
    const explicit = Number(episode?.number);
    const absolute = (named !== null && named > episodes.length)
      ? named
      : (Number.isSafeInteger(explicit) && explicit > episodes.length ? explicit : null);
    return absolute === null ? null : absolute - index;
  }).filter((anchor) => Number.isSafeInteger(anchor) && anchor > 0);
  const counts = new Map();
  for (const anchor of anchors) counts.set(anchor, (counts.get(anchor) ?? 0) + 1);
  const anchorStart = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const start = anchorStart ?? fallbackStart;
  return episodes.map((episode, index) => {
    const named = namedSourceEpisodeNumber(episode);
    return named !== null && named > episodes.length ? named : start + index;
  });
}

function sourceSeasonEntries(anime) {
  const seasons = Array.isArray(anime.franimeSeasons) ? anime.franimeSeasons : (Array.isArray(anime.seasons) ? anime.seasons : []);
  return seasons
    .map((season, index) => ({ season, index, title: String(season?.title || `Saison ${index + 1}`) }))
    .filter(({ title }) => !/\blive[\s-]*action\b/i.test(title))
    .sort((a, b) => {
      const rank = (title, index) => {
        const seasonNumber = title.match(/\bsaison\s+(\d+)/i)?.[1];
        if (seasonNumber) return Number(seasonNumber);
        const trailingNumber = title.match(/(\d+(?:[.,]\d+)?)\s*$/)?.[1];
        return trailingNumber ? Number(trailingNumber.replace(",", ".")) : 10_000 + index;
      };
      return rank(a.title, a.index) - rank(b.title, b.index) || a.index - b.index;
    });
}

function sourceOnlySeasons(anime) {
  let nextAbsoluteEpisode = 1;
  return Object.fromEntries(sourceSeasonEntries(anime).map(({ season, title }, seasonIndex) => {
    const numbers = sourceEpisodeNumbers(season, nextAbsoluteEpisode);
    const episodes = Object.fromEntries((season.episodes ?? []).map((episode, index) => {
      const number = numbers[index];
      return [String(number), {
        titre: episode?.title || episode?.name || `Épisode ${number}`,
        airDate: null,
        overview: "",
        still: null,
        runtime: null,
      }];
    }));
    if (!/live\s*action/i.test(title) && numbers.length) nextAbsoluteEpisode = Math.max(nextAbsoluteEpisode, ...numbers) + 1;
    return [title, { vo: {}, vf: {}, episodes, affiche: null, airDate: null }];
  }));
}

function getFrAnimeSeasons(anime, tmdbEpisodes = new Map()) {
  const result = {};
  const sourceSeasons = sourceSeasonEntries(anime);
  let nextAbsoluteEpisode = 1;
  for (const { season: sourceSeason, title: seasonTitle } of sourceSeasons) {
    const episodeSources = Array.isArray(sourceSeason.episodes) ? sourceSeason.episodes : [];
    const absoluteEpisodeNumbers = sourceEpisodeNumbers(sourceSeason, nextAbsoluteEpisode);
    if (!/live\s*action/i.test(seasonTitle) && absoluteEpisodeNumbers.length) {
      nextAbsoluteEpisode = Math.max(nextAbsoluteEpisode, ...absoluteEpisodeNumbers) + 1;
    }
    const seasonLanguageValues = episodeSources.flatMap((episode) => Array.isArray(episode?.availableLanguages) ? episode.availableLanguages : []);
    const availableLanguages = [...new Set(seasonLanguageValues.map((value) => {
      const language = String(value).toLowerCase();
      return language === "vf" ? "vf" : ["vo", "vostfr"].includes(language) ? "vo" : null;
    }).filter(Boolean))];
    const previousSeason = anime.saisons?.[seasonTitle] ?? {};
    const tmdbPosterCounts = new Map();
    for (const number of absoluteEpisodeNumbers) {
      const poster = tmdbEpisodes.get(number)?.seasonPoster;
      if (poster) tmdbPosterCounts.set(poster, (tmdbPosterCounts.get(poster) ?? 0) + 1);
    }
    const tmdbSeasonPoster = [...tmdbPosterCounts.entries()]
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const season = {
      vo: previousSeason.vo ?? {},
      vf: previousSeason.vf ?? {},
      episodes: {},
      affiche: tmdbSeasonPoster ?? previousSeason.affiche ?? previousSeason.poster ?? null,
      airDate: previousSeason.airDate ?? null,
      availableLanguages,
    };
    for (let i = 0; i < episodeSources.length; i += 1) {
      const sourceEpisode = episodeSources[i];
      const number = absoluteEpisodeNumbers[i];
      const episodeLanguages = (Array.isArray(sourceEpisode?.availableLanguages) ? sourceEpisode.availableLanguages : [])
        .map((value) => String(value).toLowerCase())
        .map((value) => value === "vf" ? "vf" : ["vo", "vostfr"].includes(value) ? "vo" : null)
        .filter(Boolean);
      const metadata = tmdbEpisodes.get(number);
      const previousEpisode = previousSeason.episodes?.[String(number)];
      const keepAdminData = previousEpisode?.adminEdited === true;
      season.episodes[String(number)] = {
        // FrAnime determines which episodes exist and their availability;
        // TMDB supplies display metadata when a matching episode is found.
        titre: keepAdminData ? (previousEpisode.titre ?? previousEpisode.title) : (metadata?.title || `Épisode ${number}`),
        airDate: keepAdminData ? previousEpisode.airDate : (metadata?.airDate || null),
        overview: keepAdminData ? previousEpisode.overview : (metadata?.overview || ""),
        still: keepAdminData ? previousEpisode.still : (metadata?.still || null),
        runtime: keepAdminData ? previousEpisode.runtime : (metadata?.runtime || null),
        ...(keepAdminData ? { adminEdited: true } : {}),
        availableLanguages: episodeLanguages,
      };
    }
    result[seasonTitle] = season;
  }
  for (const [seasonTitle, season] of Object.entries(anime.saisons ?? {})) {
    if (season?.adminAdded === true && !/\blive[\s-]*action\b/i.test(seasonTitle) && !result[seasonTitle]) {
      result[seasonTitle] = season;
    }
  }
  return result;
}

async function getTmdbEpisodeMetadata(details, mediaType) {
  if (mediaType !== "tv") return new Map();
  const regularSeasons = (details.seasons ?? [])
    .filter((season) => Number.isSafeInteger(season.season_number) && season.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number);
  const metadata = new Map();
  let absoluteNumber = 1;
  for (const season of regularSeasons) {
    const seasonDetails = await tmdb(`/tv/${details.id}/season/${season.season_number}`);
    const episodes = (seasonDetails?.episodes ?? []).slice().sort((a, b) => a.episode_number - b.episode_number);
    for (const episode of episodes) {
      metadata.set(absoluteNumber, {
        title: episode.name || null,
        airDate: episode.air_date || null,
        overview: frenchSynopsis(episode.overview),
        still: image(episode.still_path, "w500"),
        seasonPoster: image(season.poster_path, "w500"),
        runtime: episode.runtime ?? null,
      });
      absoluteNumber += 1;
    }
  }
  return metadata;
}

function toAppFields(anime, details, mediaType, matchedTitle) {
  const title = details.name || details.title || details.original_name || details.original_title || sourceTitle(anime) || "Sans titre";
  const aliases = [...sourceAliases(anime), ...(details.alternative_titles?.results ?? []).map((item) => item.title ?? item.name)];
  const alternateTitles = [...new Set(aliases.filter((alias) => typeof alias === "string" && alias.trim() && normalize(alias) !== normalize(title)))];
  const overview = frenchSynopsis(details.overview);
  return {
    tmdbSource: mediaType,
    tmdbId: details.id,
    tmdbMatch: { status: "matched", method: "exact-franime-title", matchedTitle, confidence: 1 },
    titre: title,
    type: mediaType === "movie" ? "film" : "anime",
    autresNoms: alternateTitles,
    synopsis: overview,
    affiche: image(details.poster_path, "w500"),
    banniere: image(details.backdrop_path, "w1280") || null,
    logo: null,
    genres: (details.genres ?? []).map((genre) => genre.name).filter(Boolean),
    notes: typeof details.vote_average === "number" ? details.vote_average : 0,
    date: details.first_air_date || details.release_date || null,
    tmdb: seriesMetadata({ ...details, overview }, mediaType),
  };
}

async function enrichOne(collection, anime) {
  const title = sourceTitle(anime);
  if (!title) return { status: "no-title" };
  const force = process.argv.includes("--force");

  const existing = anime.tmdbEnrichedAt ? new Date(anime.tmdbEnrichedAt).getTime() : 0;
  if (!force && !anime.franimeNeedsTmdbRefresh && !anime.tmdbError && anime.tmdbMatchedTitle === title && Date.now() - existing < MAX_AGE_MS) {
    if (anime.tmdbMatch?.status === "matched" && anime.tmdb && anime.episodeMappingVersion === EPISODE_MAPPING_VERSION && anime.tmdbDisplayVersion === TMDB_DISPLAY_VERSION) {
      return { status: "cached" };
    }
    if (anime.tmdbMatchVersion === MATCH_VERSION && anime.tmdbMatch?.status === "no-exact-title-match") {
      return { status: "cached-unmatched" };
    }
  }

  const match = await findTmdbMatch(anime);
  if (!match) {
    // A failed/empty search must never erase a previously verified TMDB match.
    if (anime.tmdbMatch?.status === "matched" && anime.tmdbId && anime.tmdb) {
      await collection.updateOne(
        { _id: anime._id },
        {
          $set: { tmdbError: "Aucun résultat exact reçu pendant la recherche; données TMDB existantes conservées.", tmdbEnrichedAt: new Date() },
          $unset: { frAnimeNeedsTmdbRefresh: "" },
        },
      );
      return { status: "preserved" };
    }
    await collection.updateOne(
      { _id: anime._id },
      {
        $set: {
          titre: title,
          type: "anime",
          autresNoms: [],
          synopsis: "",
          affiche: null,
          banniere: null,
          logo: null,
          genres: [],
          notes: 0,
          date: null,
          tmdbMatch: { status: "no-exact-title-match", method: "exact-franime-title", confidence: 0 },
          tmdbMatchVersion: MATCH_VERSION,
          episodeMappingVersion: EPISODE_MAPPING_VERSION,
          tmdbMatchedTitle: title,
          tmdbEnrichedAt: new Date(),
        },
        $unset: { tmdbSource: "", tmdbId: "", tmdb: "", frAnimeNeedsTmdbRefresh: "" },
      },
    );
    await collection.updateOne({ _id: anime._id }, { $set: { saisons: sourceOnlySeasons(anime) } });
    return { status: "unmatched" };
  }

  const mediaType = match.item.media_type;
  const append = mediaType === "tv"
    ? "credits,external_ids,keywords,content_ratings,videos,images,alternative_titles"
    : "credits,external_ids,keywords,videos,images,alternative_titles,releases";
  const details = await tmdb(`/${mediaType}/${match.item.id}`, {
    append_to_response: append,
    include_image_language: "fr,null",
  });
  if (!details) return { status: "detail-not-found" };

  const fields = toAppFields(anime, details, mediaType, match.matchedTitle);
  const adminOverrides = Array.isArray(anime.adminOverrides) ? anime.adminOverrides : [];
  for (const key of adminOverrides) delete fields[key];
  fields.logo = fields.tmdb.logo;
  const tmdbEpisodes = await getTmdbEpisodeMetadata(details, mediaType);
  fields.saisons = getFrAnimeSeasons(anime, tmdbEpisodes);
  fields.tmdbEnrichedAt = new Date();
  fields.tmdbMatchedTitle = title;
  fields.tmdbMatchedAlias = match.matchedTitle;
  fields.tmdbMatchVersion = MATCH_VERSION;
  fields.episodeMappingVersion = EPISODE_MAPPING_VERSION;
  fields.tmdbDisplayVersion = TMDB_DISPLAY_VERSION;

  await collection.updateOne({ _id: anime._id }, { $set: fields, $unset: { tmdbError: "", frAnimeNeedsTmdbRefresh: "" } });
  return { status: "matched" };
}

const client = new MongoClient(MONGODB_URI, { maxPoolSize: WORKERS + 2, serverSelectionTimeoutMS: 10_000 });
try {
  await client.connect();
  const collection = client.db(DB_NAME).collection("franime");
  const refreshMatchedOnly = process.argv.includes("--refresh-matched-only");
  const changedOnly = process.env.FRANIME_CHANGED_ONLY === "1" || process.argv.includes("--changed-only");
  const query = {
    source: "franime",
    ...(refreshMatchedOnly ? { "tmdbMatch.status": "matched" } : {}),
    ...(changedOnly ? {
      $or: [
        { frAnimeNeedsTmdbRefresh: true },
        {
          "tmdbMatch.status": "no-exact-title-match",
          $or: [
            { tmdbMatchVersion: { $lt: MATCH_VERSION } },
            { tmdbMatchVersion: { $exists: false } },
          ],
        },
      ],
    } : {}),
  };
  let animes = await collection.find(query).toArray();
  const requestedTitle = process.argv.find((arg) => arg.startsWith("--only-title="))?.slice("--only-title=".length);
  if (requestedTitle) {
    const requestedKey = normalize(decodeURIComponent(requestedTitle));
    animes = animes.filter((anime) => sourceAliases(anime).some((alias) => normalize(alias) === requestedKey));
    if (!animes.length) throw new Error(`Aucune fiche ne correspond au titre ou à ses alias : ${decodeURIComponent(requestedTitle)}.`);
  }
  if (!animes.length && !changedOnly) throw new Error("La collection franime est vide : synchronisez FrAnime avant TMDB.");
  if (!animes.length && changedOnly) console.log("Aucun nouvel épisode détecté : aucun enrichissement TMDB nécessaire.");
  await collection.createIndex({ animeId: 1 }, { unique: true, name: "anime_id_unique" });

  let cursor = 0;
  let matched = 0;
  let unmatched = 0;
  let cached = 0;
  let failures = 0;
  let processed = 0;
  async function worker() {
    while (cursor < animes.length) {
      const index = cursor++;
      try {
        const result = await enrichOne(collection, animes[index]);
        if (result.status === "matched") matched += 1;
        else if (result.status === "cached" || result.status === "cached-unmatched" || result.status === "preserved") cached += 1;
        else unmatched += 1;
      } catch (error) {
        failures += 1;
        const title = sourceTitle(animes[index]);
        console.error(`TMDB indisponible pour la fiche ${animes[index].animeId} (${title}) : ${error.message}`);
        await collection.updateOne(
          { _id: animes[index]._id },
          { $set: { tmdbError: String(error.message).slice(0, 300), tmdbEnrichedAt: new Date() } },
        ).catch(() => undefined);
      }
      processed += 1;
      if (processed % 20 === 0 || processed === animes.length) {
        console.log(`FrAnime + TMDB : ${processed}/${animes.length} fiches traitées`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(WORKERS, animes.length) }, worker));
  console.log(`TMDB terminé — ${matched} enrichis, ${cached} déjà à jour, ${unmatched} sans correspondance exacte, ${failures} erreurs.`);
} finally {
  await client.close();
}
