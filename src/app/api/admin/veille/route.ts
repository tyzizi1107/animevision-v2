import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { getDb } from "@/lib/mongodb";
import { getFreshnessState, runWatch, watchIntervalMinutes } from "@/lib/freshness";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** État de la veille : dernière passe, intervalle, dernières fiches touchées. */
export async function GET() {
  const user = await getSessionUser();
  if (user?.role !== "admin") return jsonError(403, "Accès réservé à l'administration.");
  const state = await getFreshnessState().catch(() => null);
  const minutes = watchIntervalMinutes();
  return NextResponse.json(
    {
      state,
      intervalMinutes: minutes,
      auto: process.env.VEILLE_AUTO !== "0" && minutes > 0,
      running: Boolean(globalThis.__animevisionWatch?.running),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Lance une passe tout de suite : bouton « Vérifier maintenant » (session
 * admin) ou cron système (`Authorization: Bearer $VEILLE_TOKEN`).
 */
export async function POST(request: Request) {
  const token = process.env.VEILLE_TOKEN?.trim();
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const byToken = Boolean(token && bearer && bearer === token);
  if (!byToken) {
    const user = await getSessionUser();
    if (user?.role !== "admin") return jsonError(403, "Accès réservé à l'administration.");
  }
  try {
    const result = await runWatch(await getDb());
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[api/admin/veille] passe impossible :", error);
    return jsonError(500, "La vérification a échoué. Réessaie dans un instant.");
  }
}
