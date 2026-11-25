import { NextResponse } from "next/server";
import { clearSessionCookie, deleteSessionByToken, getSessionToken } from "@/lib/auth";

export async function POST() {
  const token = await getSessionToken();
  if (token) await deleteSessionByToken(token);

  const response = NextResponse.json({ succes: true });
  clearSessionCookie(response);
  return response;
}
