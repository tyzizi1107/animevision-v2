/**
 * Provider Anime-Sama (`animes-sama.fr`), porté de
 * `gowaru-nuvio-providers/src/anime-sama`.
 *
 * Chaîne (vérifiée en live) :
 *  1. POST /ajax/search.php { query }            → liens /catalogue/{slug}
 *  2. GET  /catalogue/{slug}                     → liens /catalogue/{slug}/{saisonN|film}/{lang}
 *  3. GET  /catalogue/{slug}/{saisonN}/{lang}    → window.__EPISODE_NUMBERS,
 *     `var epsN = [...]` (disponibilité par lecteur) et `window.__PROFILE.csrf`
 *  4. POST /api/player/sign/{slug}/{saisonN}/{lang} { ep, lecteur } + X-CSRF-Token
 *     + cookie PHPSESSID → URL signée /player/…
 *  5. GET {url signée} → `data-fallback-url` → 302 vers l'embed hébergeur
 *     (ansembed, sibnet…), résolu ensuite par `resolvers.ts`.
 */

import {
  BASE_HEADERS,
  cookieHeaderFor,
  fetchText,
  normalizeTitle,
  slugifyTitle,
  titleWords,
  type ProviderContext,
  type ProviderStream,
} from "./types";

const BASE_URL = "https://animes-sama.fr";
/**
 * Certaines saisons n'existent pas sur le miroir principal mais bien sur le
 * domaine officiel (« saison1hs », le remake One Piece Log) : on bascule sur
 * le domaine qui publie vraiment la page. Vérifié une fois par chemin.
 */
const BASE_ALTERNATE = "https://anime-sama.to";
const alternatePaths = new Map<string, boolean>();

