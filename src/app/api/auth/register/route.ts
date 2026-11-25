import type { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getClientIp, isSameOrigin, jsonError, readJson, userAgentOf } from "@/lib/api";
import { attachSessionCookie, createSession, toSafeUser } from "@/lib/auth";
import type { UserDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { hashPassword } from "@/lib/password";
import { DEFAULT_PREFERENCES } from "@/lib/preferences";
import { rateLimit } from "@/lib/rate-limit";
import { isIpBlocked } from "@/lib/ip-blocks";
import { utilisateurVersApi } from "@/lib/api-localization";
import {
  normalizeEmail,
  normalizeName,
  validateEmail,
  validateName,
  validatePassword,
} from "@/lib/validation";

const TERMS_VERSION = "2026-10-28";

type Payload = { name?: unknown; email?: unknown; password?: unknown; acceptTerms?: unknown };

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");

  const ip = getClientIp(request);
  if (await isIpBlocked(ip)) return jsonError(403, "Les inscriptions depuis cette adresse IP sont bloquées.");
  const limit = rateLimit(`register:${ip}`, 5, 15 * 60 * 1000);
  if (!limit.ok) {
    return jsonError(429, "Trop de tentatives. Réessayez dans quelques minutes.");
  }

  const body = await readJson<Payload>(request);
  if (!body) return jsonError(400, "Requête invalide.");

  const name = normalizeName(body.name);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  const details: Record<string, string> = {};
  if (body.acceptTerms !== true) {
    details.accepted = "Vous devez accepter les conditions d'utilisation pour créer un compte.";
  }
  const nameError = validateName(name);
  if (nameError) details.name = nameError;
  const emailError = validateEmail(email);
  if (emailError) details.email = emailError;
  const passwordError = validatePassword(password);
  if (passwordError) details.password = passwordError;

  if (Object.keys(details).length > 0) {
    return jsonError(422, "Vérifiez les champs du formulaire.", details);
  }

  const db = await getDb();
  const users = db.collection<UserDoc>(COLLECTIONS.users);

  const existing = await users.findOne({ email });
  if (existing) {
    return jsonError(409, "Un compte existe déjà avec cette adresse e-mail.", {
      email: "Cette adresse est déjà utilisée.",
    });
  }

  const now = new Date();
  const document: UserDoc = {
    email,
    name,
    passwordHash: await hashPassword(password),
    role: "user",
    avatar: "default.jpg",
    preferences: DEFAULT_PREFERENCES,
    termsAcceptedAt: now,
    termsVersion: TERMS_VERSION,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const result = await users.insertOne(document);
    const user = { ...document, _id: result.insertedId as ObjectId };
    const session = await createSession(result.insertedId, {
      userAgent: userAgentOf(request),
      ip,
      remember: true,
    });

    const response = NextResponse.json({ utilisateur: utilisateurVersApi(toSafeUser(user)) }, { status: 201 });
    attachSessionCookie(response, session);
    return response;
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 11000) {
      return jsonError(409, "Un compte existe déjà avec cette adresse e-mail.", {
        email: "Cette adresse est déjà utilisée.",
      });
    }
    console.error("[auth/register]", error);
    return jsonError(500, "Impossible de créer le compte pour le moment.");
  }
}
