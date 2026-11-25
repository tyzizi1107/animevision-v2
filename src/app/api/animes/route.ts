import { NextResponse } from "next/server";
import { getSummariesByIds } from "@/lib/animes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rawIds = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = rawIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 60);

  if (ids.length === 0) {
    return NextResponse.json({ items: [] });
  }

  try {
    const items = await getSummariesByIds(ids);
    return NextResponse.json({ items }, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (cause) {
    console.error("[api/animes] erreur :", cause);
    return NextResponse.json({ error: "Catalogue indisponible." }, { status: 503 });
  }
}
