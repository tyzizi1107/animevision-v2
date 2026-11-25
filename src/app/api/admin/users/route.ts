import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isSameOrigin, jsonError, readJson } from "@/lib/api";
import type { IpBlockDoc, SessionDoc, UserDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { normalizeIp } from "@/lib/ip-blocks";

export const dynamic = "force-dynamic";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (session?.role !== "admin") return jsonError(403, "Accès réservé à l’administration.");

  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const filter = query
    ? { $or: [
        { name: { $regex: escapeRegex(query), $options: "i" } },
        { email: { $regex: escapeRegex(query), $options: "i" } },
      ] }
    : {};
  const db = await getDb();
  const users = await db.collection<UserDoc>(COLLECTIONS.users)
    .find(filter, { projection: { name: 1, email: 1, role: 1, avatar: 1, createdAt: 1, lastLoginAt: 1, lastLoginIp: 1, blockedAt: 1 } })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();

  const userIds = users.map((user) => user._id!);
  const sessions = userIds.length
    ? await db.collection<SessionDoc>(COLLECTIONS.sessions)
        .find({ userId: { $in: userIds }, ip: { $type: "string" } }, { projection: { userId: 1, ip: 1 } })
        .sort({ lastSeenAt: -1 })
        .toArray()
    : [];
  const latestIpByUser = new Map<string, string>();
  for (const user of users) {
    const ip = normalizeIp(user.lastLoginIp);
    if (ip) latestIpByUser.set(user._id!.toString(), ip);
  }
  for (const session of sessions) {
    const userId = session.userId.toString();
    const ip = normalizeIp(session.ip);
    if (ip && !latestIpByUser.has(userId)) latestIpByUser.set(userId, ip);
  }
  const linkedBlocks = userIds.length
    ? await db.collection<IpBlockDoc>(COLLECTIONS.ipBlocks)
        .find({ linkedUserId: { $in: userIds } })
        .sort({ blockedAt: -1 })
        .toArray()
    : [];
  for (const block of linkedBlocks) {
    const userId = block.linkedUserId?.toString();
    if (userId && !latestIpByUser.has(userId)) latestIpByUser.set(userId, block.ip);
  }
  const knownIps = [...new Set([...latestIpByUser.values(), ...linkedBlocks.map((block) => block.ip)])];
  const blockedIps = knownIps.length
    ? new Set((await db.collection<IpBlockDoc>(COLLECTIONS.ipBlocks).find({ _id: { $in: knownIps } }, { projection: { _id: 1 } }).toArray()).map((entry) => entry._id))
    : new Set<string>();

  return NextResponse.json({ users: users.map((user) => ({
    id: user._id!.toString(),
    name: user.name,
    email: user.email,
    role: user.role === "admin" ? "admin" : "user",
    avatar: user.avatar ?? "default.jpg",
    createdAt: user.createdAt?.toISOString() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    blocked: Boolean(user.blockedAt),
    lastIp: latestIpByUser.get(user._id!.toString()) ?? null,
    ipBlocked: blockedIps.has(latestIpByUser.get(user._id!.toString()) ?? ""),
  })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");
  const session = await getSessionUser();
  if (session?.role !== "admin") return jsonError(403, "Accès réservé à l’administration.");

  const body = await readJson<{ id?: unknown; blocked?: unknown }>(request);
  if (!body || typeof body.id !== "string" || !ObjectId.isValid(body.id) || typeof body.blocked !== "boolean") {
    return jsonError(422, "Compte ou action invalide.");
  }
  if (body.id === session.id) return jsonError(422, "Vous ne pouvez pas bloquer votre propre compte.");

  const db = await getDb();
  const userId = new ObjectId(body.id);
  const result = body.blocked
    ? await db.collection<UserDoc>(COLLECTIONS.users).updateOne(
        { _id: userId, role: "user" },
        { $set: { blockedAt: new Date(), updatedAt: new Date() } },
      )
    : await db.collection<UserDoc>(COLLECTIONS.users).updateOne(
        { _id: userId, role: "user" },
        { $unset: { blockedAt: "" }, $set: { updatedAt: new Date() } },
      );

  if (!result.matchedCount) return jsonError(404, "Compte utilisateur introuvable.");
  if (body.blocked) await db.collection(COLLECTIONS.sessions).deleteMany({ userId });

  return NextResponse.json({ ok: true, blocked: body.blocked });
}
