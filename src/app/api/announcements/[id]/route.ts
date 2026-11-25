import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { isSameOrigin, jsonError, readJson } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { parseAnnouncementInput, toAnnouncement } from "@/lib/announcements";
import type { AnnouncementDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";

type Params = { params: Promise<{ id: string }> };

async function requireAdmin() {
  const user = await getSessionUser();
  if (user?.role !== "admin") return null;
  return user;
}

export async function PATCH(request: Request, { params }: Params) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");
  const admin = await requireAdmin();
  if (!admin) return jsonError(403, "Accès réservé à l'administration.");

  const { id } = await params;
  if (!/^[a-f0-9]{24}$/i.test(id)) return jsonError(400, "Identifiant invalide.");

  const body = await readJson<unknown>(request);
  const parsed = parseAnnouncementInput(body);
if (parsed.ok === false) {
  return jsonError(422, "Annonce invalide.", parsed.errors);
}

  const db = await getDb();
  const result = await db
    .collection<AnnouncementDoc>(COLLECTIONS.announcements)
    .findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { ...parsed.value, updatedAt: new Date(), createdBy: admin.email } },
      { returnDocument: "after" },
    );

  if (!result) return jsonError(404, "Annonce introuvable.");
  return NextResponse.json({ announcement: toAnnouncement(result) });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");
  const admin = await requireAdmin();
  if (!admin) return jsonError(403, "Accès réservé à l'administration.");

  const { id } = await params;
  if (!/^[a-f0-9]{24}$/i.test(id)) return jsonError(400, "Identifiant invalide.");

  const db = await getDb();
  const result = await db
    .collection<AnnouncementDoc>(COLLECTIONS.announcements)
    .deleteOne({ _id: new ObjectId(id) });

  if (result.deletedCount === 0) return jsonError(404, "Annonce introuvable.");
  return NextResponse.json({ ok: true });
}
