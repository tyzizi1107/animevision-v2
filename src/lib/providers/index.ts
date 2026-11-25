/**
 * Adaptateur des providers : interroge toutes les sources compatibles en
 * parallèle (une par média : animes, films, séries), chacune avec son propre
 * budget (AbortController), ignore silencieusement les erreurs (404, challenge
 * Cloudflare, flux vides) et dédoublonne les résultats.
 *
 * Ajouter une source = déposer un fichier dans `src/lib/providers/` puis une
 * entrée dans `PROVIDERS` ci-dessous : `mediaTypes` et `languages` suffisent à
 * la brancher sur le bon catalogue.
 */

import { getCatalogueDocument } from "@/lib/catalogue-db";
import { catalogId, getTitlesForProviders, isTmdbNotFound, parseCatalogId, type MediaType } from "@/lib/animes";
import { availabilityKey, getAvailabilityEntry, setAvailability } from "@/lib/availability";
import { extractVidzyStreams } from "./vidzy";
import { resolveProviderStream, type ResolvedStream } from "./resolvers";
import { slugifyTitle, type ProviderContext, type ProviderLanguage, type ProviderResult, type ProviderStream } from "./types";

export const PROVIDER_TIMEOUT_MS = 22_000;
/** Budget global : au-delà, on renvoie ce qui est déjà résolu. */
export const TOTAL_BUDGET_MS = 26_000;

export type ProviderDefinition = {
  id: string;
  label: string;
  /** Types de médias couverts. */
  mediaTypes: MediaType[];
  /** Langues réellement servies par la source. */
  languages: ProviderLanguage[];
  /** Catégorie affichée dans le sélecteur de sources. */
  category: "anime" | "film" | "serie" | "general";
  /** Budget propre au provider (défaut : PROVIDER_TIMEOUT_MS). */
  timeoutMs?: number;
  extract: (context: ProviderContext) => Promise<ProviderStream[]>;
};

export const PROVIDERS: ProviderDefinition[] = [
  {
    // Seule source du site : Vidzy travaille par tmdbId (aucune recherche de
    // titre, donc aucun homonyme), films et séries, VF et VOSTFR.
    id: "vidzy",
    label: "Vidzy",
    mediaTypes: ["tv", "movie"],
    languages: ["vf", "vostfr"],
    category: "general",
    timeoutMs: 18_000,
    extract: extractVidzyStreams,
  },
];

export type StreamQuery = {
  /** `tv-123` / `movie-123` (ou un ancien identifiant). */
  id: string;
  /**
   * Type réel de la fiche, quand il diffère de l'identifiant : le catalogue
   * TMDB garde `tv-` pour tout ce qui vient de `/tv`, même quand TMDB appelle
   * ça un « film » (téléfilm). C'est ce type qui choisit `/movie/` chez Vidzy.
   */
  mediaType?: MediaType | null;
  season?: number | null;
  episode?: number | null;
  /**
   * Numéro absolu Franime, quand la fiche numérote en continu (One Piece :
   * saison 23, épisode 1 → 1156). C'est ce numéro qu'attend le lecteur Franime.
   */
  absoluteEpisode?: number | null;
  /** Numéro affiché par la fiche, quand il diffère du numéro absolu. */
  relativeEpisode?: number | null;
  /** Remake condensé : épisode absolu de départ de l'arc d'origine. */
  remakeStart?: number | null;
  /** Nombre d'épisodes par saison TMDB, pour retrouver les mêmes arcs. */
  seasonLengths?: number[];
  /** Nombre total d'épisodes de la série. */
  totalEpisodes?: number;
  /** Saisons TMDB de la fiche (longueurs, titres). */
  seasons?: import("@/lib/anime-types").AnimeSeason[];
  /** Restreint à certains providers. */
  providers?: string[];
  /** Langue voulue par le lecteur (`vf` / `vostfr`), pour l'ordre des flux. */
  preferLanguage?: "vf" | "vostfr" | null;
  /** Restreint à certaines langues (`vf`, `vostfr`). */
  languages?: ProviderLanguage[];
  /** Ne pas relire le cache de disponibilité (nouvelle tentative explicite). */
  force?: boolean;
};

