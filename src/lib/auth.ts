import { createHash, randomBytes } from "node:crypto";
import type { ObjectId, WithId } from "mongodb";
import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import type { SafeUser, SessionDoc, UserDoc } from "./db-types";
import { COLLECTIONS, getDb } from "./mongodb";
import { normalizePreferences } from "./preferences";
import { normalizeAvatar } from "./avatar";
import { getClientIpFromHeaders } from "./api";
import { isIpBlocked } from "./ip-blocks";

export const SESSION_COOKIE = "av_session";
export const SESSION_DAYS = 60;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function toSafeUser(user: WithId<UserDoc>): SafeUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role === "admin" ? "admin" : "user",
    avatar: normalizeAvatar(user.avatar),
    preferences: normalizePreferences(user.preferences),
    createdAt: (user.createdAt ?? new Date()).toISOString(),
  };
}

export async function createSession(
  userId: ObjectId,
  options: { remember?: boolean; userAgent?: string; ip?: string } = {},
): Promise<{ token: string; expiresAt: Date; remember: boolean }> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const remember = options.remember !== false;

  const session: SessionDoc = {
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    userAgent: options.userAgent?.slice(0, 280),
    ip: options.ip,
  };

  await db.collection<SessionDoc>(COLLECTIONS.sessions).insertOne(session);
  return { token, expiresAt, remember };
}

export function attachSessionCookie(
  response: NextResponse,
  session: { token: string; expiresAt: Date; remember: boolean },
): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: session.token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // « Se souvenir de moi » : cookie persistant qui survit à la fermeture du navigateur.
    ...(session.remember ? { expires: session.expiresAt } : {}),
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function getSessionUser(): Promise<SafeUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const user = await getUserFromToken(token);
  if (!user) return null;
  const ip = getClientIpFromHeaders(await headers());
  if (await isIpBlocked(ip)) return null;
  return user;
}

export async function getUserFromToken(token: string): Promise<SafeUser | null> {
  const db = await getDb();
  const tokenHash = hashToken(token);
  const now = new Date();

  const session = await db
    .collection<SessionDoc>(COLLECTIONS.sessions)
    .findOne({ tokenHash, expiresAt: { $gt: now } });
  if (!session) return null;

  const user = await db.collection<UserDoc>(COLLECTIONS.users).findOne({ _id: session.userId });
  if (!user || user.blockedAt) {
    await db.collection<SessionDoc>(COLLECTIONS.sessions).deleteOne({ _id: session._id });
    return null;
  }

  // Rafraîchit « dernière activité » sans écrire à chaque requête.
  if (now.getTime() - session.lastSeenAt.getTime() > 15 * 60 * 1000) {
    void db
      .collection<SessionDoc>(COLLECTIONS.sessions)
      .updateOne({ _id: session._id }, { $set: { lastSeenAt: now } })
      .catch(() => undefined);
  }

  return toSafeUser(user);
}

export async function deleteSessionByToken(token: string): Promise<void> {
  const db = await getDb();
  await db.collection<SessionDoc>(COLLECTIONS.sessions).deleteOne({ tokenHash: hashToken(token) });
}

export async function listSessions(userId: ObjectId) {
  const db = await getDb();
  return db
    .collection<SessionDoc>(COLLECTIONS.sessions)
    .find({ userId, expiresAt: { $gt: new Date() } })
    .sort({ lastSeenAt: -1 })
    .toArray();
}

export async function deleteSessionById(userId: ObjectId, sessionId: string): Promise<boolean> {
  const db = await getDb();
  if (!/^[a-f0-9]{24}$/i.test(sessionId)) return false;
  const { ObjectId } = await import("mongodb");
  const result = await db
    .collection<SessionDoc>(COLLECTIONS.sessions)
    .deleteOne({ _id: new ObjectId(sessionId), userId });
  return result.deletedCount === 1;
}

export async function deleteOtherSessions(userId: ObjectId, keepTokenHash: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .collection<SessionDoc>(COLLECTIONS.sessions)
    .deleteMany({ userId, tokenHash: { $ne: keepTokenHash } });
  return result.deletedCount;
}

export async function isAdmin(): Promise<boolean> {
  const user = await getSessionUser();
  return user?.role === "admin";
}
