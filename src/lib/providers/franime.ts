/**
 * Provider Franime (`franime.fr` + `api.franime.fr`), porté de
 * `gowaru-nuvio-providers/src/franime`.
 *
 * Chaîne :
 *  1. Recherche Kitsu (`kitsu.io/api/edge/anime?filter[text]=…`) : franime
 *     indexe les MÊMES identifiants Kitsu.
 *  2. GET /api/anime-seasons/{kitsuId} → saisons + épisodes, avec l'INDEX
 *     0-based de saison et d'épisode attendus par l'API lecteur.
 *  3. GET /api/anime/{id}/{saisonIndex}/{episodeIndex}/{vo|vf}/{lecteurIndex}
 *     → URL `franime.fr/watch2/?a=…` dont le paramètre `b` porte l'embed
 *     encodé (base64 → hex → XOR d'un octet unique, retrouvé par force brute).
 *
 * ⚠ Cloudflare protège les endpoints lecteurs : quand il répond un challenge
 * (403 « Just a moment… »), le provider rend 0 flux sans casser les autres.
 */


import { isDeadHost } from "./resolvers";
import { BASE_HEADERS, fetchText, normalizeTitle, slugifyTitle, titleWords, type ProviderContext, type ProviderStream } from "./types";

/**
 * Remakes condensés : leur épisode 1 correspond à un épisode ABSOLU précis de
 * la série d'origine (One Piece Log : Fish-Man Island Saga commence à 523).
 * Doit rester aligné sur la table du provider Anime-Sama.
 */
const REMAKE_ABSOLUTES: Record<string, number> = {
  "one-piece-log-fish-man-island-saga": 523,
};

/**
 * Fiches Franime du remake, par identifiant du site (`anime_id`).
 * `kitsuId` est la fiche d'affichage, `pageId` la fiche qui porte les
 * lecteurs : `/api/anime/<pageId>/0/<épisode>/<langue>/<lecteur>`.
 * On ne cherche PAS par titre : la recherche Kitsu ne remonte pas le remake et
 * retombait sur « One Piece », donc sur les épisodes de la série d'origine.
 */
const REMAKE_PAGES: Record<string, { kitsuId: string; pageId: string; episodes: number }> = {
  "one-piece-log-fish-man-island-saga": { kitsuId: "49281", pageId: "49281", episodes: 21 },
};

/**
 * Adaptations que Franime publie sous LEUR PROPRE fiche, alors que la
 * recherche par titre ramène celle de l'autre génération : la fiche 1997 de
 * Berserk (« Berserk (1997) Kenfu Denki Berserk ») recevait la fiche 2016
 * (Kitsu 11655), donc les épisodes de 2016. Clé = slug de la fiche catalogue,
 * avec l'année pour séparer deux adaptations de même titre.
 */
const EDITION_PAGES: Record<string, { kitsuId: string; pageId: string; episodes: number; from: number; to: number }> = {
  // Franime publie Berserk 1997 sous sa propre fiche (anime_id=157594765910),
  // différente de celle de 2016 (11655).
  "berserk-1997": { kitsuId: "157594765910", pageId: "157594765910", episodes: 25, from: 1997, to: 1997 },
  "berserk-2016": { kitsuId: "11655", pageId: "11655", episodes: 24, from: 2016, to: 2016 },
  // Franime publie Hunter x Hunter 1999 (kitsuId=115) et 2011 (kitsuId=6448)
  // sous leurs propres fiches. La recherche Kitsu ne les sépare pas bien.
  "hunter-x-hunter-1999": { kitsuId: "115", pageId: "115", episodes: 62, from: 1999, to: 1999 },
  "hunter-x-hunter-2011": { kitsuId: "6448", pageId: "6448", episodes: 148, from: 2011, to: 2011 },
};

const SITE = "https://franime.fr";
const API = "https://api.franime.fr/api/";
const KITSU = "https://kitsu.io/api/edge/anime?filter[text]=";
const API_HEADERS: Record<string, string> = {
  ...BASE_HEADERS,
  Accept: "application/json, text/plain, */*",
  // Le dépôt de référence envoie ces deux en-têtes exactement : l'API renvoie
  // sinon une réponse générique sans lien watch2.
  Referer: `${SITE}/`,
  Origin: SITE,
};
/** Assez de fiches pour écarter un remake/une suite qui n'a pas l'épisode. */
const MAX_CANDIDATES = 5;
const MAX_READERS = 6;
/** Assez de flux pour couvrir les deux langues (2 par langue). */
const MAX_STREAMS = 6;

type KitsuCandidate = { id: string; title: string; startYear?: number };

type FranimeEpisode = { number: number | null; title: string };

type FranimeSeason = {
  index: number;
  /** Identifiant à utiliser pour demander le lecteur (catalogue ≠ Kitsu). */
  apiId?: string;
  seasonNumber: number;
  title?: string;
  episodes: FranimeEpisode[];
  /** Lecteurs VO publiés pour chaque épisode de la saga, quand connus. */
  readers?: string[][];
  /** Langues réellement publiées par la saga (`lang.vo` / `lang.vf`). */
  languages?: { vo?: boolean; vf?: boolean };
};

/** Zone d'arcs (une saga Franime) pour le calcul de correspondance TMDB. */
type SagaZone = { number: number; title?: string; length: number };

/** Le dépôt de référence (FrenchAnime-Downloader) tente *tous* les paramètres,
 *  et accepte le base64 classique comme le base64url, avec ou sans padding. */
function normalizeBase64(value: string): string {
  const urlSafe = value.replace(/-/g, "+").replace(/_/g, "/");
  return urlSafe + "=".repeat((4 - (urlSafe.length % 4)) % 4);
}

