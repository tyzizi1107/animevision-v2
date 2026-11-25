import { NextResponse } from "next/server";
import { isIP } from "node:net";

export function jsonError(
  status: number,
  message: string,
  details?: Record<string, string>,
): NextResponse {
  return NextResponse.json({ error: message, details: details ?? null }, { status });
}

export function getClientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const candidate = forwarded?.split(",").at(-1)?.trim() || headers.get("x-real-ip")?.trim();
  if (!candidate) return "local";
  const bracketed = /^\[([\da-f:.]+)\](?::\d+)?$/i.exec(candidate);
  const ip = bracketed?.[1] ?? candidate;
  return isIP(ip) ? ip.toLowerCase() : "local";
}

export function getClientIp(request: Request): string {
  return getClientIpFromHeaders(request.headers);
}

/**
 * Protection CSRF simple : SameSite=Lax + contrôle de l'origine sur les mutations.
 * (Les requêtes sans Origin — curl, tests — restent acceptées.)
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function userAgentOf(request: Request): string {
  return request.headers.get("user-agent")?.slice(0, 280) ?? "Inconnu";
}
