import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { isSameOrigin, jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { isCustomAvatar } from "@/lib/avatar";
import type { UserDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function detectImage(bytes: Uint8Array): { extension: string; mime: string } | null {
  if (bytes.length >= 6 && (new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a" || new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a")) {
    return { extension: "gif", mime: "image/gif" };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { extension: "png", mime: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpg", mime: "image/jpeg" };
  }
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") {
    return { extension: "webp", mime: "image/webp" };
  }
  return null;
}

function safeFilename(name: string) {
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return slug || "utilisateur";
}

async function removePreviousAvatar(avatar: unknown, userId: string, nextAvatar: string) {
  if (!isCustomAvatar(avatar) || avatar === nextAvatar) return;
  const apiPrefix = `/api/compte/avatar/${userId}/`;
  const oldPrefix = `/images/avatar/custom/${userId}/`;
  const prefix = avatar.startsWith(apiPrefix) ? apiPrefix : avatar.startsWith(oldPrefix) ? oldPrefix : null;
  if (!prefix) return;
  const filename = avatar.slice(prefix.length);
  if (!/^[\w-]+\.(?:gif|png|jpe?g|webp)$/i.test(filename)) return;
  const base = prefix === oldPrefix
    ? path.join(process.cwd(), "public", "images", "avatar", "custom", userId)
    : path.join(process.cwd(), "data", "account-avatars", userId);
  await rm(path.join(base, filename), { force: true }).catch(() => undefined);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");
  const session = await getSessionUser();
  if (!session) return jsonError(401, "Vous devez être connecté.");
  if (session.role !== "admin") return jsonError(403, "Seuls les administrateurs peuvent téléverser une image personnalisée.");

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES + 64 * 1024) return jsonError(413, "Image trop volumineuse (5 Mo maximum).");

  let form: FormData;
  try { form = await request.formData(); } catch { return jsonError(400, "Fichier invalide."); }
  const file = form.get("avatar");
  if (!(file instanceof File)) return jsonError(422, "Sélectionnez une image ou un GIF.");
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) return jsonError(413, "Image trop volumineuse (5 Mo maximum).");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = detectImage(bytes);
  if (!image) return jsonError(422, "Formats acceptés : GIF, PNG, JPEG et WebP.");

  const userId = new ObjectId(session.id);
  const db = await getDb();
  const users = db.collection<UserDoc>(COLLECTIONS.users);
  const current = await users.findOne({ _id: userId }, { projection: { avatar: 1, name: 1 } });
  if (!current) return jsonError(404, "Compte introuvable.");

  const directory = path.join(process.cwd(), "data", "account-avatars", session.id);
  await mkdir(directory, { recursive: true });
  const filename = `${safeFilename(current.name)}.${image.extension}`;
  const destination = path.join(directory, filename);
  const temporary = path.join(directory, `.upload-${randomUUID()}.tmp`);
  const avatar = `/api/compte/avatar/${session.id}/${filename}`;

  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rm(destination, { force: true });
    await rename(temporary, destination);
    await users.updateOne({ _id: userId }, { $set: { avatar, updatedAt: new Date() } });
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    return jsonError(500, "Impossible d’enregistrer l’image.");
  }

  await removePreviousAvatar(current.avatar, session.id, avatar);
  return NextResponse.json({ user: { ...session, name: current.name, avatar }, message: "Image de profil mise à jour." });
}
