import { NextResponse } from "next/server";
import { getRecentEpisodes } from "@/lib/animes";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const episodes = await getRecentEpisodes(12);
    return NextResponse.json({ episodes }, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("[api/animes/recent-episodes] lecture impossible :", error);
    return NextResponse.json({ error: "Les derniers épisodes sont temporairement indisponibles." }, { status: 503 });
  }
}
