import { NextResponse } from "next/server";
import { getAvailabilityEntry, hiddenIds, isEpisodeHidden, setAvailability } from "@/lib/availability";

/**
 * État du cache de disponibilité.
 *
 *  GET  /api/availability?id=tv-37854&season=1&episode=3
 *       → état connu (available / empty / unknown) pour une fiche ou un épisode.
 *  GET  /api/availability?ids=tv-1,tv-2
 *       → { hidden: [...] } : fiches à masquer (déjà vérifiées vides).
 *  POST /api/availability { ids: [...] , season?: number, episode?: number }
 *       → préchauffage : interroge /api/streams pour un PETIT lot d'ids, afin
 *         que le catalogue sache quoi masquer sans jamais le faire au rendu.
 */

export const dynamic = "force-dynamic";

/** Un lot reste petit : le préchauffage ne doit pas lancer 500 scrapers. */
const MAX_PREWARM = 4;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const ids = url.searchParams.get("ids");

  if (ids) {
    const list = ids.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 200);
    return NextResponse.json({ hidden: [...await hiddenIds(list)] });
  }

  if (!id) return NextResponse.json({ error: "Paramètre `id` ou `ids` requis." }, { status: 400 });

  const season = url.searchParams.get("season");
  const episode = url.searchParams.get("episode");
  if (season !== null) {
    const seasonNumber = Number.parseInt(season, 10);
    const episodeNumber = Number.parseInt(episode ?? "1", 10);
    const hidden = await isEpisodeHidden(id, seasonNumber, episodeNumber);
    const entry = await getAvailabilityEntry(`${id}/s${seasonNumber}e${episodeNumber}`);
    return NextResponse.json({
      id,
      season: seasonNumber,
      episode: episodeNumber,
      status: entry?.status ?? "unknown",
      count: entry?.count ?? 0,
      checkedAt: entry?.at ?? null,
      hidden,
    });
  }

  const entry = await getAvailabilityEntry(id);
  return NextResponse.json({
    id,
    status: entry?.status ?? "unknown",
    count: entry?.count ?? 0,
    providers: entry?.providers ?? [],
    checkedAt: entry?.at ?? null,
    hidden: entry?.status === "empty",
  });
}

export async function POST(request: Request) {
  let body: { ids?: unknown; season?: unknown; episode?: unknown; origin?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((value): value is string => typeof value === "string" && /^(tv|movie)-\d+$/.test(value)).slice(0, MAX_PREWARM)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: `Fournir « ids » (max ${MAX_PREWARM} identifiants tv-/movie-).` }, { status: 400 });
  }

  const season = typeof body.season === "number" ? body.season : null;
  const episode = typeof body.episode === "number" ? body.episode : 1;
  const origin = new URL(request.url).origin;

  // Chaque vérification passe par /api/streams : la même logique que la lecture
  // réelle, donc le même remplissage du cache (aucune duplication).
  const results = await Promise.all(ids.map(async (id) => {
    const params = new URLSearchParams({ id });
    if (season !== null) {
      params.set("season", String(season));
      params.set("episode", String(episode));
    }
    try {
      const response = await fetch(`${origin}/api/streams?${params.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json() as { streams?: unknown[] };
      const count = Array.isArray(payload.streams) ? payload.streams.length : 0;
      return { id, count, status: count > 0 ? "available" : "empty" };
    } catch {
      // Échec réseau : on ne conclut rien, on ne cache pas.
      return { id, count: 0, status: "unknown" };
    }
  }));

  // Filet de sécurité : un lot explicitement demandé marque aussi l'état.
  await Promise.all(results
    .filter((result) => result.status !== "unknown")
    .map((result) => setAvailability(result.id, result.status === "available" ? "available" : "empty", result.count)));

  return NextResponse.json({ results });
}