async function resolveSeasonBase(path: string, signal: AbortSignal): Promise<string> {
  const known = alternatePaths.get(path);
  if (known === true) return BASE_ALTERNATE;
  if (known === false) return BASE_URL;
  // `redirect: "manual"` : le domaine officiel répond 301 vers son URL à
  // barre oblique finale, on doit la suivre pour lire la vraie page.
  const probe = await fetchText(`${BASE_ALTERNATE}/catalogue/${path}/`, {
    signal,
    timeoutMs: 5_000,
    redirect: "follow",
  });
  // Une redirection douce vers une autre saison (saison1hs → saison1) rend
  // une page valide mais SANS les épisodes du remake : on vérifie aussi que
  // la page porte bien la saison demandée.
  // `fiche/saison1hs/vostfr` → « saison1hs ».
  const parts = path.split("/").filter(Boolean);
  const seasonSegment = parts.length >= 2 ? parts[parts.length - 2]! : "";
  // Le domaine officiel publie cette page sans jeton CSRF (il est injecté
  // côté navigateur) : on ne peut PAS exiger `csrf:` ici, seulement la saison.
  // La page doit exister ET porter les épisodes de la saison demandée : le
  // marqueur `selected` du menu n'est pas fiable (il manque sur les pages
  // d'édition, d'où une édition déclarée absente à tort).
  const ok = Boolean(probe && probe.status < 400 && probe.text.length > 5_000
    && (new RegExp(`<option value="[^"]*/${seasonSegment}/[^"]*"`, "i").test(probe.text)
      || /var\s+eps1\s*=\s*\[/.test(probe.text)));
  if (process.env.PROVIDER_DEBUG === "1") {
    console.log("[anime-sama] sonde", path, "| segment", seasonSegment, "|", probe ? `${probe.status}/${probe.text.length}` : "null", "| ok:", ok);
  }
  alternatePaths.set(path, ok);
  return ok ? BASE_ALTERNATE : BASE_URL;
}
const MAX_READERS = 4;
const MAX_CANDIDATES = 4;
const MAX_SEARCH_QUERIES = 2;
/**
 * Décalage constaté entre la numérotation TMDB et celle du site, par fiche.
 * « naruto » : Anime-Sama découpe l'épisode 1 en deux (intro + épisode), donc
 * son numéro N+1 correspond à l'épisode N de TMDB.
 */
const EPISODE_OFFSETS: Record<string, number> = {};

/**
 * Plusieurs adaptations d'une même série sous une seule fiche : « Hunter x
 * Hunter » (1999 et 2011). La fiche mélange les deux générations ; quand la
 * fiche TMDB n'a qu'une saison, on privilégie la bonne génération.
 *   year  → année de la fiche TMDB
 *   from  → première année de la génération visée
 */
const GENERATIONS: Record<string, { year: number; from: number; to: number }> = {
  "hunter-x-hunter": { year: 2011, from: 2011, to: 9999 },
};

/**
 * Adaptations distinctes sous un même slug. Anime-Sama ne publie que la
 * version 2011 de Hunter x Hunter ; la fiche 1999 doit donc être servie par
 * Franime, sinon ses épisodes renvoient les flux de 2011.
 */
/**
 * Remakes condensés dont le numéro d'épisode ne correspond PAS à celui de la
 * série d'origine : ils portent sur un arc précis, pas sur la totalité.
 *
 * One Piece Log: Fish-Man Island Saga (2024, 21 ép.) est une rediffusion de
 * l'arc Île des Hommes-Poissons. Son épisode 1 ne doit pas pointer sur
 * l'épisode 1 d'Anime-Sama ni de Franime, mais sur le premier épisode de
 * l'arc dans la série d'origine (source map `episode` → saga, épisode).
 */
const REMAKE_ABSOLUTES: Record<string, number> = {
  // Le remake commence à l'épisode 523 de la série d'origine (= l'arc Île des
  // Hommes-Poissons, 21 épisodes jusqu'à 543 inclus).
  "one-piece-log-fish-man-island-saga": 523,
};

/**
 * Saison du site qui porte RÉELLEMENT le remake, quand elle ne s'appelle pas
 * `saison<N>` : sur la fiche One Piece, le Log Fish-Man est la saison
 * `saison1hs` (« One Piece Log: Fish-Man Island Saga », 21 épisodes). Sans
 * cette table, la recherche par numéro absolu tombait sur la saga 7 (Île des
 * Hommes-Poissons, série d'origine) — une autre édition du même arc.
 */
const REMAKE_SITE_SEASONS: Record<string, { page: string; episodes: number }> = {
  // La saison du remake vit sur la fiche « one-piece », sous le nom
  // `saison1hs` (page vérifiée : 21 épisodes, 4 lecteurs).
  "one-piece-log-fish-man-island-saga": { page: "one-piece/saison1hs", episodes: 21 },
};

/**
 * Slugs plausibles pour la fiche, du plus court au plus long : le site nomme
 * ses fiches par le nom de série (« berserk »), pas par le titre complet du
 * catalogue. Un titre japonais se normalise en chaîne vide : écarté.
 */
function shortSlugs(ctx: ProviderContext): string[] {
  const slugs = (ctx.titles ?? []).concat(ctx.exactTitle ? [ctx.exactTitle] : [])
    .filter(Boolean)
    .map((value) => slugifyTitle(String(value)))
    .filter(Boolean);
  return [...new Set(slugs)].sort((a, b) => a.length - b.length).slice(0, 3);
}

/** Nombre total d'épisodes des fiches « remake » (21 pour le Log Fish-Man). */
function isRemakeFiche(ctx: ProviderContext): boolean {
  return (ctx.totalEpisodes ?? 0) > 0 && (ctx.totalEpisodes ?? 0) <= 30
    && (ctx.seasonLengths ?? []).length <= 2;
}

/**
 * Les sites ne publient que les films : quand un titre de film apparaît deux
 * fois, il faut choisir le bon par la table ci-dessous, indexée par titre.
 */
const FILM_MOVIE_PAGES: Record<string, { slug: string; index: number; count: number }> = {
  // One Piece — ordre de la saison « film » d'Anime-Sama (17 films).
  "one-piece": { slug: "one-piece", index: 1, count: 17 },
  naruto: { slug: "naruto", index: 1, count: 3 },
  "naruto-shippuden": { slug: "naruto-shippuden", index: 1, count: 7 },
  "hunter-x-hunter": { slug: "hunter-x-hunter", index: 1, count: 2 },
  "my-hero-academia": { slug: "my-hero-academia", index: 1, count: 4 },
};

/**
 * Page « film » du site pour un film précis : la page ne donne pas les titres,
 * seulement des positions. La clé est le titre exact de la fiche catalogue, la
 * valeur la position du film sur la page (vérifiée sur le site).
 */
const FILM_POSITIONS: Record<string, { slug: string; index: number }> = {
  // Ordre officiel des pages « film » (liste `newSPF`), position = 1…N :
  //   one-piece        : 1 Le Film, 2 L'Île de l'Horloge, 3 Chopper, 4 Dead End,
  //                      5 Épée Sacrée, 6 Omatsuri, 7 Mecha, 8 Alabasta,
  //                      9 Chopper+, 10 Strong World, 11 Skypiea, 12 3D,
  //                      13 Z, 14 3D2Y, 15 Gold, 16 Stampede, 17 RED
  //   naruto-shippuden : 1 Un Funeste Présage, 2 Les Liens, 3 La Flamme de la
  //                      Volonté, 4 La Tour Perdue, 5 Blood Prison,
  //                      6 Road to Ninja, 7 The Last
  //   naruto           : 1 Princesse des neiges, 2 Pierre de Guelel, 3 Pays de la Lune
  //   hunter-x-hunter  : 1 Phantom Rouge, 2 The Last Mission
  //   my-hero-academia : 1 Two Heroes, 2 Heroes Rising, 3 World Heroes Mission,
  //                      4 You're Next
  "one piece red": { slug: "one-piece", index: 17 },
  "one piece z": { slug: "one-piece", index: 13 },
  "one piece gold": { slug: "one-piece", index: 15 },
  "one piece strong world": { slug: "one-piece", index: 10 },
  "gekijouban one piece stampede": { slug: "one-piece", index: 16 },
  "one piece stampede": { slug: "one-piece", index: 16 },
  "one piece le": { slug: "one-piece", index: 1 },
  "one piece 2 nejimaki jima no daibouken": { slug: "one-piece", index: 2 },
  "one piece 3 chinjuu jima no chopper oukoku": { slug: "one-piece", index: 3 },
  "one piece 4 dead end no bouken": { slug: "one-piece", index: 4 },
  "one piece 5 norowareta seiken": { slug: "one-piece", index: 5 },
  "one piece 6 omatsuri danshaku to himitsu no shima": { slug: "one-piece", index: 6 },
  "one piece 7 karakuri jou no mecha kyohei": { slug: "one-piece", index: 7 },
  "one piece 8 episode of alabasta sabaku no oujo to kaizoku tachi": { slug: "one-piece", index: 8 },
  "one piece 9 episode of chopper plus fuyu ni saku kiseki no sakura": { slug: "one-piece", index: 9 },
  "one piece 3d mugiwara chase": { slug: "one-piece", index: 12 },
  "one piece 3d a la poursuite du chapeau de paille": { slug: "one-piece", index: 12 },
  "one piece episode de skypiea": { slug: "one-piece", index: 11 },
  "one piece episode de chopper le miracle des cerisiers en hiver": { slug: "one-piece", index: 9 },
  "one piece le royaume de chopper l etrange ile des animaux": { slug: "one-piece", index: 3 },
  "naruto shippuden les liens": { slug: "naruto-shippuden", index: 2 },
  "naruto shippuden 2 les liens": { slug: "naruto-shippuden", index: 2 },
  "naruto the ninja clash in the land of snow": { slug: "naruto", index: 1 },
  "naruto et la princesse des neiges": { slug: "naruto", index: 1 },
  "hunter x hunter 1 phantom rouge": { slug: "hunter-x-hunter", index: 1 },
  "hunter x hunter 2 the last mission": { slug: "hunter-x-hunter", index: 2 },
  "boku no hero academia the two heroes": { slug: "my-hero-academia", index: 1 },
  "boku no hero academia the 2 heroes rising": { slug: "my-hero-academia", index: 2 },
  "boku no hero academia the world heroes mission": { slug: "my-hero-academia", index: 3 },
  // Naruto Shippuden — 7 films sur `/catalogue/naruto-shippuden/film/` :
  // 1 Héritiers de la volonté du feu, 2 Liens, 3 La Flamme de la volonté,
  // 4 The Lost Tower, 5 Blood Prison, 6 Road to Ninja, 7 The Last.
  "naruto shippuden 6 road to ninja": { slug: "naruto-shippuden", index: 6 },
  "road to ninja naruto the": { slug: "naruto-shippuden", index: 6 },
};

const UNAVAILABLE_ON_SITE: Record<string, { from: string; to: string }[]> = {
  // Anime-Sama publie Hunter x Hunter : saison1 = 2011 (148 ép. sur anime-sama.to).
  // La version 1999 (99 ép.) n'"est PAS sur le site : elle sera servie par Franime.
  "hunter-x-hunter": [{ from: "1999-01-01", to: "2000-12-31" }],
  // Anime-Sama publie Berserk : saison1 = 1997 (25 ép.), saison2 = 2016 (24 ép.),
  // saison3 = Memorial (13 ép.). La fiche 1997 DOIT prendre saison1, la fiche
  // 2016 DOIT prendre saison2. On ne marque RIEN comme indisponible.
  // berserk: [],  // vide = les deux adaptations sont sur le site
};

/**
 * Fiches dont l'adaptation n'existe sur AUCUNE source : le slug du site porte
 * une autre série. On ne sert rien plutôt qu'un flux de la mauvaise version.
 * (Vide pour l'instant : Berserk 1997 est bien publié par Franime.)
 */
const UNAVAILABLE_EVERYWHERE: Record<string, { from: string; to: string }[]> = {};

/**
 * Quelle saison du site porte une adaptation précise, d'après sa date de
 * première diffusion : sur la page Berserk, `saison1` est la série de 1997,
 * `saison2` celle de 2016 et `saison3` l'édition Memorial. La correspondance
 * est mémorisée pour la session (les pages ne changent pas).
 */
/** Position d'affichage de la saison du site (0 = première de la page). */
const editionSeasonCache = new Map<string, number | null>();
/**
 * Slugs dont la saison n'existe QUE sur le domaine de secours : le drapeau
 * évite de re-sonder le domaine principal (404) à chaque saison.
 */
const alternateOnly = new Set<string>();
const debugEdition = process.env.PROVIDER_DEBUG === "1";

async function editionZone(slug: string, ctx: ProviderContext, signal: AbortSignal): Promise<number | null> {
  const date = (ctx.firstAirDate ?? ctx.year ?? "").slice(0, 7);
  // La longueur de la fiche fait partie de la clé : 2016 a 2 saisons de 12,
  // 1997 une seule de 25.
  const key = `${slug}:${date}:${(ctx.seasonLengths ?? []).join("-")}`;
  if (editionSeasonCache.has(key)) return editionSeasonCache.get(key) ?? null;
  // Nombre d'épisodes de l'édition demandée (fiche TMDB) : Berserk 1997 en a
  // 25 sur le site, la série de 2016 en a 24 et le Memorial 13.
  const wantedLength = ctx.seasonLengths?.[Math.max(0, (ctx.season ?? 1) - 1)]
    ?? ctx.seasonLengths?.[0]
    ?? ctx.totalEpisodes
    ?? 0;
  if (!wantedLength) return null;
  const zones = await siteZones(slug, signal);
  const lengths = await Promise.all(zones.map(async (zone) => ({
    number: zone.number,
    length: await seasonStartYear(slug, zone.number, signal),
  })));
  // Les saisons du site sont mises bout à bout pour former les SAISONS de la
  // fiche TMDB : Berserk 2016 = saison 1 (12 ép.) + saison 2 (12 ép.), soit
  // 24 épisodes, et le site les range en trois saisons (25 / 12 / 12).
  // On choisit donc l'arc qui porte le numéro de la saison demandée.
  // Chaque saison de la fiche doit atterrir sur un arc DIFFÉRENT : la saison 1
  // prend le premier arc qui a cette longueur, la saison 2 le suivant.
  const seasonIndex = Math.max(0, (ctx.season ?? 1) - 1);
  // Les arcs du site sont PLUS GROSSIERS que les saisons TMDB : Berserk 2016
  // (24 ép.) est découpé en 2 saisons TMDB mais en UN SEUL arc de 24 sur le
  // site. On choisit donc d'abord l'arc qui correspond à l'ENSEMBLE de
  // l'édition (24 ép.), puis la saison demandée est découpée à l'intérieur.
  const editionLength = (ctx.seasonLengths ?? []).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const target = editionLength > wantedLength ? editionLength : wantedLength;
  if (debugEdition) console.log("[anime-sama]", slug, "saison", ctx.season, "| longueurs du site", JSON.stringify(lengths), "| édition", target, "| clé", key);
  let best: { index: number; number: number; gap: number } | null = null;
  for (const [index, entry] of lengths.entries()) {
    if (!entry.length) continue;
    const gap = Math.abs(entry.length - target);
    if (!best || gap < best.gap) best = { index, number: entry.number, gap };
  }
  if (best && best.gap <= 1) {
    editionSeasonCache.set(key, best.index);
    return best.index;
  }
  if (debugEdition) console.log("[anime-sama]", slug, "aucun arc pour", target, "épisodes | longueurs", JSON.stringify(lengths));
  // Tolérance d'un épisode (les sites comptent parfois le pilote à part).
  const result = best && best.gap <= 1 ? best.index : null;
  editionSeasonCache.set(key, result);
  return result;
}

/** Année du premier épisode d'une saison du site (date de diffusion si publiée). */
async function seasonStartYear(slug: string, season: number, signal: AbortSignal): Promise<number | null> {
  // Les pages de saison ne portent ni date ni nom d'édition : on se rabat sur
  // la longueur de la saison, qui distingue les adaptations.
  // Le domaine principal ne publie pas toujours les saisons (Berserk :
  // 404 sur `animes-sama.fr`, 200 sur `anime-sama.to`) : sans la sonde, aucune
  // longueur n'était lue et l'édition était déclarée absente.
  const base = await resolveSeasonBase(`${slug}/saison${season}/vostfr`, signal);
  const page = await fetchText(`${base}/catalogue/${slug}/saison${season}/vostfr/`, { signal, timeoutMs: 4_000 });
  if (!page?.ok) return null;
  const count = (page.text.match(/window\.__EPISODE_NUMBERS\s*=\s*\[([^\]]*)\]/)?.[1] ?? "")
    .split(",")
    .filter((value) => value.trim().length > 0).length;
  return count > 0 ? count : null;
}

