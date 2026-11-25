import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isSameOrigin, readJson } from "@/lib/api";
import type { UserDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { progressionVersApi } from "@/lib/api-localization";

export const dynamic = "force-dynamic";

function apiError(status: number, message: string, details?: Record<string, string>) {
  return NextResponse.json({ erreur: message, details: details ?? null }, { status });
}

type ProgressEntry = {
  season: string;
  seasonName?: string;
  episode: number;
  language: "vostfr" | "vf";
  updatedAt: number;
  position?: number;
  duration?: number;
};

type Payload = {
  identifiantAnime?: unknown;
  progression?: unknown;
  animeId?: unknown;
  entry?: unknown;
  position?: unknown;
  duree?: unknown;
};

/** Identifiants acceptés : `tv-<id>` / `movie-<id>` (TMDB) et anciens ObjectId. */
function validAnimeId(value: unknown): value is string {
  return typeof value === "string" && (/^(?:tv|movie|series)-\d+$/i.test(value) || /^[a-f\d]{24}$/i.test(value));
}

function seconds(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}

function parseEntry(value: unknown): ProgressEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const entry = { season: raw.saison ?? raw.season, seasonName: raw.nomSaison ?? raw.seasonName, episode: raw.numeroEpisode ?? raw.episode, language: raw.langue ?? raw.language, updatedAt: raw.misAJourLe ?? raw.updatedAt } as Partial<ProgressEntry>;
  if (
    typeof entry.season !== "string" || entry.season.length === 0 || entry.season.length > 120 ||
    !Number.isSafeInteger(entry.episode) || (entry.episode ?? 0) < 1 ||
    !Number.isSafeInteger(entry.updatedAt) || (entry.updatedAt ?? 0) < 1 ||
    (entry.language !== "vostfr" && entry.language !== "vf")
  ) return null;

  return {
    season: entry.season,
    seasonName: typeof entry.seasonName === "string" ? entry.seasonName.slice(0, 200) : undefined,
    episode: entry.episode!,
    language: entry.language,
    updatedAt: entry.updatedAt!,
  };
}

/** Position et durée vivent à part : elles changent souvent, la fiche non. */
function parsePlayback(positionValue: unknown, durationValue: unknown): { position?: number; duration?: number } {
  const position = seconds(positionValue);
  const duration = seconds(durationValue);
  return {
    position: position !== undefined ? position : undefined,
    duration: duration && duration > 0 ? duration : undefined,
  };
}

export async function GET() {
  const session = await getSessionUser();
  if (!session) return apiError(401, "Vous devez être connecté.");

  const db = await getDb();
  const user = await db.collection<UserDoc>(COLLECTIONS.users).findOne(
    { _id: new ObjectId(session.id) },
    { projection: { watchProgress: 1, watchProgressClearedAt: 1 } },
  );

  const progression = Object.fromEntries(Object.entries(user?.watchProgress ?? {}).map(([id, entry]) => [
    id,
    {
      ...progressionVersApi(entry),
      // `position`/`duree` vivent aussi en base : sans elles, la reprise repart de zéro.
      position: typeof entry.position === "number" ? entry.position : null,
      duree: typeof entry.duration === "number" ? entry.duration : null,
    },
  ]));
  return NextResponse.json(
    { progression, progressionSupprimeeLe: user?.watchProgressClearedAt ?? {} },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiError(403, "Origine non autorisée.");
  const session = await getSessionUser();
  if (!session) return apiError(401, "Vous devez être connecté.");

  const body = await readJson<Payload>(request);
  const animeId = body?.identifiantAnime ?? body?.animeId;
  if (!body || !validAnimeId(animeId)) return apiError(400, "Animé invalide.");
  const entry = parseEntry(body.progression ?? body.entry);
  if (!entry) return apiError(422, "Progression invalide.");
  // La position est envoyée soit à plat, soit dans `progression.position`/`duree`.
  const progression = (body.progression ?? body.entry) as Record<string, unknown> | undefined;
  const playback = parsePlayback(
    body.position ?? progression?.position,
    body.duree ?? progression?.duree,
  );

  const userId = new ObjectId(session.id);
  const path = `watchProgress.${animeId}`;
  const clearedPath = `watchProgressClearedAt.${animeId}`;
  const db = await getDb();
  await db.collection<UserDoc>(COLLECTIONS.users).updateOne(
    {
      _id: userId,
      $and: [
        { $or: [
          { [`${path}.updatedAt`]: { $lt: entry.updatedAt } },
          { [`${path}.updatedAt`]: { $exists: false } },
        ] },
        { $or: [
          { [clearedPath]: { $lt: entry.updatedAt } },
          { [clearedPath]: { $exists: false } },
        ] },
      ],
    },
    { $set: { [path]: entry }, $unset: { [clearedPath]: "" } },
  );

  if (playback.position !== undefined || playback.duration !== undefined) {
    const playbackSet: Record<string, number> = {};
    if (playback.position !== undefined) playbackSet[`${path}.position`] = playback.position;
    if (playback.duration !== undefined) playbackSet[`${path}.duration`] = playback.duration;
    await db.collection<UserDoc>(COLLECTIONS.users).updateOne(
      { _id: userId, [`${path}.updatedAt`]: { $gte: entry.updatedAt } },
      { $set: playbackSet },
    );
  }

  return NextResponse.json({ succes: true });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return apiError(403, "Origine non autorisée.");
  const session = await getSessionUser();
  if (!session) return apiError(401, "Vous devez être connecté.");

  const body = await readJson<Payload>(request);
  const animeId = body?.identifiantAnime ?? body?.animeId;
  if (!body || !validAnimeId(animeId)) return apiError(400, "Animé invalide.");

  const db = await getDb();
  const clearedAt = Date.now();
  await db.collection<UserDoc>(COLLECTIONS.users).updateOne(
    { _id: new ObjectId(session.id) },
    {
      $unset: { [`watchProgress.${animeId}`]: "" },
      $set: { [`watchProgressClearedAt.${animeId}`]: clearedAt },
    },
  );
  return NextResponse.json({ succes: true });
}
