import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { isSameOrigin, jsonError, readJson } from "@/lib/api";
import { clearSessionCookie, getSessionUser } from "@/lib/auth";
import type { SessionDoc, UserDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { verifyPassword } from "@/lib/password";

type Payload = { password?: unknown; confirmation?: unknown };

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");

  const session = await getSessionUser();
  if (!session) return jsonError(401, "Vous devez être connecté.");

  const body = await readJson<Payload>(request);
  if (!body) return jsonError(400, "Requête invalide.");

  const password = typeof body.password === "string" ? body.password : "";
  const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";

  if (confirmation !== "SUPPRIMER") {
    return jsonError(422, "Saisissez SUPPRIMER pour confirmer.", {
      confirmation: "Le texte de confirmation ne correspond pas.",
    });
  }

  const db = await getDb();
  const userId = new ObjectId(session.id);
  const user = await db.collection<UserDoc>(COLLECTIONS.users).findOne({ _id: userId });
  if (!user) return jsonError(401, "Compte introuvable.");

  if (!(await verifyPassword(password, user.passwordHash))) {
    return jsonError(401, "Mot de passe incorrect.", { password: "Mot de passe incorrect." });
  }

  await Promise.all([
    db.collection<SessionDoc>(COLLECTIONS.sessions).deleteMany({ userId }),
    db.collection<UserDoc>(COLLECTIONS.users).deleteOne({ _id: userId }),
  ]);

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
