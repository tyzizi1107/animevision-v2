import { rm } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { isSameOrigin, jsonError, readJson } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { isAvatarImage, isCustomAvatar } from "@/lib/avatar";
import type { UserDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { normalizeName, validateName } from "@/lib/validation";

type Payload = { name?: unknown; avatar?: unknown };

async function removeCustomAvatar(avatar: unknown, userId: string) {
  if (!isCustomAvatar(avatar)) return;
  const expectedPrefixes = [`/api/compte/avatar/${userId}/`, `/api/account/avatar/${userId}/`, `/images/avatar/custom/${userId}/`];
  const expectedPrefix = expectedPrefixes.find((prefix) => avatar.startsWith(prefix));
  if (!expectedPrefix) return;
  const filename = avatar.slice(expectedPrefix.length);
  if (!/^[\w-]+\.(?:gif|png|jpe?g|webp)$/i.test(filename)) return;
  const base = avatar.startsWith("/images/avatar/custom/")
    ? path.join(process.cwd(), "public", "images", "avatar", "custom", userId)
    : path.join(process.cwd(), "data", "account-avatars", userId);
  await rm(path.join(base, filename), { force: true }).catch(() => undefined);
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");

  const session = await getSessionUser();
  if (!session) return jsonError(401, "Vous devez être connecté.");

  const body = await readJson<Payload>(request);
  if (!body) return jsonError(400, "Requête invalide.");

  const name = normalizeName(body.name);
  const nameError = validateName(name);
  if (nameError) return jsonError(422, "Nom invalide.", { name: nameError });

  const isCustom = isCustomAvatar(body.avatar);
  const isOwnedCustomAvatar = typeof body.avatar === "string" && (
    body.avatar.startsWith(`/api/compte/avatar/${session.id}/`) ||
    body.avatar.startsWith(`/api/account/avatar/${session.id}/`) ||
    body.avatar.startsWith(`/images/avatar/custom/${session.id}/`)
  );
  if (!isAvatarImage(body.avatar) && !isCustom) {
    return jsonError(422, "Avatar invalide.", { avatar: "Choisissez un avatar proposé ou téléversez une image." });
  }
  if (isCustom && (session.role !== "admin" || !isOwnedCustomAvatar)) {
    return jsonError(403, "Cette image personnalisée n’est pas autorisée.");
  }

  const db = await getDb();
  const users = db.collection<UserDoc>(COLLECTIONS.users);
  const userId = new ObjectId(session.id);
  const current = await users.findOne({ _id: userId }, { projection: { avatar: 1 } });
  const avatar = body.avatar as string;

  await users.updateOne(
    { _id: userId },
    { $set: { name, avatar, updatedAt: new Date() } },
  );
  if (current?.avatar !== avatar) await removeCustomAvatar(current?.avatar, session.id);

  return NextResponse.json({ user: { ...session, name, avatar } });
}
