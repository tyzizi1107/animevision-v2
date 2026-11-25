import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getClientIp, isSameOrigin, jsonError, readJson } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import type { SessionDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { blockIp, normalizeIp, unblockIp } from "@/lib/ip-blocks";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");
  const admin = await getSessionUser();
  if (admin?.role !== "admin") return jsonError(403, "Accès réservé à l’administration.");

  const body = await readJson<{ ip?: unknown; blocked?: unknown; userId?: unknown }>(request);
  const ip = normalizeIp(body?.ip);
  if (!body || !ip || typeof body.blocked !== "boolean") return jsonError(422, "Adresse IP ou action invalide.");
  if (ip === getClientIp(request)) return jsonError(422, "Cette adresse est aussi celle de votre connexion actuelle; elle ne peut pas être bloquée ici.");

  let linkedUserId: ObjectId | undefined;
  if (body.userId !== undefined) {
    if (typeof body.userId !== "string" || !ObjectId.isValid(body.userId)) return jsonError(422, "Compte utilisateur invalide.");
    linkedUserId = new ObjectId(body.userId);
  }

  if (body.blocked) {
    await blockIp(ip, admin.email, linkedUserId);
    await (await getDb()).collection<SessionDoc>(COLLECTIONS.sessions).deleteMany({ ip });
  } else {
    await unblockIp(ip);
  }

  return NextResponse.json({ ok: true, ip, blocked: body.blocked });
}
