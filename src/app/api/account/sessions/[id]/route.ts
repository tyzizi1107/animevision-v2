import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { isSameOrigin, jsonError } from "@/lib/api";
import { deleteSessionById, getSessionUser } from "@/lib/auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(request)) return jsonError(403, "Origine non autorisée.");

  const session = await getSessionUser();
  if (!session) return jsonError(401, "Vous devez être connecté.");

  const { id } = await params;
  const deleted = await deleteSessionById(new ObjectId(session.id), id);
  if (!deleted) return jsonError(404, "Session introuvable.");

  return NextResponse.json({ ok: true });
}
