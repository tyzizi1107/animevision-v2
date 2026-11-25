import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { isSameOrigin, jsonError, readJson } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import type { UserDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { normalizePreferences } from "@/lib/preferences";

type Payload = { preferences?: unknown };

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");

  const session = await getSessionUser();
  if (!session) return jsonError(401, "Vous devez être connecté.");

  const body = await readJson<Payload>(request);
  if (!body) return jsonError(400, "Requête invalide.");

  const preferences = normalizePreferences(body.preferences);

  const db = await getDb();
  await db
    .collection<UserDoc>(COLLECTIONS.users)
    .updateOne(
      { _id: new ObjectId(session.id) },
      { $set: { preferences, updatedAt: new Date() } },
    );

  return NextResponse.json({ user: { ...session, preferences } });
}
