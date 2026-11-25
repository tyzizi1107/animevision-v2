import type { WithId } from "mongodb";
import type { Announcement, AnnouncementDoc, AnnouncementLevel } from "./db-types";
import { COLLECTIONS, getDb } from "./mongodb";

const LEVELS: AnnouncementLevel[] = ["info", "success", "warning", "critical"];

export function toAnnouncement(doc: WithId<AnnouncementDoc>): Announcement {
  return {
    id: doc._id.toString(),
    titre: doc.titre ?? (doc as typeof doc & { title?: string }).title ?? "",
    body: doc.body,
    level: LEVELS.includes(doc.level) ? doc.level : "info",
    active: Boolean(doc.active),
    pinned: Boolean(doc.pinned),
    linkLabel: doc.linkLabel ?? undefined,
    linkHref: doc.linkHref ?? undefined,
    startsAt: doc.startsAt ? doc.startsAt.toISOString() : null,
    endsAt: doc.endsAt ? doc.endsAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function getActiveAnnouncements(): Promise<Announcement[]> {
  const db = await getDb();
  const now = new Date();
  const docs = await db
    .collection<AnnouncementDoc>(COLLECTIONS.announcements)
    .find({
      active: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: now } }] },
      ],
    })
    .sort({ pinned: -1, createdAt: -1 })
    .limit(20)
    .toArray();

  return docs.map(toAnnouncement);
}

export async function getAllAnnouncements(): Promise<Announcement[]> {
  const db = await getDb();
  const docs = await db
    .collection<AnnouncementDoc>(COLLECTIONS.announcements)
    .find({})
    .sort({ pinned: -1, createdAt: -1 })
    .toArray();
  return docs.map(toAnnouncement);
}

export type AnnouncementInput = {
  titre: string;
  body: string;
  level: AnnouncementLevel;
  active: boolean;
  pinned: boolean;
  linkLabel?: string;
  linkHref?: string;
  startsAt: Date | null;
  endsAt: Date | null;
};

export function parseAnnouncementInput(
  payload: unknown,
): { ok: true; value: AnnouncementInput } | { ok: false; errors: Record<string, string> } {
  const input = (payload ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const titre = typeof (input.titre ?? input.title) === "string" ? String(input.titre ?? input.title).trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const level = typeof input.level === "string" ? (input.level as AnnouncementLevel) : "info";
  const linkLabel = typeof input.linkLabel === "string" ? input.linkLabel.trim() : "";
  const linkHref = typeof input.linkHref === "string" ? input.linkHref.trim() : "";

  if (titre.length < 3) errors.titre = "Le titre doit contenir au moins 3 caractères.";
  if (titre.length > 120) errors.titre = "Le titre ne peut pas dépasser 120 caractères.";
  if (body.length < 3) errors.body = "Le message doit contenir au moins 3 caractères.";
  if (body.length > 2000) errors.body = "Le message ne peut pas dépasser 2000 caractères.";
  if (!LEVELS.includes(level)) errors.level = "Niveau d'annonce invalide.";

  if (linkHref && !/^(\/[^\s]*|https?:\/\/\S+)$/.test(linkHref)) {
    errors.linkHref = "Le lien doit être une URL http(s) ou un chemin interne (/annonces).";
  }
  if (linkLabel.length > 40) errors.linkLabel = "Le libellé du lien est trop long.";
  if (linkHref && !linkLabel) errors.linkLabel = "Ajoutez un libellé pour le lien.";

  const parseDate = (value: unknown): Date | null => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const startsAt = parseDate(input.startsAt);
  const endsAt = parseDate(input.endsAt);
  if (input.startsAt && !startsAt) errors.startsAt = "Date de début invalide.";
  if (input.endsAt && !endsAt) errors.endsAt = "Date de fin invalide.";
  if (startsAt && endsAt && endsAt <= startsAt) {
    errors.endsAt = "La date de fin doit être postérieure à la date de début.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      titre,
      body,
      level,
      active: input.active === undefined ? true : Boolean(input.active),
      pinned: Boolean(input.pinned),
      linkLabel: linkLabel || undefined,
      linkHref: linkHref || undefined,
      startsAt,
      endsAt,
    },
  };
}
