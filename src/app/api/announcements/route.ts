import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { isSameOrigin, jsonError, readJson } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { getActiveAnnouncements, getAllAnnouncements, parseAnnouncementInput, toAnnouncement } from "@/lib/announcements";
import type { AnnouncementDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const scope = new URL(request.url).searchParams.get("scope");
  const user = await getSessionUser();

  if (scope === "all") {
    if (user?.role !== "admin") return jsonError(403, "Accès réservé à l'administration.");
    return NextResponse.json(
      { announcements: await getAllAnnouncements() },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { announcements: await getActiveAnnouncements() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");

  const user = await getSessionUser();
  if (user?.role !== "admin") return jsonError(403, "Accès réservé à l'administration.");

  const body = await readJson<unknown>(request);
  const parsed = parseAnnouncementInput(body);
  if (parsed.ok === false) {
  return jsonError(422, "Annonce invalide.", parsed.errors);
}

  const db = await getDb();
  const now = new Date();
  const document: AnnouncementDoc = {
    ...parsed.value,
    createdAt: now,
    updatedAt: now,
    createdBy: user.email,
  };

  const result = await db
    .collection<AnnouncementDoc>(COLLECTIONS.announcements)
    .insertOne(document);

  return NextResponse.json(
    { announcement: toAnnouncement({ ...document, _id: result.insertedId as ObjectId }) },
    { status: 201 },
  );
}