function decodeWatchToken(value: string): string | null {
  try {
    const raw = normalizeBase64(value);
    const hex = Buffer.from(raw, "base64").toString("latin1");
    if (!hex || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
    const bytes = Buffer.from(hex, "hex");
    for (let key = 0; key < 256; key += 1) {
      let out = "";
      for (const byte of bytes) out += String.fromCharCode(byte ^ key);
      if (/^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[:/]|$)/i.test(out) && !/\s/.test(out)) return out;
    }
    return null;
  } catch {
    return null;
  }
}

function extractEmbedFromWatchUrl(finalUrl: string): string | null {
  const queryIndex = finalUrl.indexOf("?");
  if (queryIndex === -1) return null;
  const params = finalUrl.slice(queryIndex + 1).split("&").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return ["", ""] as const;
    const key = pair.slice(0, eq);
    let value = pair.slice(eq + 1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // garde la valeur brute
    }
    return [key, value] as const;
  });
  const direct = params.find(([key]) => key === "b");
  const decoded = direct ? decodeWatchToken(direct[1]) : null;
  if (decoded) return decoded;
  for (const [key, value] of params) {
    if (key === "b" || !value) continue;
    const candidate = decodeWatchToken(value);
    if (candidate) return candidate;
  }
  return null;
}

async function kitsuSearch(query: string, signal: AbortSignal): Promise<KitsuCandidate[]> {
  const page = await fetchText(`${KITSU}${encodeURIComponent(query)}&page%5Blimit%5D=6`, {
    signal,
    timeoutMs: 5_000,
    headers: { Accept: "application/vnd.api+json" },
  });
  if (!page?.ok) return [];
  try {
    const data = JSON.parse(page.text) as { data?: Array<{ id?: string; attributes?: { canonicalTitle?: string; titles?: Record<string, string>; startDate?: string | null } }> };
    return (data.data ?? [])
      .map((entry) => ({
        id: String(entry.id ?? ""),
        title: entry.attributes?.canonicalTitle ?? entry.attributes?.titles?.en ?? "",
        startYear: Number.parseInt(String(entry.attributes?.startDate ?? "").slice(0, 4), 10) || undefined,
      }))
      .filter((entry) => entry.id && entry.title);
  } catch {
    return [];
  }
}

/**
 * Une fiche ne doit pas être retenue sur un seul mot commun : « Naruto » ne
 * doit pas désigner « Naruto Shippuden », ni « One Piece » le remake Netflix.
 */
function scoreCandidate(candidate: KitsuCandidate, titles: string[], wantedYear?: string): number {
  const hay = normalizeTitle(candidate.title);
  if (!hay) return 0;
  let best = 0;
  for (const title of titles) {
    const wanted = normalizeTitle(title);
    if (!wanted) continue;
    if (hay === wanted) return yearBonus(candidate, wantedYear, 100);
    const words = titleWords(title);
    if (words.length === 0) continue;
    const hits = words.filter((word) => hay.includes(word)).length;
    const ratio = hits / words.length;
    // Un titre amputé (« Tamako Love Story » face à « Tamako Market : Love
    // Story (Film) », « Trinity Seven Movie 2 » face à « Trinity Seven :
    // Heavens Library & Crimson Lord (Film) ») garde peu de mots communs : le
    // score est pris dans les deux sens, et 2 mots communs suffisent quand le
    // début du titre correspond.
    const wantedWords = words;
    const hayWords = hay.split(" ").filter(Boolean);
    const hayHits = wantedWords.filter((word) => hay.includes(word)).length;
    const ratioHay = hayWords.length > 0 ? hayHits / hayWords.length : 0;
    const shared = Math.min(hits, hayHits);
    const sameStart = wantedWords[0] !== undefined && hayWords[0] !== undefined && wantedWords[0] === hayWords[0];
    if (sameStart && shared >= 2) best = Math.max(best, yearBonus(candidate, wantedYear, 70));
    if (Math.max(ratio, ratioHay) >= 0.6) best = Math.max(best, yearBonus(candidate, wantedYear, 70));
    // Titre trop différent : on ne retient pas ce candidat.
    if (best === 0) continue;
    // Une suite (« shippuden », « boruto »…) n'est pas la série demandée.
    // Une suite (« shippuden », « boruto »…) est pénalisée mais reste une
    // option : la saison/épisode demandés sont vérifiés juste après.
    const extra = hay.replace(wanted, "").replace(/[^a-z0-9]+/g, " ").trim();
    best = Math.max(best, yearBonus(candidate, wantedYear, extra.length === 0 ? 95 : 65));
  }
  return best;
}

/**
 * Deux adaptations d'une même série (Hunter x Hunter 1999 / 2011) portent le
 * même titre : c'est l'année de diffusion qui les sépare. Un candidat dont
 * l'année est éloignée de celle de la fiche TMDB est fortement pénalisé, et un
 * candidat dont l'année correspond est favorisé.
 */
function yearBonus(candidate: KitsuCandidate, wantedYear: string | undefined, score: number): number {
  const wanted = Number.parseInt(wantedYear ?? "", 10);
  if (!wanted || !candidate.startYear) return score;
  const gap = Math.abs(candidate.startYear - wanted);
  if (gap <= 1) return score + 10;
  if (gap >= 8) return score - 60;
  return score - gap * 3;
}