function editionUnavailable(slug: string, ctx: ProviderContext): boolean {
  const ranges = UNAVAILABLE_ON_SITE[slug];
  if (!ranges) return false;
  const date = (ctx.firstAirDate ?? ctx.year ?? "").slice(0, 10);
  if (!/^\d{4}/.test(date)) return false;
  return ranges.some((range) => date >= range.from && date <= range.to);
}
const LANG_ORDER = ["vostfr", "vf"] as const;
const LANGUAGE_LABEL = { vostfr: "VOSTFR", vf: "VF" } as const;

type SiteLanguage = (typeof LANG_ORDER)[number];

function scoreTitle(candidate: string, titles: string[], slug = ""): number {
  const hay = normalizeTitle(candidate);
  if (!hay) return 0;
  let best = 0;
  for (const title of titles) {
    // Le slug du site (« hunter-x-hunter ») vaut aussi comme titre.
    const wanted = normalizeTitle(title.replace(/[-_]+/g, " "));
    if (!wanted) continue;
    if (hay === wanted) return 100;
    if (hay.includes(wanted) || wanted.includes(hay)) best = Math.max(best, 80);
    // Le slug de la fiche suffit à la reconnaître si le bloc n'a pas de titre.
    if (slug && hay.includes(normalizeTitle(slug.replace(/[-_]+/g, " ")))) best = Math.max(best, 80);
    const words = titleWords(title);
    if (words.length > 0) {
      const hits = words.filter((word) => hay.includes(word)).length;
      best = Math.max(best, Math.round((hits / words.length) * 70));
    }
  }
  return best;
}

async function searchSlugs(query: string, signal: AbortSignal): Promise<Array<{ slug: string; score: number; label: string }>> {
  const body = new URLSearchParams({ query });
  const page = await fetchText(`${BASE_URL}/ajax/search.php`, {
    method: "POST",
    signal,
    timeoutMs: 7_000,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
    },
    body: body.toString(),
  });
  if (!page?.ok) return [];
  const results: Array<{ slug: string; score: number; label: string }> = [];
  const blocks = page.text.split(/<a\s+href="\/catalogue\//i).slice(1);
  for (const block of blocks) {
    const slug = block.slice(0, block.indexOf('"')).trim();
    if (!slug || slug.includes("/")) continue;
    const title = /asn-search-result-title[^>]*>([^<]+)</i.exec(block)?.[1] ?? "";
    const subtitle = /asn-search-result-subtitle[^>]*>([^<]+)</i.exec(block)?.[1] ?? "";
    results.push({ slug, label: `${title} ${subtitle}`.trim(), score: scoreTitle(`${title} ${subtitle}`, [query], slug) });
  }
  return results;
}

