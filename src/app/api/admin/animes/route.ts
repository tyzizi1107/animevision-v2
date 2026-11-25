import { NextResponse } from "next/server";
import { currentSeasonSlugs, getAnimeDetail, getAllAnimesSnapshot, getCatalogueOverride, parseCatalogId, saveAdminOverride, searchSummaries } from "@/lib/animes";
import type { AdminOverride } from "@/lib/catalogue-db";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Administration du catalogue : TMDB reste la source, les corrections admin
 * (champ `adminOverride` de la fiche `catalogue`) sont appliquées par-dessus.
 *
 * Le catalogue provient désormais exclusivement de TMDB : aucune fiche n'est
 * stockée en base, donc plus aucune écriture annexe n'est
 * possible ici. GET sert à parcourir/ouvrir une fiche, PUT/POST répondent
 * explicitement 501 pour que l'interface affiche le mode lecture seule.
 */


export async function GET(request: Request) {
  const user = await getSessionUser();
  if (user?.role !== "admin") return jsonError(403, "Accès réservé à l'administration.");

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const anime = await getAnimeDetail(id);
    if (!anime) return jsonError(404, "Animé introuvable.");
    const parsed = parseCatalogId(anime.id);
    return NextResponse.json(
      {
        anime,
        readOnly: false,
        tmdb: parsed ? { tmdbId: parsed.tmdbId, mediaType: parsed.mediaType } : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const query = (url.searchParams.get("q") ?? "").trim();
  const items = query ? await searchSummaries(query, 100) : await getAllAnimesSnapshot();
  return NextResponse.json(
    { animes: items.slice(0, 100), readOnly: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function cleanSources(value: unknown): Array<{ lecteur: string; lien: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const lien = String((item as { lien?: unknown })?.lien ?? "").trim();
    const lecteur = String((item as { lecteur?: unknown })?.lecteur ?? "").trim();
    return /^https?:\/\//i.test(lien) ? [{ lecteur: lecteur || "Lecteur", lien }] : [];
  });
}

/** Enregistre les corrections de la fiche : elles s'appliquent par-dessus TMDB. */
export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (user?.role !== "admin") return jsonError(403, "Accès réservé à l'administration.");
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = String(body?.id ?? "");
  if (!body || !id) return jsonError(400, "Fiche invalide.");
  const str = (value: unknown) => String(value ?? "").trim();
  const list = (value: unknown) => Array.isArray(value) ? value.map(str).filter(Boolean) : [];

  const seasons: NonNullable<AdminOverride["seasons"]> = {};
  const episodes: NonNullable<AdminOverride["episodes"]> = {};
  const rawSeasons = Array.isArray(body.seasons) ? body.seasons : [];
  // Le client envoie la liste COMPLÈTE des saisons de la fiche après édition :
  // celles qui n'y sont plus ont été supprimées, on les masque pour qu'elles
  // ne reviennent pas de TMDB au rechargement.
  const submitted = new Set(rawSeasons.map((rawSeason) => str((rawSeason as Record<string, unknown>)?.slug)).filter(Boolean));
  const existing = (await getCatalogueOverride(id)) ?? null;
  let hiddenSeasons = false;
  const currentSlugs = (await currentSeasonSlugs(id)) ?? [];
  for (const slug of currentSlugs) {
    if (!submitted.has(slug)) seasons[slug] = { ...(existing?.seasons?.[slug] ?? {}), hidden: true };
  }
  for (const rawSeason of rawSeasons as Array<Record<string, unknown>>) {
    const slug = str(rawSeason.slug);
    if (!slug) continue;
    seasons[slug] = { name: str(rawSeason.name) || undefined, affiche: str(rawSeason.affiche) || undefined };
    for (const rawEpisode of (Array.isArray(rawSeason.episodes) ? rawSeason.episodes : []) as Array<Record<string, unknown>>) {
      const number = Number(rawEpisode.number);
      if (!Number.isFinite(number)) continue;
      const runtime = Number(rawEpisode.runtime);
      episodes[`${slug}:${number}`] = {
        titre: str(rawEpisode.titre) || undefined,
        airDate: str(rawEpisode.airDate) || undefined,
        overview: str(rawEpisode.overview),
        still: str(rawEpisode.still) || undefined,
        runtime: runtime > 0 ? runtime : undefined,
        vo: cleanSources(rawEpisode.vo),
        vf: cleanSources(rawEpisode.vf),
      };
    }
  }

  // Aucune saison dans la liste : la fiche est vidée de ses saisons.
  if (rawSeasons.length === 0) hiddenSeasons = true;
  const override: AdminOverride = {
    ...(hiddenSeasons ? { hiddenSeasons: true } : {}),
    titre: str(body.titre) || undefined,
    synopsis: str(body.synopsis),
    affiche: str(body.affiche) || undefined,
    banniere: str(body.banniere) || undefined,
    logo: str(body.logo) || undefined,
    genres: list(body.genres),
    autresNoms: list(body.autresNoms),
    date: str(body.date) || undefined,
    seasons,
    episodes,
  };
  // Les valeurs `undefined` ne doivent pas atteindre MongoDB.
  const clean = JSON.parse(JSON.stringify(override)) as AdminOverride;
  const saved = await saveAdminOverride(id, clean);
  if (!saved) return jsonError(404, "Cette fiche n'est pas dans le catalogue : elle ne peut pas être corrigée.");
  const anime = await getAnimeDetail(id);
  return NextResponse.json({ anime }, { headers: { "Cache-Control": "no-store" } });
}

/** Annule toutes les corrections d'une fiche (retour aux données TMDB). */
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (user?.role !== "admin") return jsonError(403, "Accès réservé à l'administration.");
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id || !(await saveAdminOverride(id, null))) return jsonError(404, "Fiche introuvable.");
  const anime = await getAnimeDetail(id);
  return NextResponse.json({ anime }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  return jsonError(405, "Utilise PUT pour enregistrer une fiche.");
}