async function fetchSeasons(kitsuId: string, signal: AbortSignal): Promise<FranimeSeason[] | null> {
  const page = await fetchText(`${API}anime-seasons/${kitsuId}`, { signal, timeoutMs: 5_000, headers: API_HEADERS });
  if (!page?.ok) return null;
  try {
    const data = JSON.parse(page.text) as {
      episodeDetails?: Array<{ seasonNumber?: number; episodes?: Array<{ number?: number | string; title?: string }> }>;
    };
    const details = Array.isArray(data.episodeDetails) ? data.episodeDetails : [];
    const seasons = details.flatMap((season, index) => {
      const seasonNumber = Number(season.seasonNumber);
      const episodes = (season.episodes ?? []).map((episode) => ({
        number: Number.isFinite(Number(episode.number)) ? Number(episode.number) : null,
        title: typeof episode.title === "string" ? episode.title : "",
      }));
      if (!Number.isFinite(seasonNumber) || episodes.length === 0) return [];
      return [{ index, seasonNumber, episodes }];
    });
    return seasons.length > 0 ? seasons : null;
  } catch {
    return null;
  }
}

/**
 * Sagas telles que le catalogue les publie : `saisons[i].title` finit par le
 * numéro de saga (« Elbaf 12 ») et `episodes[0].title` porte le numéro absolu
 * (« Episode 1156 »). C'est la seule source qui décrit les arcs récents :
 * `anime-seasons` s'arrête à Egg Head et sert des numéros faux.
 */
type CatalogueEntry = { id?: number; title?: string; saisons?: Array<{ title?: string; episodes?: Array<{ title?: string }> }> };

/**
 * `api/animes` pèse 11 Mo et met ~1 s à répondre : on garde la réponse en
 * mémoire et on la partage. `content-length` sert de marqueur de fraîcheur.
 */
let catalogueCache: { length: string; at: number; data: CatalogueEntry[] } | null = null;
let cataloguePending: Promise<CatalogueEntry[] | null> | null = null;
const CATALOGUE_TTL_MS = 30 * 60_000;
const CATALOGUE_PATH = `${process.cwd()}/.cache-franime-animes.json`;

async function readCatalogueDisk(): Promise<CatalogueEntry[] | null> {
  try {
    const { readFile, stat } = await import("node:fs/promises");
    const info = await stat(CATALOGUE_PATH);
    if (Date.now() - info.mtimeMs > CATALOGUE_TTL_MS) return null;
    const text = await readFile(CATALOGUE_PATH, "utf8");
    return JSON.parse(text) as CatalogueEntry[];
  } catch {
    return null;
  }
}

async function writeCatalogueDisk(data: CatalogueEntry[]): Promise<void> {
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(CATALOGUE_PATH, JSON.stringify(data));
  } catch {
    // cache disque facultatif
  }
}

async function downloadCatalogue(): Promise<CatalogueEntry[] | null> {
  // Lecture dédiée : elle ne dépend pas du signal d'un provider (un premier
  // appel trop court laissait sinon un cache vide pour toute la session).
  const page = await fetchText(`${API}animes`, { signal: AbortSignal.timeout(40_000), timeoutMs: 35_000, headers: API_HEADERS });
  if (!page?.ok) return null;
  try {
    return JSON.parse(page.text) as CatalogueEntry[];
  } catch {
    return null;
  }
}

async function catalogueList(): Promise<CatalogueEntry[] | null> {
  const now = Date.now();
  if (catalogueCache && now - catalogueCache.at < CATALOGUE_TTL_MS) return catalogueCache.data;
  if (cataloguePending) return cataloguePending;
  const fromDisk = await readCatalogueDisk();
  if (fromDisk) {
    catalogueCache = { length: String(fromDisk.length), at: now, data: fromDisk };
    return fromDisk;
  }
  cataloguePending = (async () => {
    const data = await downloadCatalogue();
    cataloguePending = null;
    if (!data) return null;
    catalogueCache = { length: String(data.length), at: Date.now(), data };
    await writeCatalogueDisk(data);
    return data;
  })();
  return cataloguePending;
}

