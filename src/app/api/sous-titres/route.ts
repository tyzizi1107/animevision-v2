import { NextResponse } from "next/server";
import { translateVtt } from "@/lib/subtitles/translate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/sous-titres?url=<vtt>
 *   → le fichier VTT, traduit en français quand il est publié dans une autre
 *     langue (Vidzy ne fournit qu'une piste, souvent anglaise).
 *
 * Le résultat est gardé en mémoire : un même épisode ne repaie pas la
 * traduction à chaque lecture.
 */
const cache = new Map<string, { at: number; body: string }>();
const TTL = 6 * 60 * 60_000;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = params.get("url");
  const pageUrl = params.get("page") ?? undefined;
  if (!target || !/^https?:\/\//i.test(target)) {
    return NextResponse.json({ error: "Paramètre « url » requis." }, { status: 400 });
  }
  const hit = cache.get(target);
  if (hit && Date.now() - hit.at < TTL) {
    return new NextResponse(hit.body, { headers: { "Content-Type": "text/vtt; charset=utf-8" } });
  }
  try {
    const body = await translateVtt(target, pageUrl);
    cache.set(target, { at: Date.now(), body });
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[sous-titres] échec :", error instanceof Error ? error.stack : error);
    return NextResponse.json({ error: "Sous-titres indisponibles." }, { status: 502 });
  }
}
