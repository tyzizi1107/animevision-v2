import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { isSameOrigin, jsonError } from "@/lib/api";
import {
  deleteOtherSessions,
  getSessionToken,
  getSessionUser,
  hashToken,
  listSessions,
} from "@/lib/auth";
import { describeUserAgent } from "@/lib/user-agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return jsonError(401, "Vous devez être connecté.");

  const token = await getSessionToken();
  const currentHash = token ? hashToken(token) : null;
  const sessions = await listSessions(new ObjectId(session.id));

  return NextResponse.json(
    {
      sessions: sessions.map((item) => ({
        id: item._id.toString(),
        device: describeUserAgent(item.userAgent),
        ip: item.ip ?? null,
        createdAt: item.createdAt.toISOString(),
        lastSeenAt: item.lastSeenAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
        current: item.tokenHash === currentHash,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Révoque toutes les sessions sauf l'appareil courant. */
export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");

  const session = await getSessionUser();
  if (!session) return jsonError(401, "Vous devez être connecté.");

  const token = await getSessionToken();
  if (!token) return jsonError(400, "Session introuvable.");

  const revoked = await deleteOtherSessions(new ObjectId(session.id), hashToken(token));
  return NextResponse.json({ ok: true, revoked });
}