async function fetchCatalogueSagas(kitsuId: string, signal: AbortSignal, title?: string): Promise<FranimeSeason[] | null> {
  const list = await catalogueList();
  if (!list) return null;
  try {
    // L'identifiant du catalogue n'est pas toujours celui de Kitsu (Berserk
    // 1997 : Kitsu 24, catalogue 157594765910) : le titre sert de repli.
    const wanted = normalizeTitle(title ?? "");
    // Le listing donne des ids à 16 chiffres (7368739826737822) : `Number`
    // les arrondit, la comparaison numérique échouait donc toujours — et pire,
    // elle pouvait retomber sur une AUTRE fiche. On compare par texte.
    const fiche = list.find((entry) => String(entry.id) === String(kitsuId))
      ?? (wanted
        ? list.find((entry) => {
          const candidate = normalizeTitle(String(entry.title ?? ""));
          return candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate);
        })
        : undefined);
    const saisons = Array.isArray(fiche?.saisons) ? fiche!.saisons! : [];
    if (process.env.PROVIDER_DEBUG === "1") {
      const brut = (fiche as { saisons?: Array<{ title?: string; episodes?: Array<{ title?: string; lang?: unknown }> }> } | undefined)?.saisons ?? [];
      for (const saison of brut) {
        const ep = (saison.episodes ?? [])[0];
        console.log("[franime] brut", saison.title, "| ep0", JSON.stringify(ep));
      }
    }
    const sagas = saisons.flatMap((saison, position) => {
      const title = String(saison?.title ?? "");
      const episodes = (saison?.episodes ?? []).map((episode) => {
        const title = String(episode?.title ?? "");
        // « Episode 1156 » → 1156 ; « Épisode 1 » (numérotation locale à la
        // saga) → null : ce n'est pas un numéro de série entière.
        const match = /(\d{1,4})\s*$/.exec(title.trim());
        const absolute = match ? Number(match[1]) : NaN;
        return { number: Number.isFinite(absolute) ? absolute : null, title };
      });
      const readers = (saison?.episodes ?? []).map((episode) => {
        const vo = (episode as { lang?: { vo?: { lecteurs?: unknown } } }).lang?.vo?.lecteurs;
        return Array.isArray(vo) ? vo.filter((name): name is string => typeof name === "string") : [];
      });
      // Langues publiées : celles que TOUS les épisodes de la saga ont. Un
      // seul épisode sans lecteur VO ne suffit pas à publier la VO (le
      // listing annonce sinon de la VO pour Gravity Falls, qui n'a que de la
      // VF). On retombe sur la règle « au moins un épisode » seulement quand
      // la saga n'a aucun épisode renseigné.
      const languages = (saison?.episodes ?? []).reduce(
        (acc, episode) => {
          const raw = episode as {
            lang?: { vo?: { lecteurs?: unknown[] }; vf?: { lecteurs?: unknown[] } };
            playersVf?: unknown[];
            playersVo?: unknown[];
          };
          const vo = raw.lang?.vo?.lecteurs ?? raw.playersVo;
          const vf = raw.lang?.vf?.lecteurs ?? raw.playersVf;
          const hasVo = Array.isArray(vo) && vo.length > 0;
          const hasVf = Array.isArray(vf) && vf.length > 0;
          if (hasVo) acc.voAny = true;
          if (hasVf) acc.vfAny = true;
          if (!hasVo) acc.voAll = false;
          if (!hasVf) acc.vfAll = false;
          return acc;
        },
        { voAny: false, vfAny: false, voAll: true, vfAll: true } as {
          voAny: boolean; vfAny: boolean; voAll: boolean; vfAll: boolean;
        },
      );
      const languagesPublished = {
        vo: (saison?.episodes ?? []).length > 0 ? languages.voAll : false,
        vf: (saison?.episodes ?? []).length > 0 ? languages.vfAll : false,
      };
      if (process.env.PROVIDER_DEBUG === "1") {
        console.log(
          "[franime]", title, "→ langues publiées", JSON.stringify(languagesPublished),
          "| ep0 lang:", JSON.stringify(((saison?.episodes ?? [])[0] as Record<string, unknown> | undefined)?.lang ?? null),
          "| playersVf:", JSON.stringify(((saison?.episodes ?? [])[0] as Record<string, unknown> | undefined)?.playersVf ?? null),
        );
      }
      return episodes.length > 0
        ? [{ index: position, apiId: String(fiche?.id ?? kitsuId), seasonNumber: sagaNumberOf(title), title, episodes, readers, languages: languagesPublished }]
        : [];
    });
    return sagas.length > 0 ? sagas : null;
  } catch {
    return null;
  }
}

/** « Elbaf 12 » → 12 ; « Saison 2023 Live Action 0.5 » → 0.5 ; sinon NaN. */
function sagaNumberOf(title: string): number {
  const match = /(\d+(?:\.\d+)?)\s*$/.exec(title.trim());
  return match ? Number(match[1]) : NaN;
}

/**
 * Choisit la saga qui contient l'épisode demandé.
 *
 * Deux numérotations coexistent chez Franime : le catalogue en numéros
 * ABSOLUS (Elbaf : 1156…1180) et `anime-seasons` en numéros locaux à la saga.
 * On accepte donc les deux, en vérifiant toujours que la position existe.
 */
function pickEpisode(sagas: FranimeSeason[], absolute: number, relative: number): { saga: FranimeSeason; position: number } | null {
  // 1. Le numéro absolu est écrit dans le titre de l'épisode : le plus sûr.
  for (const saga of sagas) {
    const exact = saga.episodes.findIndex((episode) => episode.number === absolute);
    if (exact >= 0) return { saga, position: exact };
  }
  // 2. Numéros locaux : la taille de la saga doit couvrir le numéro demandé.
  for (const saga of sagas) {
    const local = saga.episodes.findIndex((episode) => episode.number === relative);
    if (local >= 0 && saga.episodes.length <= Math.max(absolute, 1) + saga.episodes.length) return { saga, position: local };
  }
  // 3. La position dans la saga, quand elle est dans les bornes.
  for (const saga of sagas) {
    const position = relative - 1;
    if (position >= 0 && position < saga.episodes.length && saga.episodes.length <= absolute) return { saga, position };
  }
  return null;
}

/**
 * `true` seulement si l'API sert réellement cet épisode dans cette langue.
 * Un 404 (« Aucun lecteur disponible pour cette animé / cette épisode ») veut
 * dire : pas de flux fiable, même si un appel ultérieur renvoyait une URL.
 */
async function languageAvailable(
  kitsuId: string,
  seasonIndex: number,
  episodeIndex: number,
  language: "vo" | "vf",
  signal: AbortSignal,
): Promise<boolean> {
  const page = await fetchText(`${API}anime/${kitsuId}/${seasonIndex}/${episodeIndex}/${language}/0`, {
    signal,
    timeoutMs: 5_000,
    headers: API_HEADERS,
  });
  if (!page) return false;
  const ok = page.ok && page.text.trim().startsWith("http");
  if (process.env.PROVIDER_DEBUG === "1") {
    console.log("[franime] dispo", kitsuId, seasonIndex, episodeIndex, language, "→", page.status, "ok:", ok);
  }
  return ok;
}

