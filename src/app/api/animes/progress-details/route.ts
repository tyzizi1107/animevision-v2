import { NextResponse } from "next/server";
import { getAnimeDetail, parseCatalogId, seasonNumberFromSlug } from "@/lib/animes";

export const dynamic = "force-dynamic";

type RequestedEpisode = { id?: unknown; season?: unknown; episode?: unknown };

/** Détails (titre, image) d'épisodes demandés, lus directement sur TMDB. */
export async function POST(request: Request) {
  let body: { items?: RequestedEpisode[] };
  try {
    body = await request.json() as { items?: RequestedEpisode[] };
  } catch {
    return NextResponse.json({ items: [] }, { status: 400 });
  }

  const requests = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  const validRequests = requests.filter((item): item is RequestedEpisode & { id: string; season: string } =>
    typeof item.id === "string" && parseCatalogId(item.id) !== null && typeof item.season === "string",
  );

  // Une seule fiche TMDB par animé, puis résolution des épisodes demandés.
  const detailIds = [...new Set(validRequests.map((item) => item.id))];
  const details = new Map(await Promise.all(detailIds.map(async (id) => [id, await getAnimeDetail(id)] as const)));

  const items = validRequests.map((item) => {
    const episodeNumber = Number(item.episode);
    if (!Number.isSafeInteger(episodeNumber) || episodeNumber < 1) return null;
    const anime = details.get(item.id);
    if (!anime) return null;
    const seasonNumber = seasonNumberFromSlug(item.season, anime.seasons);
    const season = seasonNumber !== null
      ? anime.seasons.find((candidate) => candidate.slug === `saison-${seasonNumber}` || candidate.slug === item.season)
        ?? anime.seasons.find((candidate) => candidate.name === item.season)
      : anime.seasons.find((candidate) => candidate.slug === item.season);
    const episode = season?.episodes.find((candidate) => candidate.number === episodeNumber);
    if (!season || !episode) return null;

    return {
      id: item.id,
      season: season.slug,
      episode: episode.number,
      seasonName: season.name,
      title: episode.titre ?? null,
      still: episode.still ?? null,
    };
  });

  return NextResponse.json({ items: items.filter((item) => item !== null) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
