import { NextResponse } from "next/server";
import { getRecentEpisodes, getRecentFrAnime } from "@/lib/animes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const includeEpisodes = params.get("episodes") === "1";
    const includeAnimes = params.get("animes") === "1";
    const animeIds = (params.get("animeIds") ?? "").split(",").filter(Boolean).slice(0, 100);
    const [episodes, animes] = await Promise.all([
      includeEpisodes && animeIds.length ? getRecentEpisodes(30, animeIds) : Promise.resolve([]),
      includeAnimes ? getRecentFrAnime(8) : Promise.resolve([]),
    ]);
    return NextResponse.json({ episodes, animes }, {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" },
    });
  } catch (cause) {
    console.error("[api/notifications/feeds] erreur :", cause);
    return NextResponse.json({ error: "Les nouveautés sont temporairement indisponibles." }, { status: 503 });
  }
}