async function resolveReader(
  kitsuId: string,
  seasonIndex: number,
  episodeIndex: number,
  language: "vo" | "vf",
  readerIndex: number,
  signal: AbortSignal,
): Promise<string | null> {
  const page = await fetchText(`${API}anime/${kitsuId}/${seasonIndex}/${episodeIndex}/${language}/${readerIndex}`, {
    signal,
    timeoutMs: 5_000,
    headers: API_HEADERS,
  });
  if (!page?.ok) return null;
  const target = page.text.trim();
  if (!target.startsWith("http")) return null;
  // L'API peut répondre directement une URL d'hébergeur (pas de /watch2).
  if (!target.includes("/watch2")) {
    const decodedDirect = extractEmbedFromWatchUrl(target);
    return decodedDirect ?? target;
  }
  const embedded = extractEmbedFromWatchUrl(target);
  if (embedded) return embedded;
  const followed = await fetchText(target, { signal, timeoutMs: 5_000, headers: API_HEADERS });
  if (!followed) return null;
  // Redirection manuelle : l'URL finale est dans l'en-tête Location.
  const finalUrl = followed.location && /^https?:\/\//i.test(followed.location) ? followed.location : followed.url;
  return extractEmbedFromWatchUrl(finalUrl);
}

function playerLabel(url: string): string {
  const host = /^https?:\/\/([^/]+)/i.exec(url)?.[1]?.replace(/^www\./, "") ?? "lecteur";
  return host.split(".")[0] ?? host;
}

/**
 * Clé d'une adaptation datée : « berserk-1997 ». Deux générations partagent le
 * même titre, seule l'année les sépare.
 */
function editionKey(ctx: ProviderContext): string {
  const year = Number.parseInt(String(ctx.firstAirDate ?? ctx.year ?? "").slice(0, 4), 10);
  // Le titre du catalogue peut porter un sous-titre (« Berserk (1997) Kenfu
  // Denki Berserk ») : on part du titre le PLUS COURT, qui est le nom de la
  // série. L'année est indispensable : deux générations partagent ce nom.
  // `.filter(Boolean)` AVANT le slug : un titre japonais se normalise en
  // chaîne vide et devenait la clé la plus courte.
  const slugs = (ctx.titles ?? []).concat(ctx.exactTitle ? [ctx.exactTitle] : []).filter(Boolean).map((value) => slugifyTitle(String(value)));
  const shortest = [...new Set(slugs)].filter(Boolean).sort((a, b) => a.length - b.length)[0] ?? "";
  return Number.isFinite(year) ? `${shortest}-${year}` : shortest;
}

/** Identifiant de fiche provider (slug) porté par le contexte, s'il existe. */
function slugOf(ctx: ProviderContext): string {
  // Titre exact du catalogue : c'est la clé des tables ci-dessus. Le titre
  // le PLUS COURT est le nom de la série (le catalogue peut y accoler un
  // sous-titre : « Berserk (1997) Kenfu Denki Berserk »).
  const slugs = (ctx.titles ?? []).concat(ctx.exactTitle ? [ctx.exactTitle] : []).filter(Boolean).map((value) => slugifyTitle(String(value)));
  return [...new Set(slugs)].filter(Boolean).sort((a, b) => a.length - b.length)[0] ?? "";
}

/**
 * Sert la fiche remake de Franime : elle publie sa propre saison (21 épisodes),
 * et la recherche par titre ne la remonte pas (elle retombait sur « One
 * Piece », donc sur les épisodes de la série d'origine). On l'appelle AVANT
 * toute recherche.
 */
async function extractRemakeStreams(
  ctx: ProviderContext,
  page: { kitsuId: string; pageId: string; episodes: number },
): Promise<ProviderStream[]> {
    const debug = process.env.PROVIDER_DEBUG === "1";
    const shown = ctx.mediaType === "movie" ? 1 : Number(ctx.relativeEpisode ?? ctx.episode ?? 1);
    const position = Math.max(1, Math.min(shown || 1, page.episodes));
    const wanted = ctx.mediaType === "movie" ? 1 : ctx.season ?? 1;
    const streams: ProviderStream[] = [];
    const remakeCandidate: KitsuCandidate & { score: number } = {
      id: page.kitsuId,
      title: ctx.titles[0] ?? "",
      score: 100,
    };
    if (debug) console.log("[franime] fiche remake", remakeCandidate.id, "épisode affiché", position);
    for (const language of ["vf", "vo"] as const) {
      if (ctx.signal.aborted) break;
      const served = await languageAvailable(page.pageId, 0, position - 1, language, ctx.signal);
      if (debug) console.log("[franime] remake →", language, served ? "servie" : "absente");
      if (!served) continue;
      for (let reader = 0; reader < MAX_READERS; reader += 1) {
        if (ctx.signal.aborted) break;
        const embed = await resolveReader(page.pageId, 0, position - 1, language, reader, ctx.signal);
        if (debug) console.log("[franime] remake lecteur", reader, "→", embed ? String(embed).slice(0, 70) : "aucun");
        if (!embed) break;
        if (streams.some((stream) => stream.url === embed)) continue;
        streams.push({
          url: embed,
          provider: "franime",
          source: `Franime · ${playerLabel(embed)}`,
          language: language === "vf" ? "vf" : "vostfr",
          title: `${remakeCandidate.title} S${wanted}E${position} ${language === "vf" ? "VF" : "VOSTFR"}`,
          // Un film n'a pas de saison : le lecteur ne doit afficher aucun numéro.
          seasonNumber: ctx.mediaType === "movie" ? undefined : wanted,
          episodeNumber: position,
          providerSeason: wanted,
          providerEpisode: position,
          tmdbSeason: wanted,
          tmdbEpisode: position,
        });
        if (streams.length >= MAX_STREAMS) break;
      }
      if (streams.length >= MAX_STREAMS) break;
    }
    return streams;
  return streams;
}