/**
 * Sur une fiche qui regroupe deux adaptations (Hunter x Hunter 1999 / 2011),
 * la numérotation est continue : la seconde génération commence après les 62
 * épisodes de la première. Si la fiche TMDB est la seconde génération et n'a
 * qu'une saison, on décale de la longueur de la première.
 */
function generationShift(slug: string, ctx: ProviderContext, wantedEpisode: number): number {
  const info = GENERATIONS[slug];
  if (!info || !info.year) return 0;
  const tmdbYear = Number.parseInt(ctx.year ?? "", 10);
  if (!tmdbYear) return 0;
  const sameGeneration = Math.abs(tmdbYear - info.year) <= 1;
  if (sameGeneration) return 0;
  // Autre génération : la première commence à l'épisode 1, la suivante après elle.
  if (tmdbYear < info.from) return 0;
  return 62;
}

/**
 * Zones du site pour une fiche : une entrée par `saisonN` listé, avec le
 * nombre d'épisodes publié sur sa page. Sert à retrouver le bon arc quand le
 * découpage du site diffère de celui de TMDB (« Iles des Hommes-Poissons »
 * est la saison 7 sur le site, la S7 de TMDB est G-8 / Long Ring Long Land).
 */
async function siteZones(slug: string, signal: AbortSignal): Promise<Array<{ number: number; length: number }>> {
  // La liste des saisons n'est PAS sur le même domaine que les pages : sur
  // Berserk, l'index est sur `animes-sama.fr` alors que les saisons ne vivent
  // que sur `anime-sama.to`. On essaie donc les deux domaines pour l'index.
  // `redirect: "follow"` est indispensable : sans barre oblique finale, le
  // site répond 301 et `fetchText` (mode manuel) rendait un corps VIDE.
  const indexes = await Promise.all([BASE_URL, BASE_ALTERNATE].map((base) => (
    fetchText(`${base}/catalogue/${slug}`, { signal, timeoutMs: 5_000, redirect: "follow" })
  )));
  const pages = indexes.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.ok));
  if (pages.length === 0) return [];
  const links = pages.flatMap((page) => [...page.text.matchAll(/href="\/catalogue\/[^"']+\/saison(\d+)\/[a-z]+"/g)].map((match) => Number(match[1])));
  // Ordre d'AFFICHAGE de la page (pas le numéro) : sur Berserk, « saison2 » est
  // la série de 2016 et « saison3 » le Memorial — le site ne les range pas
  // dans l'ordre chronologique.
  const numbers = [...new Set(links.filter((value) => Number.isFinite(value) && value > 0))];
  const zones: Array<{ number: number; length: number }> = [];
  // Budget serré : une saga trouvée suffit, on ne parcourt pas 27 saisons à
  // chaque épisode. Les pages sont lues par petits lots.
  const MAX_PAGES = 14;
  // Une liste de saisons vide est presque toujours un échec réseau passager
  // (Berserk a 4 saisons) : on retente une fois plutôt que de conclure.
  if (process.env.PROVIDER_DEBUG === "1") {
    console.log("[anime-sama]", slug, "| index:", pages.map((page) => `${page.status}/${page.text.length}`).join(" "),
      "| saisons:", numbers.join(",") || "aucune");
  }
  const startedAt = Date.now();
  for (const number of numbers.slice(0, MAX_PAGES)) {
    if (signal.aborted || Date.now() - startedAt > 6_000) break;
    // La page de saison peut n'exister que sur l'un des deux domaines : on
    // essaie le domaine résolu, puis l'autre, sinon la longueur manque et
    // l'édition est déclarée absente à tort (Berserk 1997).
    // `redirect: "follow"` : les deux domaines répondent 301 sans barre
    // oblique finale, et le mode manuel rendait un corps vide (longueur null).
    const seasonBase = await resolveSeasonBase(`${slug}/saison${number}/vostfr`, signal);
    let season = await fetchText(`${seasonBase}/catalogue/${slug}/saison${number}/vostfr`, { signal, timeoutMs: 4_000, redirect: "follow" });
    if (!season?.ok) {
      const other = seasonBase === BASE_URL ? BASE_ALTERNATE : BASE_URL;
      season = await fetchText(`${other}/catalogue/${slug}/saison${number}/vostfr`, { signal, timeoutMs: 4_000, redirect: "follow" });
    }
    const raw = season?.ok ? /window\.__EPISODE_NUMBERS\s*=\s*\[([^\]]*)\]/i.exec(season.text)?.[1] ?? "" : "";
    let length = raw.split(",").map((value) => Number(value.trim().replace(/^["']|["']$/g, ""))).filter((value) => Number.isFinite(value)).length;
    // Nouveau front : pas de `__EPISODE_NUMBERS`, le nombre d'épisodes est
    // celui de la liste de liens du premier lecteur (`var eps1 = ["lien:…"]`).
    if (length === 0 && season?.ok) {
      // Le tableau peut être long : on borne à la fermeture `]` du var eps1.
      const listRaw = /var\s+eps1\s*=\s*\[([\s\S]*?)\]/.exec(season.text)?.[1] ?? "";
      length = listRaw.split("lien:").length - 1;
    }
    if (process.env.PROVIDER_DEBUG === "1") {
      console.log("[anime-sama] saison", number, "→", season ? `${season.status}/${season.text.length}` : "null", "| épisodes:", length);
    }
    if (length > 0) zones.push({ number, length });
  }
  return zones;
}

/** Position d'un film sur la page « film » du site, d'après son titre. */
function filmPositionFor(ctx: ProviderContext): { slug: string; index: number } | null {
  for (const raw of [ctx.exactTitle ?? "", ...(ctx.titles ?? [])]) {
    const key = normalizeFilmName(raw);
    if (!key) continue;
    const hit = FILM_POSITIONS[key];
    if (hit) return hit;
  }
  return null;
}

/** Nom de film comparable : sans marqueur de format ni ponctuation. */
function normalizeFilmName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(film|movie)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Le nom du site est souvent plus court que celui du catalogue
 * (« Stampede » face à « Gekijouban One Piece: Stampede ») : on accepte si
 * l'un contient l'autre, ou si tous les mots du site figurent dans le titre.
 */
function filmNameMatches(siteName: string, wanted: string): boolean {
  if (!siteName || !wanted) return false;
  if (wanted.includes(siteName) || siteName.includes(wanted)) return true;
  const siteWords = siteName.split(" ").filter((word) => word.length > 2);
  return siteWords.length > 0 && siteWords.every((word) => wanted.includes(word));
}

async function seasonPaths(slug: string, ctx: ProviderContext, signal: AbortSignal): Promise<Array<{ path: string; language: SiteLanguage }>> {
  const page = await fetchText(`${BASE_URL}/catalogue/${slug}`, { signal, timeoutMs: 5_000, redirect: "follow" });
  // Jamais null : l'appelant fait `for (… of …)` et planterait sur null.
  if (!page?.ok) return [];
  const links = [...page.text.matchAll(/href="\/catalogue\/([^"']+)"/g)].map((match) => match[1]!);
  const wantedSeason = ctx.mediaType === "movie" ? "film" : `saison${ctx.season ?? 1}`;
  const candidates = links.filter((href) => href.startsWith(`${slug}/`) && href.split("/")[1] === wantedSeason);
  const paths: Array<{ path: string; language: SiteLanguage }> = [];
  // On interroge TOUJOURS les deux langues : les fiches publient souvent une
  // page `/vf` même quand l'index ne liste que `vostfr` (le site sert la même
  // page pour les deux, les lecteurs diffèrent).
  for (const language of LANG_ORDER) {
    const href = candidates.find((entry) => entry.endsWith(`/${language}`));
    if (href) {
      paths.push({ path: href, language });
      continue;
    }
    const inferred = `${slug}/${wantedSeason}/${language}`;
    paths.push({ path: inferred, language });
  }
  return paths;
}

type SeasonPage = {
  filmNames?: string[];
  csrf: string;
  episodeNumbers: number[];
  readers: number;
  /** Jeton du nouveau front (`var epsJeton = "…"`), vide sur l'ancien. */
  token: string;
  /** Identifiants de liens par lecteur (`var epsN = ["lien:123", …]`). */
  readerIds: string[][];
};

function parseSeasonPage(html: string): SeasonPage | null {
  const csrf = /csrf\s*:\s*"([^"]+)"/i.exec(html)?.[1] ?? "";
  const hasToken = /var\s+epsJeton\s*=\s*"([^"]+)"/.test(html);
  // Sans jeton CSRF ET sans jeton de liens, la page n'est pas exploitable.
  if (!csrf && !hasToken) return null;
  const numbersRaw = /window\.__EPISODE_NUMBERS\s*=\s*\[([^\]]*)\]/i.exec(html)?.[1] ?? "";
  let episodeNumbers = numbersRaw
    .split(",")
    .map((value) => Number(value.trim().replace(/^["']|["']$/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (process.env.PROVIDER_DEBUG === "1") {
    console.log("[anime-sama] page", JSON.stringify(html.slice(0, 0)), "csrf:", csrf ? "oui" : "non",
      "| épisodes:", episodeNumbers.length, "| lecteurs:", (html.match(/var\s+eps\d+\s*=/g) ?? []).length);
  }
  const readerKeys = [...html.matchAll(/var\s+eps\d+\s*=/g)].length;
  // Nouveau front : la page publie un jeton et, pour chaque lecteur, la liste
  // des identifiants de liens (`var eps1 = ["lien:106070", …]`). La signature
  // POST historique n'existe plus là-bas.
  const token = /var\s+epsJeton\s*=\s*"([^"]+)"/.exec(html)?.[1] ?? "";
  // Les listes contiennent souvent des trous (`""` pour un film absent chez un
  // hébergeur) : on garde la POSITION, sinon les épisodes suivants glissent
  // d'un rang et servent le mauvais film.
  const readerIds = [...html.matchAll(/var\s+eps(\d+)\s*=\s*\[([^\]]*)\]/g)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((match) => [...match[2]!.matchAll(/"([^"]*)"/g)].map((entry) => /(\d+)$/.exec(entry[1]!)?.[1] ?? ""));
  // Nouveau front : pas de `__EPISODE_NUMBERS`, les épisodes sont numérotés
  // 1…N sur la page (chaque lecteur publie sa propre liste d'identifiants).
  const longest = Math.max(0, ...readerIds.map((list) => list.length));
  if (episodeNumbers.length === 0 && longest > 0) {
    episodeNumbers = Array.from({ length: longest }, (_, index) => index + 1);
  }
  return {
    csrf,
    episodeNumbers,
    readers: Math.min(readerKeys || 1, MAX_READERS),
    token,
    readerIds,
    // Page « film » : les noms des films sont dans `newSPF("…")`, dans l'ordre
    // des positions. C'est la seule façon de savoir quel film est servi.
    filmNames: [...html.matchAll(/newSPF\("([^"]+)"\)/g)].map((match) => match[1]!.trim()),
  };
}

async function resolveSignedEmbed(signedPath: string, signal: AbortSignal): Promise<string | null> {
  const page = await fetchText(`${BASE_URL}${signedPath}`, {
    signal,
    timeoutMs: 5_000,
    headers: { Referer: `${BASE_URL}/` },
  });
  if (!page) return null;
  if (page.status >= 300 && page.status < 400) {
    return /^https?:\/\//i.test(page.location) ? page.location : null;
  }
  if (!page.ok) return null;
  const fallback = /data-fallback-url="([^"]+)"/i.exec(page.text)?.[1];
  if (!fallback) return null;
  const embed = await fetchText(fallback.startsWith("http") ? fallback : `${BASE_URL}${fallback}`, {
    signal,
    timeoutMs: 5_000,
    headers: { Referer: `${BASE_URL}/player/` },
  });
  if (!embed) return null;
  if (embed.status >= 300 && embed.status < 400) {
    return /^https?:\/\//i.test(embed.location) ? embed.location : null;
  }
  // Ancien front : l'embed est parfois directement dans la page.
  const direct = /(?:src|data-src)="(https?:\/\/[^"]+)"/i.exec(embed.text)?.[1];
  return direct && /^https?:\/\//i.test(direct) ? direct : null;
}

function playerLabel(url: string): string {
  const host = /^https?:\/\/([^/]+)/i.exec(url)?.[1]?.replace(/^www\./, "") ?? "lecteur";
  return host.split(".")[0] ?? host;
}

export async function extractAnimeSamaStreams(ctx: ProviderContext): Promise<ProviderStream[]> {
  const queries: string[] = [];
  for (const title of ctx.titles) {
    const cleaned = title.replace(/\s*\(?(?:saison|season)\s*\d+\)?\s*$/i, "").trim();
    if (cleaned && !queries.some((query) => normalizeTitle(query) === normalizeTitle(cleaned))) queries.push(cleaned);
    if (queries.length >= MAX_SEARCH_QUERIES) break;
  }

  /**
   * Une fiche n'est acceptée que si son titre (ou son slug) correspond au
   * titre EXACT du catalogue. Sans cette règle, « One Piece Log: Fish-Man
   * Island Saga » tombait sur la fiche « One Piece » — autre adaptation.
   */
  const exact = ctx.exactTitle ? normalizeTitle(ctx.exactTitle) : "";
  const matchesExact = (slug: string, label: string) => {
    if (!exact) return true;
    const hay = normalizeTitle(`${label} ${slug.replace(/[-_]+/g, " ")}`);
    if (hay.includes(exact) || exact.includes(hay)) return true;
    // Le catalogue peut porter un sous-titre (« berserk 1997 kenfu denki
    // berserk ») que la page du site n'a pas : on accepte la fiche quand l'un
    // des titres de la fiche est le slug EXACT du site (« berserk »).
    return shortSlugs(ctx).includes(slug.toLowerCase());
  };

  const candidates: string[] = [];
  for (const query of queries) {
    if (ctx.signal.aborted) break;
    const results = await searchSlugs(query, ctx.signal);
    if (process.env.PROVIDER_DEBUG === "1") {
      console.log("[anime-sama] recherche", JSON.stringify(query), "| exact:", JSON.stringify(exact),
        "| résultats:", results.slice(0, 6).map((r) => `${r.slug}(${r.score})`).join(" ") || "aucun");
    }
    for (const result of results.filter((entry) => entry.score >= 60).sort((a, b) => b.score - a.score)) {
      if (!matchesExact(result.slug, result.label ?? "")) continue;
      if (!candidates.includes(result.slug)) candidates.push(result.slug);
      if (candidates.length >= MAX_CANDIDATES) break;
    }
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  // Le catalogue peut accoler un sous-titre au titre (« Berserk (1997) Kenfu
  // Denki Berserk ») : la page du site, elle, s'appelle `berserk`. On essaie
  // donc aussi le titre le plus court, sinon la fiche n'a aucune cible.
  // Film : la recherche du site ne connaît pas les longs titres de films
  // (« One Piece Film: Red »). La position officielle de la table donne le
  // slug de la page film et la position du film dessus.
  if (ctx.mediaType === "movie") {
    const filmSlug = filmPositionFor(ctx)?.slug;
    if (process.env.PROVIDER_DEBUG === "1") {
      console.log("[anime-sama] film table →", filmSlug ?? "aucune", "| candidats avant:", candidates.join(" ") || "aucun");
    }
    // Un film n'est JAMAIS servi depuis une fiche de série trouvée par
    // recherche (« one-piece-film-red » n'existe pas) : seule la page « film »
    // de la franchise, et seulement si le nom du film y correspond.
    candidates.length = 0;
    if (filmSlug) candidates.push(filmSlug);
  }
  if (candidates.length === 0) {
    for (const slug of shortSlugs(ctx)) candidates.push(slug);
  }

  // Une fiche dont le site publie le remake en saison dédiée est prioritaire :
  // elle ne doit pas être écartée par la limite de candidats.
  const remakeSlug = ctx.remakeStart
    ? Object.keys(REMAKE_SITE_SEASONS).find((entry) => !exact || exact.includes(normalizeTitle(entry)))
    : undefined;
  if (remakeSlug) {
    const at = candidates.indexOf(remakeSlug);
    if (at > 0) candidates.splice(at, 1);
    if (at !== 0) candidates.unshift(remakeSlug);
  }

  const streams: ProviderStream[] = [];
  const wantedEpisode = ctx.mediaType === "movie" ? 1 : ctx.episode ?? 1;
  const debug = process.env.PROVIDER_DEBUG === "1";
  /** Saison du site calculée par zone, réutilisée pour chaque fiche candidate. */
  const seasonOverride = new Map<string, number>();
  /** Fiche ciblée via sa saison de remake : l'épisode y est déjà relatif. */
  let remakeTarget = false;
  /** Épisode relatif à la saga du site (recalculé depuis le numéro absolu). */
  const episodeOverride = new Map<string, number>();
  // Un remake condensé porte sur un ARC précis de la série d'origine : son
  // épisode 1 correspond à l'épisode absolu où cet arc commence. Ce décalage
  // ne vaut QUE pour la fiche du remake : la série d'origine, elle, sert
  // l'arc à sa place normale.
  const remakeStart = Number(ctx.remakeStart) > 0 ? Number(ctx.remakeStart) : undefined;
  const absoluteBase = ctx.mediaType === "movie"
    ? 1
    : (Number.isFinite(Number(ctx.absoluteEpisode)) && Number(ctx.absoluteEpisode) > 0 ? Number(ctx.absoluteEpisode) : wantedEpisode);
  // ⚠ `absoluteBase` porte DÉJÀ le numéro absolu voulu : l'API calcule le
  // décalage du remake (523 + ép. − 1) et le passe dans `absoluteEpisode`. Le
  // ré-ajouter ici donnait 523 + 1045 − 1 = 1567 → arc Pays des Wa.
  const wantedAbsolute = absoluteBase;

  for (const slug of candidates) {
    if (ctx.signal.aborted) break;
    // Une adaptation que le site ne publie pas (Berserk 1997, HxH 1999) est
    // servie par une AUTRE fiche de la même page : la saison du site est
    // choisie par la date de première diffusion.
    let editionSeason: number | null = null;
    let editionIndex: number | null = null;
    // Un slug déjà traité dans cette requête ne doit pas hériter du choix
    // d'un autre candidat.
    seasonOverride.delete(slug);
    episodeOverride.delete(slug);
    // Une fiche dont le site publie le remake en saison dédiée (« saison1hs »)
    // ne passe PAS par la recherche de saga : son épisode est déjà relatif.
    remakeTarget = Boolean(ctx.remakeStart && REMAKE_SITE_SEASONS[slug]);
    // Remake à saison dédiée : une AUTRE fiche (One Piece, saga 7) servirait
    // la série d'origine, pas le remake. On préfère aucun flux.
    if (ctx.remakeStart && !remakeTarget) {
      if (debug) console.log("[anime-sama]", slug, "écartée : le remake a sa propre saison");
      continue;
    }
    if (debug) console.log("[anime-sama] entrée", JSON.stringify(slug), "| remakeStart", ctx.remakeStart, "| table:", Object.keys(REMAKE_SITE_SEASONS).join(","), "| drapeau:", remakeTarget);
    if (editionUnavailable(slug, ctx)) {
      const edition = await editionZone(slug, ctx, ctx.signal);
      if (edition === null) {
        if (debug) console.log("[anime-sama]", slug, "adaptation absente du site (", ctx.firstAirDate, ")");
        continue;
      }
      editionIndex = edition;
      editionSeason = edition + 1;
      if (debug) console.log("[anime-sama]", slug, "édition", ctx.firstAirDate, "→ position d'affichage", edition);
    }
    // La saison du site est la SAGA qui contient le numéro absolu de la fiche :
    // les arcs d'Anime-Sama sont mis bout à bout et on cherche celui qui couvre
    // l'épisode demandé (S7 TMDB = G-8 / Foxy → saga du site 3, pas la 7).
    // Pas pour une saison de remake dédiée : son épisode est déjà relatif.
    if (ctx.mediaType !== "movie" && !remakeTarget && ((ctx.totalEpisodes ?? 0) >= 100 || remakeStart)) {
      const zones = await siteZones(slug, ctx.signal);
      let cursor = 1;
      const zone = zones.find((entry) => {
        const inside = wantedAbsolute >= cursor && wantedAbsolute < cursor + entry.length;
        cursor += entry.length;
        return inside;
      }) ?? zones[Math.min((ctx.season ?? 1) - 1, zones.length - 1)];
      if (zone) {
        cursor = 1;
        for (const entry of zones) {
          if (entry.number === zone.number) break;
          cursor += entry.length;
        }
        // Le numéro absolu de la fiche EST le numéro de la saison du site :
        // la 3e saison d'Anime-Sama commence à l'épisode 144 absolu, et
        // l'épisode 196 y porte le numéro 53.
        const relative = wantedAbsolute - cursor + 1;
        seasonOverride.set(slug, zone.number);
        episodeOverride.set(slug, relative >= 1 && relative <= zone.length ? relative : wantedAbsolute);
        if (debug) console.log("[anime-sama]", slug, "absolu", wantedAbsolute, "→ saison du site", zone.number, "épisode", episodeOverride.get(slug), `(${zone.length} ép.)`);
      }
    }
    // Une édition précise (Berserk 1997 = saison 1 du site) prime sur le
    // calcul par numéro absolu : les deux adaptations ont leur propre saison,
    // et l'épisode demandé est celui de la fiche, pas le numéro absolu.
    if (editionSeason !== null) {
      seasonOverride.set(slug, editionSeason);
      episodeOverride.delete(slug);
    }
    const seasonForSite = seasonOverride.get(slug);
    // Film identifié dans la table : sa position sur la page « film » remplace
    // le numéro d'épisode, qui vaut toujours 1 pour un film (sinon le film 1
    // serait servi pour tous).
    if (ctx.mediaType === "movie") {
      const key = (ctx.exactTitle ?? ctx.titles[0] ?? "").toLowerCase()
        .replace(/[^a-z0-9]+/g, " ").trim();
      // Sans entrée dans la table, on part de la position 1 : la page film
      // donne les noms dans l'ordre, et la vérification du nom écarte les
      // autres films (aucun flux n'est servi plutôt qu'un mauvais film).
      const film = filmPositionFor(ctx);
      if (!film) {
        episodeOverride.set(slug, 1);
        if (debug) console.log("[anime-sama] film", JSON.stringify(key), "→ position 1 (nom vérifié sur la page)");
      } else {
        episodeOverride.set(slug, film.index);
        if (debug) console.log("[anime-sama] film", JSON.stringify(key), "→ position", film.index, "sur", film.slug);
      }
    }
    // Une édition choisie par position d'affichage : la page de saison est
    // résolue dans le même ordre que `siteZones`.
    let targets: Array<{ path: string; language: SiteLanguage }> = [];
    // Remake publié comme une saison à part (« saison1hs ») : on la cible
    // directement, avec l'épisode relatif au remake (1 → 21).
    const remakeSeason = remakeTarget ? REMAKE_SITE_SEASONS[slug] : undefined;
    if (debug) console.log("[anime-sama] candidat", JSON.stringify(slug), "| saison remake:", remakeSeason ? remakeSeason.page : "aucune");
    if (remakeSeason) {
      episodeOverride.set(slug, Math.min(Math.max(1, wantedEpisode), remakeSeason.episodes));
      seasonOverride.set(slug, 1);
      for (const language of LANG_ORDER) {
        targets.push({ path: `${remakeSeason.page}/${language}`, language });
      }
      if (debug) console.log("[anime-sama]", slug, "remake →", `${remakeSeason.page} épisode`, wantedEpisode);
    } else if (editionIndex !== null) {
      const zones = await siteZones(slug, ctx.signal);
      // Index illisible (aucune saison listée) : on vise la page de la saison
      // choisie par la date de diffusion, sans passer par les zones.
      if (zones.length === 0) {
        const seasonNumber = editionIndex + 1;
        for (const language of LANG_ORDER) {
          targets.push({ path: `${slug}/saison${seasonNumber}/${language}`, language });
        }
        if (debug) console.log("[anime-sama]", slug, "édition → cibles directes", targets.map((t) => t.path).join(" "));
      }
      // Un arc du site peut couvrir plusieurs saisons de la fiche : on prend
      // l'arc choisi ET les suivants jusqu'à couvrir le décalage de la saison.
      const arcOffsetEpisodes = (ctx.seasonLengths ?? [])
        .slice(0, Math.max(0, (ctx.season ?? 1) - 1))
        .reduce((sum, value) => sum + (Number(value) || 0), 0);
      let covered = 0;
      const zoneList = zones.slice(editionIndex);
      for (const [position, zone] of zoneList.entries()) {
        if (position > 0 && covered >= arcOffsetEpisodes) break;
        targets.push(...(await seasonPaths(slug, { ...ctx, season: zone.number }, ctx.signal)) ?? []);
        covered += zone.length;
      }
    } else {
      targets = (await seasonPaths(slug, seasonForSite === undefined ? ctx : { ...ctx, season: seasonForSite }, ctx.signal)) ?? [];
    }
    if (debug) console.log("[anime-sama] cibles", JSON.stringify(slug), targets.map((t) => t.path).join(" ") || "aucune");
    for (const target of targets) {
    if (ctx.signal.aborted) break;
    // La page saison pose le cookie de session indispensable à la signature.
    const base = await resolveSeasonBase(target.path, ctx.signal);
    if (debug) console.log("[anime-sama] base pour", target.path, "→", base ?? "aucune");
    if (!base) continue;
    // Barre oblique finale : le domaine officiel redirige (301) sinon, et
    // `redirect: "manual"` renverrait une page vide.
    const page = await fetchText(`${base}/catalogue/${target.path}/`, { signal: ctx.signal, timeoutMs: 5_000 });
    if (!page?.ok) continue;
    const parsed = parseSeasonPage(page.text);
    if (debug) console.log("[anime-sama] cible", target.path, "→ page", page.status, parsed ? "ok" : "illisible");
    if (!parsed) {
      if (debug) console.log("[anime-sama]", target.path, "page illisible", page.status, "| csrf:", /csrf/i.test(page.text) ? "présent" : "absent", "| taille", page.text.length);
      continue;
    }
    // Film : la page liste ses films dans l'ordre des positions. On ne sert
    // QUE si le nom du film à cette position correspond au titre demandé —
    // sinon c'est un autre film de la franchise (Strong World ≠ Red).
    if (ctx.mediaType === "movie") {
      const filmIndex = episodeOverride.get(slug) ?? 1;
      const siteName = normalizeFilmName(parsed.filmNames?.[filmIndex - 1] ?? "");
      const wantedNames = [ctx.exactTitle ?? "", ...(ctx.titles ?? [])].map(normalizeFilmName).filter(Boolean);
      // Page SANS nom de film (`newSPF` absent) : on ne peut pas vérifier.
      // On accepte alors la position de la table, qui vient de l'ordre
      // officiel de la page, plutôt que de ne rien servir.
      const filmOk = siteName.length === 0
        || wantedNames.some((name) => filmNameMatches(siteName, name));
      if (debug) console.log("[anime-sama] film", JSON.stringify(siteName), "vs", JSON.stringify(wantedNames[0]), "→", filmOk ? "ok" : "refusé");
      if (!filmOk) continue;
    }
    const session = cookieHeaderFor(`${base}/catalogue/${target.path}`);
    // Décalage éventuel entre TMDB et le site (fiches listées dans
    // EPISODE_OFFSETS). Aucune fiche n'en a besoin aujourd'hui : Naruto
    // renvoyait l'épisode 2 sur l'épisode 1 à cause d'un « +1 » historique.
    const offset = EPISODE_OFFSETS[slug] ?? 0;
    const generation = generationShift(slug, ctx, wantedEpisode);
    // Priorité au numéro recalculé depuis le numéro absolu : `ctx.episode` peut
    // être un numéro de série (196) et non la position dans la saga.
    // Position dans la saga : le numéro absolu (196) n'existe pas sur la page
    // « saison3 », où l'épisode porte le numéro 53.
    // Édition choisie : l'épisode est la POSITION dans la saison de la fiche
    // (la page du site, elle, numérote à partir de 1).
    // Dans un arc unique qui couvre plusieurs saisons TMDB (Berserk 2016),
    // l'épisode de la saison 2 commence après les épisodes de la saison 1.
    const arcOffset = editionIndex !== null
      ? (ctx.seasonLengths ?? []).slice(0, Math.max(0, (ctx.season ?? 1) - 1)).reduce((sum, value) => sum + (Number(value) || 0), 0)
      : 0;
    const wantedNumber = editionIndex !== null && !remakeTarget
      ? wantedEpisode + arcOffset
      : (episodeOverride.get(slug) ?? wantedEpisode);
    const episodeNumber = wantedNumber + offset + generation;
    if (debug && generation !== 0) console.log("[anime-sama]", slug, "génération → épisode", episodeNumber);
    const available = ctx.mediaType === "movie" || parsed.episodeNumbers.includes(episodeNumber);
    if (debug) console.log("[anime-sama]", target.path, "épisode", episodeNumber, "dispo", available, "lecteurs", parsed.readers, "épisodes connus:", parsed.episodeNumbers.length, "max", Math.max(0, ...parsed.episodeNumbers));
    if (!available) continue;

    for (let reader = 1; reader <= parsed.readers; reader += 1) {
      if (ctx.signal.aborted) break;
      // Nouveau front : `GET /api/lien.php?j=<jeton>&l=<id>` rend directement
      // l'embed de l'épisode chez ce lecteur.
      const ids = parsed.readerIds[reader - 1];
      if (parsed.token && ids) {
        const id = ids[episodeNumber - 1];
        if (debug) console.log("[anime-sama] lien.php lecteur", reader, "épisode", episodeNumber, "id", id ?? "absent");
        if (!id) continue;
        // `l` attend l'identifiant NU (`106189`) : `lien:106189` répond 400.
        const link = await fetchText(`${base}/api/lien.php?j=${encodeURIComponent(parsed.token)}&l=${encodeURIComponent(id)}`, {
          signal: ctx.signal,
          timeoutMs: 5_000,
          headers: { Referer: `${base}/catalogue/${target.path}/`, "X-Requested-With": "XMLHttpRequest", Accept: "*/*" },
        });
        let embedUrl: string | null = null;
        try {
          const payload = JSON.parse(link?.text ?? "{}") as { u?: string };
          if (payload.u && /^https?:\/\//i.test(payload.u)) embedUrl = payload.u;
        } catch {
          embedUrl = null;
        }
        if (debug) console.log("[anime-sama] lecteur", reader, "→", embedUrl ?? "échec");
        if (!embedUrl) continue;
        const language = target.language === "vf" ? "vf" : "vostfr";
        streams.push({
          url: embedUrl,
          provider: "anime-sama",
          source: `Anime-Sama · ${playerLabel(embedUrl)}`,
          language,
          title: `${ctx.titles[0] ?? ""} ${ctx.mediaType === "movie" ? "film" : `S${ctx.season ?? 1}E${episodeNumber}`} ${LANGUAGE_LABEL[language]}`.trim(),
          // Un film n'a pas de saison : le lecteur ne doit afficher aucun numéro.
          seasonNumber: ctx.mediaType === "movie" ? undefined : seasonOverride.get(slug) ?? ctx.season ?? undefined,
          episodeNumber,
          providerSeason: ctx.mediaType === "movie" ? undefined : seasonOverride.get(slug) ?? ctx.season ?? undefined,
          providerEpisode: episodeNumber,
          tmdbSeason: ctx.season ?? undefined,
          tmdbEpisode: wantedEpisode,
        });
        if (streams.length >= 6) break;
        continue;
      }
      const signed = await fetchText(`${base}/api/player/sign/${target.path}`, {
        method: "POST",
        signal: ctx.signal,
        timeoutMs: 5_000,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": parsed.csrf,
          "X-Requested-With": "XMLHttpRequest",
          Origin: base,
          Referer: `${base}/catalogue/${target.path}`,
          // La signature vérifie le PHPSESSID posé par la page saison.
          ...(session ? { Cookie: session } : {}),
        },
        body: JSON.stringify({ ep: episodeNumber, lecteur: reader }),
      });
      if (!signed?.ok) continue;
      let signedPath: string | null = null;
      try {
        const payload = JSON.parse(signed.text) as { ok?: boolean; url?: string };
        if (payload.ok && typeof payload.url === "string") signedPath = payload.url;
      } catch {
        continue;
      }
      if (!signedPath) continue;
      const embed = await resolveSignedEmbed(signedPath, ctx.signal);
      if (debug) console.log("[anime-sama] lecteur", reader, "→", embed ?? "échec");
      if (!embed) continue;
      const language = target.language === "vf" ? "vf" : "vostfr";
      streams.push({
        url: embed,
        provider: "anime-sama",
        source: `Anime-Sama · ${playerLabel(embed)}`,
        language,
        title: `${ctx.titles[0] ?? ""} ${ctx.mediaType === "movie" ? "film" : `S${ctx.season ?? 1}E${episodeNumber}`} ${LANGUAGE_LABEL[language]}`.trim(),
        seasonNumber: seasonOverride.get(slug) ?? ctx.season ?? undefined,
        episodeNumber,
        providerSeason: seasonOverride.get(slug) ?? ctx.season ?? undefined,
        providerEpisode: episodeNumber,
        tmdbSeason: ctx.season ?? undefined,
        tmdbEpisode: wantedEpisode,
      });
      if (streams.length >= 6) break;
    }
    }

    // Une autre fiche peut porter la langue manquante : on continue tant
    // qu'on n'a pas les deux langues — mais seulement vers un candidat d'un
    // AUTRE nom. Deux fiches de même titre (« One Piece » et « One Piece »)
    // sont deux adaptations : mélanger leurs lecteurs rend la série d'origine
    // au lieu du remake (One Piece Log : Fish-Man Island Saga).
    const languages = new Set(streams.map((stream) => stream.language));
    if (languages.has("vf") && languages.has("vostfr")) break;
    const next = candidates[candidates.indexOf(slug) + 1];
    if (next && normalizeTitle(next.replace(/[-_]+/g, " ")) === normalizeTitle(slug.replace(/[-_]+/g, " "))) break;
  }

  return streams;
}

export const ANIME_SAMA_HEADERS = BASE_HEADERS;