export type ReadyStream = {
  /** URL du flux, lue via `/api/proxy`. */
  url: string;
  /** URL proxy prête pour la balise <video>. */
  proxyUrl: string;
  /** Embed d'origine (ouvrir dans un onglet). */
  embedUrl: string;
  category: ProviderDefinition["category"];
  /** Hébergeur (sibnet, vidmoly…). */
  host: string;
  source: string;
  /** Provider d'origine (`vidzy`, `franime`…), affiché dans la liste des sources. */
  provider: string;
  language: ProviderLanguage;
  languageLabel: string;
  quality: string | null;
  /** Résolutions disponibles dans le flux HLS (sélecteur de qualité). */
  qualities: string[];
  /** Pistes proposées par le provider (sous-titres, audio). */
  tracks?: import("./types").ProviderTracks;
  /**
   * Master HLS signé du provider, quand il en existe un : hls.js y lit les
   * pistes audio (VF et japonais dans le même fichier) qu'une playlist de
   * segments ne déclare jamais.
   */
  masterUrl?: string | null;
  /** Langue réellement jouée, déduite des pistes du fichier. */
  playback?: "vostfr" | "vf";
  type: ResolvedStream["type"];
  title: string;
  /** Numérotation réellement utilisée chez la source (diag). */
  providerSeason: number | null;
  providerEpisode: number | null;
  tmdbSeason: number | null;
  tmdbEpisode: number | null;
};

export type StreamsResponse = {
  id: string;
  mediaType: MediaType;
  tmdbId: number;
  season: number | null;
  episode: number | null;
  streams: ReadyStream[];
  /** Vrai quand la réponse vient du cache de disponibilité. */
  cached?: boolean;
};

/**
 * Nom public d'une source : le nom de son hébergeur, jamais celui du site qui
 * l'a trouvée. Deux lecteurs d'un même hébergeur sont numérotés par le lecteur.
 */
function neutralSource(host: string): string {
  // `free` est un sous-domaine (free.finepulfe.xyz) : le vrai nom est le suivant.
  const parts = host.replace(/^www\./, "").split(".").filter(Boolean);
  const label = parts.length > 1 && parts[0]!.length <= 4 ? parts[1]! : parts[0];
  const clean = (label ?? "source").replace(/[^a-z0-9-]/gi, "");
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "Source";
}

export function proxyUrlFor(
  stream: ReadyStream | { url: string; headers?: Record<string, string> },
  options: { raw?: boolean } = {},
): string {
  const params = new URLSearchParams();
  // L'URL cible est encodée COMPOSANT PAR COMPOSANT : `URLSearchParams`
  // laisserait ses `&` bruts, tout ce qui suit (`user-agent`) deviendrait un
  // paramètre de l'URL du CDN et le proxy répondrait 404.
  params.set("url", encodeURIComponent(stream.url));
  const headers = "headers" in stream ? stream.headers : undefined;
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === "referer") params.set("referer", value);
      else if (key.toLowerCase() === "origin") params.set("origin", value);
      else if (key.toLowerCase() === "user-agent") params.set("user-agent", value);
    }
  }
  // `params.toString()` ré-encoderait `%` en `%25` : l'URL cible doit arriver
  // telle quelle au proxy.
  return `/api/proxy?${params.toString().replace(/%25/g, "%")}`;
}

type ResolvedPair = { stream: ProviderStream; resolved: ResolvedStream };