export async function extractFranimeStreams(ctx: ProviderContext): Promise<ProviderStream[]> {
  // Remake connu : sa fiche est servie en direct, sans passer par la recherche
  // (qui ne la trouve pas et servirait la série d'origine).
  const remakePage = REMAKE_PAGES[slugOf(ctx)];
  if (remakePage) return extractRemakeStreams(ctx, remakePage);
  if (process.env.PROVIDER_DEBUG === "1") console.log("[franime] clé", JSON.stringify(editionKey(ctx)), "| exact", JSON.stringify(ctx.exactTitle), "| titles", JSON.stringify(ctx.titles));
  const editionPage = EDITION_PAGES[editionKey(ctx)];
  if (editionPage) return extractRemakeStreams(ctx, editionPage);
  // Franime nomme les adaptations par leur année (« Berserk 1997 ») : on
  // cherche aussi avec elle, sinon la fiche 1997 n'est jamais proposée.
  const year = Number.parseInt(ctx.year ?? "", 10);
  const base = ctx.titles.slice(0, 3).filter(Boolean);
  const queries = Number.isFinite(year) && year > 1949
    ? [...base, ...base.map((title) => `${title} ${year}`)]
    : base;
  // Le catalogue marque les films d'un suffixe (« Tamako Market : Love Story
  // (Film) ») que Kitsu ne connaît pas : la recherche exacte ne trouve rien.
  // On cherche donc aussi les titres débarrassés du marqueur de format.
  const queriesFull = [...new Set([
    ...queries,
    ...queries.map((title) => title.replace(/\s*[:(]?\s*(?:film|movie)\s*\)?\s*$/i, "").trim()),
    ...queries.map((title) => title.replace(/\s*[:(]\s*(?:film|movie)\s*\)\s*$/i, "").trim()),
  ].filter((title) => title.length > 2))];
  const candidates: Array<KitsuCandidate & { score: number }> = [];
  /** Titres déjà acceptés : une seule fiche par adaptation. */
  const acceptedTitles = new Set<string>();
  for (const query of queriesFull) {
    if (ctx.signal.aborted) break;
    const results = await kitsuSearch(query, ctx.signal);
    for (const result of results) {
      if (candidates.some((entry) => entry.id === result.id)) continue;
      const score = scoreCandidate(result, ctx.titles.length > 0 ? ctx.titles : [query], ctx.year);
      if (process.env.PROVIDER_DEBUG === "1" && /tamako|trinity|given/i.test(result.title ?? "")) {
        console.log("[franime] éval", JSON.stringify(result.title), "score", score, "exact", JSON.stringify(ctx.exactTitle));
      }
      if (score < 60) continue;
      // Même règle : la fiche retenue doit porter le titre exact du catalogue,
      // sinon « One Piece Log » servirait les épisodes de « One Piece ».
      const exact = ctx.exactTitle ? ctx.exactTitle.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
      const hay = (result.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      // Sans le marqueur « (Film) », la comparaison se fait sur le titre nu :
      // « Given Movie » ↔ « Given: The Movie », « Tamako Love Story » ↔
      // « Tamako Market : Love Story (Film) ».
      const bare = (text: string) => text
        .replace(/\b(film|movie)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      const exactBare = bare(exact);
      const hayBare = bare(hay);
      // Le titre du catalogue peut être plus LONG que celui du site
      // (« Tamako Market : Love Story (Film) » face à « Tamako Love Story »)
      // et les deux sens comptent : même début + 2 mots communs suffisent.
      const wordsA = exactBare.split(" ").filter(Boolean);
      const wordsB = hayBare.split(" ").filter(Boolean);
      const common = wordsA.filter((word) => wordsB.includes(word)).length;
      const sameHead = Boolean(wordsA[0] && wordsB[0] && wordsA[0] === wordsB[0]);
      const closeEnough = Boolean(exactBare && hayBare)
        && (hayBare.includes(exactBare) || exactBare.includes(hayBare)
          || exactBare.split(" ").every((word) => hayBare.includes(word))
          || (sameHead && common >= 2));
      if (exact && hay && !hay.includes(exact) && !exact.includes(hay) && !closeEnough) continue;
      // Deux fiches au même titre (« One Piece », « One Piece ») sont deux
      // adaptations distinctes : on ne mélange pas leurs lecteurs, sinon la
      // série d'origine est servie à la place du remake.
      const label = (result.title ?? "").trim().toLowerCase();
      if (label && acceptedTitles.has(label)) continue;
      if (label) acceptedTitles.add(label);
      candidates.push({ ...result, score });
    }
    if (candidates.length >= 4) break;
  }
  if (candidates.length === 0) return [];

  const wantedSeason = ctx.mediaType === "movie" ? 1 : ctx.season ?? 1;
  // `ctx.episode` arrive déjà en numéro absolu (1156 pour l'épisode 1 d'Elbaf) ;
  // `ctx.relativeEpisode` est le numéro affiché (1), qui sert à retrouver la
  // bonne saga quand la numérotation absolue est ambiguë.
  const shownEpisode = ctx.mediaType === "movie" ? 1 : ctx.episode ?? 1;
  const relativeEpisode = ctx.mediaType === "movie" ? 1 : Number(ctx.relativeEpisode ?? shownEpisode);
  // Les fiches alignées sur Franime numérotent en continu (saison 23 → 1156).
  // C'est ce numéro absolu qu'il faut chercher dans les sagas Franime ; sans
  // lui, on essaie le numéro relatif affiché.
  // Remakes condensés (One Piece Log : Fish-Man Island Saga) : leur épisode 1
  // correspond à l'épisode absolu où l'arc commence dans la série d'origine.
  // Ce décalage ne s'applique QU'À la fiche du remake (courte) : la série
  // d'origine sert la saison 14 à sa place normale.
  // ⚠ `ctx.absoluteEpisode` porte DÉJÀ le numéro absolu voulu (l'API ajoute le
  // décalage du remake) : le ré-ajouter ici donnait 1045 au lieu de 523.
  const wantedEpisode = ctx.mediaType === "movie"
    ? 1
    : (Number.isFinite(Number(ctx.absoluteEpisode)) && Number(ctx.absoluteEpisode) > 0
      ? Number(ctx.absoluteEpisode)
      : shownEpisode);

  const debug = process.env.PROVIDER_DEBUG === "1";
  const ordered = candidates.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
  if (debug) console.log("[franime] candidats", ordered.map((entry) => `${entry.score}:${entry.id}:${entry.title}`));

  for (const candidate of ordered) {
    if (ctx.signal.aborted) break;
    // Le catalogue liste TOUS les arcs (« Elbaf 12 » compris) : c'est lui qui
    // dit combien d'épisodes fait chaque saga. `anime-seasons` s'arrête à Egg
    // Head et renvoie des numéros qui repartent de 1 à chaque saga.
    const catalogue = await fetchCatalogueSagas(candidate.id, ctx.signal, candidate.title);
    const listing = await fetchSeasons(candidate.id, ctx.signal);
    if (debug) console.log("[franime] ids", candidate.id, catalogue ? "catalogue ok" : "catalogue absent", listing ? "listing ok" : "listing absent");
    if (debug && listing) {
      console.log("[franime] listing langues", JSON.stringify(listing.map((saga) => ({ t: saga.title, l: saga.languages }))));
    }
    // `catalogue` peut revenir vide (fiche absente de `api/animes`) : on prend
    // alors `anime-seasons`, sinon la fiche est abandonnée à tort. Si le
    // catalogue ne connaît que des sagas sans numéro exploitable, on garde
    // les deux et on choisit plus bas.
    const sagas = (catalogue && catalogue.length > 0) ? catalogue : (listing ?? []);
    const both = [catalogue ?? [], listing ?? []].filter((entry) => entry.length > 0);
    if (debug) console.log("[franime]", candidate.title, "catalogue", catalogue?.length ?? "null", "| anime-seasons", listing?.length ?? "null");

    // On retrouve la MÊME zone que la fiche : les sagas Franime sont mises
    // bout à bout pour donner le numéro absolu de chacun de leurs épisodes,
    // puis on convertit la saison TMDB (qui découpe autrement : sa S7 est
    // G-8 / Long Ring Long Land, la saga 7 est Iles des Hommes-Poissons).
    // On retrouve la SAGA qui contient le numéro absolu de la fiche : les
    // sagas Franime sont mises bout à bout, chacune partant là où la
    // précédente s'arrête (la S7 de TMDB, arc de Foxy, tombe donc dans la saga
    // 3 et non dans « Iles des Hommes-Poissons », qui est la saga 7).
    // L'épisode est retrouvé par le numéro ABSOLU écrit dans le titre de
    // chaque épisode (« Episode 1156 ») : c'est la seule numérotation continue
    // de Franime. Additionner les longueurs de sagas ne marche pas (la 1re
    // entrée est le live action, et les arcs se chevauchent).
    const absoluteOf = (episode: FranimeEpisode | undefined): number | null => {
      const match = /(\d{1,4})\s*$/.exec(String(episode?.title ?? ""));
      const value = Number(match?.[1]);
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    let zoneIndex: number | null = null;
    let zoneEpisode = 1;
    for (const [position, saga] of sagas.entries()) {
      // Une saga sans numéro lisible (épisodes « Épisode 1 » du live action)
      // ne peut pas porter le numéro absolu cherché : on l'ignore.
      if (!saga.episodes.some((entry) => absoluteOf(entry) !== null)) continue;
      const found = saga.episodes.findIndex((entry) => absoluteOf(entry) === wantedEpisode);
      if (found >= 0) {
        zoneIndex = position;
        zoneEpisode = found + 1;
        break;
      }
    }
    // Repli : la saga dont la plage de titres couvre le numéro demandé.
    if (zoneIndex === null) {
      for (const [position, saga] of sagas.entries()) {
        const numbers = saga.episodes.map(absoluteOf).filter((value): value is number => value !== null);
        if (numbers.length === 0) continue;
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);
        if (wantedEpisode >= min && wantedEpisode <= max) {
          zoneIndex = position;
          zoneEpisode = wantedEpisode - min + 1;
          break;
        }
      }
    }
    const relative = zoneIndex === null
      ? (Number.isFinite(relativeEpisode) && relativeEpisode > 0 ? relativeEpisode : wantedEpisode)
      : zoneEpisode;

    let picked: { saga: FranimeSeason; position: number } | null = null;
    if (zoneIndex !== null && sagas[zoneIndex]) {
      const saga = sagas[zoneIndex];
      const position = relative - 1;
      if (position >= 0 && position < saga.episodes.length) picked = { saga, position };
    }
    // Repli : saga qui se présente comme la série entière, avec les numéros
    // locaux de ses épisodes. Une fiche qui n'a qu'une saga de 25 épisodes
    // (« Berserk (1997) ») ne peut pas être confondue avec la série de 2016.
    if (!picked) {
      // La saga qui contient le plus d'épisodes : la fiche de la série, et non
      // un film ou un récapitulatif publié à côté (Berserk : 25, 1, 1).
      for (const pool of both) {
        const main = [...pool].sort((a, b) => b.episodes.length - a.episodes.length)[0];
        if (main && relative >= 1 && relative <= main.episodes.length) {
          picked = { saga: main, position: relative - 1 };
          break;
        }
      }
    }
    if (!picked && sagas.length > 0) {
      // Dernier recours : la saga de même position que la saison TMDB.
      const regular = sagas.filter((entry) => entry.seasonNumber >= 1);
      const fallback = regular[Math.min((ctx.season ?? 1) - 1, regular.length - 1)] ?? sagas[0];
      const position = Math.max(0, Math.min(relative, fallback.episodes.length) - 1);
      picked = { saga: fallback, position };
    }
    if (!picked) {
      if (debug) console.log("[franime]", candidate.title, "aucune saga pour l'épisode", wantedEpisode);
      continue;
    }
    const season = picked.saga;
    const episodeIndex = picked.position;
    if (debug) {
      console.log("[franime]", candidate.title, "→ saga", season.title ?? season.seasonNumber,
        "index", season.index, "épisode index", episodeIndex,
        "lecteurs", (season.readers?.[episodeIndex] ?? []).join("+") || "?");
    }

    // Une langue absente du catalogue ne doit pas être demandée : l'API
    // répond alors un lecteur d'une AUTRE langue (VF demandée → flux VO), donc
    // un flux dont la langue affichée est fausse. On ne tente que ce que la
    // saga publie vraiment.
    const availableLanguages = new Set<"vf" | "vo">();
    for (const readers of season.readers ?? []) {
      if (readers.length > 0) availableLanguages.add("vo");
    }
    if (season.languages?.vf) availableLanguages.add("vf");
    if (season.languages?.vo) availableLanguages.add("vo");
    const streams: ProviderStream[] = [];
    /**
     * Langues que ce candidat sert vraiment. L'API Franime répond 200 avec une
     * URL pour une langue qui n'existe pas (Gravity Falls n'a pas de VOSTFR :
     * demander `vo` renvoie un flux d'une autre série). Une langue dont le
     * PREMIER lecteur répond « animé » inconnue est donc refusée en bloc.
     */
    const perLanguage: Record<string, number> = { vf: 0, vostfr: 0 };
    // Sans information de langue, on ne tente QUE la VO : c'est ce que le
    // catalogue publie par défaut, et une VF demandée à tort renvoie un flux
    // d'une autre série.
    const languagesToTry = availableLanguages.size > 0
      ? (["vf", "vo"] as const).filter((item) => availableLanguages.has(item))
      : (["vo"] as const);
    for (const language of languagesToTry) {
      // La VF de Gravity Falls n'existe pas : l'API répond alors les lecteurs
      // VO en boucle, étiquetés « VF » (une autre série). Une langue que la
      // saga ne publie pas n'est JAMAIS demandée.
      if (!availableLanguages.has(language)) continue;
      // La langue doit exister POUR CET ÉPISODE : l'API répond sinon 404, ou
      // pire, renvoie une URL pointant sur une autre série (Gravity Falls n'a
      // pas de VOSTFR). On ne garde donc que ce que l'API sert vraiment.
      const served = await languageAvailable(
        season.apiId ?? candidate.id,
        season.index,
        episodeIndex,
        language,
        ctx.signal,
      );
      if (debug) console.log("[franime]", candidate.title, "→", language, served ? "servie" : "absente");
      if (!served) {
        if (debug) console.log("[franime]", candidate.title, "→", language, "absente pour cet épisode, ignorée");
        continue;
      }
      for (let reader = 0; reader < MAX_READERS; reader += 1) {
        if (ctx.signal.aborted) break;
        const embed = await resolveReader(season.apiId ?? candidate.id, season.index, episodeIndex, language, reader, ctx.signal);
        if (process.env.PROVIDER_DEBUG === "1") {
          console.log("[franime]", candidate.title, "| langue demandée", language, "| lecteur", reader, "→", embed ? String(embed).slice(0, 70) : "aucun");
        }
        if (!embed) break;

        // Hébergeur mort (sibnet répond 403 hors navigateur, sendvid, dood…) :
        // inutile de le proposer, le résolveur le jetterait et la fiche
        // ressortirait « aucune source » alors que d'autres lecteurs existent
        // plus loin dans la liste. On passe au lecteur suivant.
        if (isDeadHost(embed)) {
          if (process.env.PROVIDER_DEBUG === "1") console.log("[franime]", candidate.title, "| lecteur", reader, "mort, ignoré");
          continue;
        }
        if (streams.some((stream) => stream.url === embed)) continue;
        streams.push({
          url: embed,
          provider: "franime",
          source: `Franime · ${playerLabel(embed)}`,
          language: language === "vf" ? "vf" : "vostfr",
          title: `${candidate.title} S${wantedSeason}E${wantedEpisode} ${language === "vf" ? "VF" : "VOSTFR"}`,
          seasonNumber: ctx.mediaType === "movie" ? undefined : season.seasonNumber,
          episodeNumber: wantedEpisode,
          providerSeason: ctx.mediaType === "movie" ? undefined : season.seasonNumber,
          providerEpisode: wantedEpisode,
          tmdbSeason: wantedSeason,
          tmdbEpisode: wantedEpisode,
        });
        const key = language === "vf" ? "vf" : "vostfr";
        perLanguage[key] = (perLanguage[key] ?? 0) + 1;
        // 4 lecteurs vivants par langue : il en faut plusieurs pour que
        // l'utilisateur puisse lire même si l'un des hébergeurs tombe.
        if (perLanguage[key] >= 4) break;
        if (streams.length >= MAX_STREAMS) break;
      }
      if (streams.length >= MAX_STREAMS) break;
    }
    if (streams.length > 0) return streams;
  }

  return [];
}
