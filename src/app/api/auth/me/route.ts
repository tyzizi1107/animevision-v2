import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { utilisateurVersApi } from "@/lib/api-localization";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json(
    { utilisateur: utilisateurVersApi(user) },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
