import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { isSameOrigin, jsonError, readJson } from "@/lib/api";
import { deleteOtherSessions, getSessionToken, getSessionUser, hashToken } from "@/lib/auth";
import type { UserDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { hashPassword, verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { validatePassword } from "@/lib/validation";

type Payload = { currentPassword?: unknown; newPassword?: unknown };

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");

  const session = await getSessionUser();
  if (!session) return jsonError(401, "Vous devez être connecté.");

  const limit = rateLimit(`password:${session.id}`, 5, 15 * 60 * 1000);
  if (!limit.ok) {
    return jsonError(429, "Trop de tentatives. Réessayez dans quelques minutes.");
  }

  const body = await readJson<Payload>(request);
  if (!body) return jsonError(400, "Requête invalide.");

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword) {
    return jsonError(422, "Le mot de passe actuel est requis.", {
      currentPassword: "Requis.",
    });
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) return jsonError(422, "Mot de passe invalide.", { newPassword: passwordError });
  if (currentPassword === newPassword) {
    return jsonError(422, "Le nouveau mot de passe doit être différent.", {
      newPassword: "Choisissez un mot de passe différent de l'actuel.",
    });
  }

  const db = await getDb();
  const users = db.collection<UserDoc>(COLLECTIONS.users);
  const userId = new ObjectId(session.id);
  const user = await users.findOne({ _id: userId });
  if (!user) return jsonError(401, "Compte introuvable.");

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return jsonError(401, "Mot de passe actuel incorrect.", {
      currentPassword: "Mot de passe incorrect.",
    });
  }

  await users.updateOne(
    { _id: userId },
    { $set: { passwordHash: await hashPassword(newPassword), updatedAt: new Date() } },
  );

  // Sécurité : on invalide toutes les autres sessions après un changement de mot de passe.
  const token = await getSessionToken();
  const revoked = token ? await deleteOtherSessions(userId, hashToken(token)) : 0;

  return NextResponse.json({ ok: true, revoked });
}
