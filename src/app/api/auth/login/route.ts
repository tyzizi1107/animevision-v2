import { NextResponse } from "next/server";
import { getClientIp, isSameOrigin, jsonError, readJson, userAgentOf } from "@/lib/api";
import { attachSessionCookie, createSession, toSafeUser } from "@/lib/auth";
import type { UserDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { fakeVerify, verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/validation";
import { isIpBlocked } from "@/lib/ip-blocks";
import { utilisateurVersApi } from "@/lib/api-localization";

type Payload = { email?: unknown; password?: unknown; remember?: unknown };

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");

  const ip = getClientIp(request);
  if (await isIpBlocked(ip)) return jsonError(403, "Cette adresse IP est bloquée.");
  const body = await readJson<Payload>(request);
  if (!body) return jsonError(400, "Requête invalide.");

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return jsonError(422, "Renseignez votre e-mail et votre mot de passe.");
  }

  const limit = rateLimit(`login:${ip}:${email}`, 8, 10 * 60 * 1000);
  if ('retryAfter' in limit) {
    return jsonError(
      429,
      `Trop de tentatives. Réessayez dans ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
    );
  }

  const db = await getDb();
  const users = db.collection<UserDoc>(COLLECTIONS.users);

  const user = await users.findOne({ email });
  if (!user) {
    await fakeVerify();
    return jsonError(401, "E-mail ou mot de passe incorrect.");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return jsonError(401, "E-mail ou mot de passe incorrect.");
  }

  if (user.blockedAt) {
    return jsonError(403, "Ce compte a été bloqué.");
  }

  const now = new Date();
  await users.updateOne({ _id: user._id }, { $set: { lastLoginAt: now, lastLoginIp: ip, updatedAt: now } });

  const session = await createSession(user._id, {
    userAgent: userAgentOf(request),
    ip,
    remember: body.remember !== false,
  });

  const response = NextResponse.json({ utilisateur: utilisateurVersApi(toSafeUser(user)) });
  attachSessionCookie(response, session);
  return response;
}