async function runProvider(
  provider: ProviderDefinition,
  context: Omit<ProviderContext, "signal">,
): Promise<ProviderResult & { resolved: ResolvedPair[] }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const budget = provider.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const timeout = setTimeout(() => {
    controller.abort();
    console.warn(`[providers:${provider.id}] budget de ${budget} ms dépassé`);
  }, budget);
  try {
    const streams = await provider.extract({ ...context, signal: controller.signal });
    if (process.env.PROVIDER_DEBUG === "1") {
      console.log(`[providers:${provider.id}] extrait ${streams.length} flux`, streams.map((item) => item.url.slice(0, 70)).join(" | "));
    }
    // Résolution des embeds dans le même budget.
    const resolved = (await Promise.all(streams.map(async (stream) => {
      const ready = await resolveProviderStream(stream, controller.signal);
      return ready ? { stream, resolved: ready } : null;
    }))).filter((entry): entry is ResolvedPair => entry !== null);
    return { provider: provider.id, streams, resolved, durationMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/abort/i.test(message)) console.warn(`[providers:${provider.id}]`, message);
    return { provider: provider.id, streams: [], resolved: [], durationMs: Date.now() - startedAt, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "").split(".")[0] ?? "";
  } catch {
    return "";
  }
}

/** Interroge tous les providers compatibles en parallèle pour un épisode ou un film. */
export async function getStreams(query: StreamQuery): Promise<StreamsResponse | null> {
  const parsed = parseCatalogId(query.id);
  if (!parsed) { console.log("[prov] parse null"); return null; }
  // `isTmdbNotFound` ne s'applique qu'aux fiches lues par TMDB : une fiche
  // locale (film Franime, `documentId`) n'a pas de tmdbId et n'est jamais
  // « introuvable chez TMDB ».
  if (!parsed.documentId && isTmdbNotFound(query.id)) { console.log("[prov] notfound"); return null; }
  const id = catalogId(parsed.mediaType, parsed.tmdbId);

  const season = parsed.mediaType === "movie" ? null : Math.max(1, Number(query.season ?? 1));
  const episode = parsed.mediaType === "movie" ? 1 : Math.max(1, Number(query.episode ?? 1));
  const absoluteEpisode = Number.isFinite(Number(query.absoluteEpisode)) && Number(query.absoluteEpisode) > 0
    ? Number(query.absoluteEpisode)
    : null;
  const cacheKey = availabilityKey(id, season, episode);

  const allowed = query.providers && query.providers.length > 0 ? new Set(query.providers) : null;
  const wantedLanguages = query.languages && query.languages.length > 0 ? new Set(query.languages) : null;

  // Fiche déjà vérifiée sans flux (sur TOUS les providers) : inutile de
  // relancer les scrapers. Une requête restreinte à certains providers ou
  // langues, ou une relance explicite, doit toujours interroger les sources.
  if (!query.force && !allowed && !wantedLanguages) {
    const known = await getAvailabilityEntry(cacheKey);
    if (known?.status === "empty") {
      // Un clic sur « Relancer » ne doit pas rendre la même réponse vide : la
      // re-vérification est faite en arrière-plan et le lecteur reprend seul.
      void scheduleRecheck(query);
      return {
        id,
        mediaType: parsed.mediaType,
        tmdbId: parsed.tmdbId,
        season,
        episode,
        streams: [],
        cached: true,
      };
    }
  }

  // Fiche locale : `id` est `tv-0`, il faut demander les titres par le document.
  const titles = await getTitlesForProviders(parsed.documentId ? parsed.documentId : id);
  if (!titles) { console.log("[prov] titles null pour", parsed.documentId ?? id); return null; }
  // Le type vient de la FICHE, pas seulement de l'identifiant : une fiche sans
  // tmdbId (`franime-…`) est toujours lue « tv » par `parseCatalogId`, même
  // quand c'est un film. Sans ce correctif, les providers cherchaient une
  // saison de série pour un film et ne trouvaient aucune source.
  let mediaType = query.mediaType ?? parsed.mediaType;
  if (parsed.documentId) {
    const doc = await getCatalogueDocument(parsed.documentId).catch(() => null);
    if (String((doc as { format?: unknown } | null)?.format ?? "").toLowerCase() === "film") {
      mediaType = "movie";
    }
  }
  if (process.env.PROVIDER_DEBUG === "1") console.log("[prov] type", mediaType, "| doc", parsed.documentId ?? id);

  // Un filtre de langue est une PRÉFÉRENCE, pas une exclusion : les sources de
  // l'autre langue sont demandées aussi (elles servent de repli et alimentent
  // le sélecteur de sources), simplement classées après.
  const providers = PROVIDERS.filter((provider) => (
    provider.mediaTypes.includes(mediaType)
    && (!allowed || allowed.has(provider.id))
  ));

  const context = {
    tmdbId: parsed.tmdbId,
    mediaType,
    season,
    episode,
    absoluteEpisode,
    remakeStart: Number(query.remakeStart) > 0 ? Number(query.remakeStart) : null,
    relativeEpisode: Number.isFinite(Number(query.relativeEpisode)) ? Number(query.relativeEpisode) : null,
    seasonLengths: query.seasonLengths ?? [],
    totalEpisodes: Number(query.totalEpisodes) || 0,
    seasons: query.seasons ?? [],
    // Le titre de la fiche catalogue est déjà en tête ; on ajoute l'original
    // TMDB en FIN de liste (jamais en premier) : il aide à trouver une autre
    // adaptation, mais ne doit pas détourner la recherche vers la série
    // d'origine (One Piece Log → One Piece).
    titles: [...new Set([...titles.titles, titles.originalTitle].filter((value): value is string => Boolean(value)))],
    exactTitle: titles.titles[0] ?? null,
    // Fiche du catalogue (slug) : les tables de correspondance s'y accrochent
    // (remakes dont le site publie une saison dédiée).
    slug: slugifyTitle(titles.titles[0] ?? ""),
    year: titles.year,
    firstAirDate: titles.firstAirDate ?? null,
    imdbId: titles.imdbId,
  };

  const settled = await Promise.race([
    Promise.allSettled(providers.map((provider) => runProvider(provider, context))),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), TOTAL_BUDGET_MS)),
  ]);

  const results = (settled ?? []).flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
  if (process.env.PROVIDER_DEBUG === "1") {
    console.log("[providers] demande", id, `S${season}E${episode}`, "| titres:", titles.titles.slice(0, 3).join(" / "),
      "| budgets:", TOTAL_BUDGET_MS, "ms | réponses:", results.length + "/" + providers.length,
      "|", results.map((r) => `${r.provider}:${r.resolved.length}${r.error ? "!" : ""}`).join(" "),
      "| dépassé:", settled === null);
  }
  const labelById = new Map(PROVIDERS.map((provider) => [provider.id, provider.label]));
  const categoryById = new Map(PROVIDERS.map((provider) => [provider.id, provider.category]));

  const streams: ReadyStream[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    for (const { stream, resolved } of result.resolved) {
      // Dédoublonnage : même URL de média, ou même média + langue déjà couverts.
      // On ne déduplique PAS sur le premier label du CDN : deux lecteurs
      // distincts (uqload `_n` et ansembed `_n`) peuvent partager le même CDN
      // et n'être que deux variantes de qualité du même chemin.
      const host = hostOf(stream.url);
      const key = `${resolved.url}|${stream.language}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const headers = { ...resolved.headers, ...(stream.resolveHeaders ?? {}) };
      streams.push({
        url: resolved.url,
        // Pas de `raw` : Vidzy sert AUSSI une playlist de variantes nommée
        // `index-v1-a1.m3u8` ; la laisser intacte ramenait le lecteur sur une
        // playlist de master (« Missing Target Duration »). Tout est réécrit.
        proxyUrl: proxyUrlFor({ url: resolved.url, headers }),
        embedUrl: stream.url,
        category: categoryById.get(stream.provider) ?? "general",
        host: stream.host ?? host,
        source: neutralSource(stream.host ?? host),
        provider: stream.provider,
        language: stream.language,
        languageLabel: stream.language === "vf" ? "VF" : "VOSTFR",
        quality: resolved.quality,
        qualities: resolved.qualities ?? [],
        // Pistes du provider (Vidzy : VF et VOSTFR partagent le même fichier,
        // seules les pistes audio/sous-titres changent) → réglages du lecteur.
        tracks: resolved.tracks ?? stream.tracks,
        masterUrl: resolved.masterUrl ?? null,
        playback: (resolved.tracks ?? stream.tracks)?.playback ?? null,
        type: resolved.type,
        title: stream.title ?? "",
        providerSeason: stream.providerSeason ?? null,
        providerEpisode: stream.providerEpisode ?? null,
        tmdbSeason: stream.tmdbSeason ?? null,
        tmdbEpisode: stream.tmdbEpisode ?? null,
      });
    }
  }

  // Le libellé suit ce que le fichier joue vraiment (piste japonaise + sous-
  // titres = VOSTFR), sinon le lecteur demandait « VF » et jouait du VOSTFR.
  // Un fichier qui contient les DEUX pistes (`audio`) garde son libellé :
  // c'est le lecteur qui choisit la piste. L'écraser en « VOSTFR » faisait
  // croire à un épisode japonais alors que la VF était demandée.
  for (const stream of streams) {
    if (!stream.playback) continue;
    if ((stream.tracks?.audioLanguages?.length ?? 0) > 1) continue;
    stream.language = stream.playback;
    stream.languageLabel = stream.playback === "vf" ? "VF" : "VOSTFR";
  }
  // VF d'abord quand c'est la VF qui est demandée (préférence du compte ou
  // `?lang=vf`), sinon VOSTFR d'abord ; à qualité égale, ordre des providers.
  // Un fichier à deux pistes est annoncé « VF » et doit passer devant.
  // Langue voulue : celle que le lecteur envoie, sinon la préférence du
  // compte. Un fichier à deux pistes est annoncé « VF » : sans cet ordre, il
  // passait après un éventuel flux VOSTFR et l'épisode restait en japonais.
  const preferVf = query.preferLanguage === "vf";
  streams.sort((a, b) => {
    if (a.language !== b.language) {
      if (preferVf) return a.language === "vf" ? -1 : 1;
      return a.language === "vostfr" ? -1 : 1;
    }
    const qualityRank = (stream: ReadyStream) => Number.parseInt(stream.quality ?? "0", 10) || 0;
    return qualityRank(b) - qualityRank(a);
  });

  // Mémorise la disponibilité (fiche + épisode) pour masquer les contenus vides.
  if (providers.length > 0) {
    const status = streams.length > 0 ? "available" : "empty";
    await Promise.all([
      setAvailability(cacheKey, status, streams.length),
      setAvailability(id, status, streams.length),
    ]);
  }

  return {
    id,
    mediaType: parsed.mediaType,
    tmdbId: parsed.tmdbId,
    season,
    episode,
    streams,
  };
}

/**
 * Re-vérifie une paire marquée « vide » sans faire attendre l'utilisateur.
 * Une seule vérification en vol par clé, et jamais plus d'une toutes les 2 min.
 */
const rechecks = new Map<string, number>();

function scheduleRecheck(query: StreamQuery): void {
  const key = availabilityKey(query.id, query.season ?? 1, query.episode ?? 1);
  const last = rechecks.get(key) ?? 0;
  if (Date.now() - last < 2 * 60_000) return;
  rechecks.set(key, Date.now());
  void getStreams({ ...query, force: true }).catch(() => undefined);
}

/** Catalogue des providers (page d'administration, sélecteur de sources). */
export function listProviders(): Array<Omit<ProviderDefinition, "extract">> {
  return PROVIDERS.map(({ extract: _extract, ...rest }) => rest);
}
