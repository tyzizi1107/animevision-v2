import { NextResponse } from "next/server";
import { getAnimeDetail, parseCatalogId } from "@/lib/animes";
import { getStreams } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/streams?id=tv-123&season=1&episode=3
 *   → flux prêts à être lus via /api/proxy (HLS / MP4), toutes sources FR.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = (params.get("id") ?? params.get("tmdbId") ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "Paramètre « id » requis (ex. tv-1399)." }, { status: 400 });
  }

  const season = Number.parseInt(params.get("season") ?? params.get("saison") ?? "1", 10);
  const episode = Number.parseInt(params.get("episode") ?? "1", 10);
  const providers = (params.get("providers") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const languages = (params.get("languages") ?? params.get("langues") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is "vf" | "vostfr" => value === "vf" || value === "vostfr");
  // `force=1` : relance explicite (le cache de disponibilité est ignoré).
  const force = /^(?:1|true|oui)$/i.test(params.get("force") ?? "");

  /**
   * Remakes condensés : épisode absolu de départ de l'arc ET épisodes
   * couverts par le remake (21 pour le Log Fish-Man : 523 → 543).
   */
  const REMAKE_ARCS: Record<string, { start: number; length: number }> = {
    "tv-334601": { start: 523, length: 21 },
  };
  const canonicalId = (() => {
    const parsed = parseCatalogId(id);
    return parsed ? `${parsed.mediaType}-${parsed.tmdbId}` : id;
  })();
  // Le numéro public (`/regarder/954`) est la forme normale : le remake doit
  // être reconnu avec les deux identifiants, sinon l'arc 523 → 543 est perdu.
  const remake = REMAKE_ARCS[id] ?? REMAKE_ARCS[canonicalId];
  if (process.env.PROVIDER_DEBUG === "1") {
    const parsedId = parseCatalogId(id);
    console.log("[streams] id", JSON.stringify(id), "→", parsedId ? `${parsedId.mediaType}-${parsedId.tmdbId}` : "NON RÉSOLU",
      "| remake:", remake ? `${remake.start}/${remake.length}` : "aucun");
  }

  // Numérotation absolue : les fiches alignées sur le catalogue numérotent les
  // épisodes en continu (saison 23 = épisodes 1156+), c'est cette numérotation
  // que les lecteurs attendent.
  let absoluteEpisode: number | null = null;
  let seasonLengths: number[] = [];
  let total = 0;
  let seasonsForLayout: import("@/lib/anime-types").AnimeSeason[] = [];
  try {
    // Toujours avec l'identifiant CANONIQUE : la table des numéros peut se
    // remplir pendant la requête, et un `954` lu trop tôt désignerait `tv-954`.
    const detail = await getAnimeDetail(canonicalId);
    // Les épisodes TMDB portent désormais leur numéro de SÉRIE (One Piece :
    // S23E1 = 1156). C'est la seule source fiable : le résolveur maison
    // retombait sur le numéro affiché pour les saisons en dessous de 1000.
    const wantedSeasonData = (detail?.seasons ?? []).find((item) => item.slug === `saison-${season}`)
      ?? (detail?.seasons ?? [])[season - 1];
    // Les épisodes sont numérotés en continu (196, 197…) : on cible la
    // position dans la saison, pas le numéro affiché.
    const position = Math.max(1, episode);
    const wantedEpisodeData = wantedSeasonData?.episodes[position - 1]
      ?? wantedSeasonData?.episodes.find((item) => item.number === episode);
    const fromTmdb = Number(wantedEpisodeData?.absoluteNumber);
    console.log("[streams] absolu", id, `S${season}E${episode}`, "→", fromTmdb,
      "| slug:", wantedSeasonData?.slug,
      "| 1er épisode:", JSON.stringify(wantedSeasonData?.episodes?.[0]?.number).slice(0, 40),
      "| abs du 1er:", wantedSeasonData?.episodes?.[0]?.absoluteNumber);
    // Un remake condensé (One Piece Log : Fish-Man Island Saga, 21 ép.)
    // porte sur un arc précis : son épisode 1 correspond à l'épisode absolu
    // où l'arc commence, PAS au numéro 1 de la saison TMDB.
    const fromTmdbSafe = Number.isFinite(fromTmdb) && fromTmdb > 0 ? fromTmdb : null;
    absoluteEpisode = remake
      ? remake.start + Math.max(1, episode) - 1
      : fromTmdbSafe ?? (detail?.absoluteEpisode?.(season, episode) ?? null);
    // Les longueurs de saison servent aux providers pour retrouver le même
    // arc que la fiche : les sites FR découpent autrement que TMDB.
    seasonsForLayout = detail?.seasons ?? [];
    seasonLengths = seasonsForLayout.map((item) => item.episodes.length);
    total = seasonLengths.reduce((sum, length) => sum + length, 0);
  } catch {
    absoluteEpisode = null;
  }
  // Les lecteurs attendent une numérotation ABSOLUE continue (One Piece : la saga
  // « Elbaf » = épisodes 1156…1180), différente des numéros des données
  // d'épisode de `anime-seasons`. Un numéro affiché ≥ 1000 est déjà absolu ;
  // en dessous, on demande la plage de la saga au catalogue (voir `findByAbsolute`).
  const relativeEpisode = absoluteEpisode !== null && absoluteEpisode !== episode ? episode : null;

  try {
    // Le type vient de la FICHE (`movie-…` / `tv-…`), pas de l'URL : Vidzy
    // n'a pas de `/serie/` pour un film, il lui faut `/movie/`.
    const catalogType = /^movie-/i.test(canonicalId) ? "movie" : /^tv-/i.test(canonicalId) ? "tv" : null;
    const result = await getStreams({
      id,
      mediaType: catalogType,
      season: Number.isFinite(season) ? season : 1,
      episode: Number.isFinite(episode) ? episode : 1,
      absoluteEpisode,
      // Un remake cherche l'arc de la série d'origine : on lui donne les
      // longueurs de la série complète, sinon il se croit court et retombe
      // sur la saison 1 de la source.
      remakeStart: remake ? remake.start : null,
      relativeEpisode,
      seasonLengths,
      totalEpisodes: total,
      seasons: seasonsForLayout,
      providers,
      languages,
      // La langue voulue par le lecteur décide de l'ordre des flux : un
      // fichier à deux pistes est annoncé « VF » et doit passer devant.
      preferLanguage: (params.get("prefer") === "vf" ? "vf" : params.get("prefer") === "vostfr" ? "vostfr" : null),
      force,
    });
    if (!result) {
      if (process.env.PROVIDER_DEBUG === "1") {
        const parsedId = parseCatalogId(id);
        console.log("[streams] null →", JSON.stringify(id), "documentId:", parsedId?.documentId ?? "aucun",
          "| tmdb:", parsedId?.tmdbId);
      }
      return NextResponse.json({ error: "Contenu introuvable.", streams: [] }, { status: 404 });
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" },
    });
  } catch (cause) {
    console.error("[api/streams] erreur :", cause);
    return NextResponse.json({ error: "Sources temporairement indisponibles.", streams: [] }, { status: 503 });
  }
}
