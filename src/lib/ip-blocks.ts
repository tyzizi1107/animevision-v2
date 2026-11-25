import { isIP } from "node:net";
import type { ObjectId } from "mongodb";
import type { IpBlockDoc } from "@/lib/db-types";
import { COLLECTIONS, getDb } from "@/lib/mongodb";

export function normalizeIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const bracketed = /^\[([\da-f:.]+)\](?::\d+)?$/i.exec(trimmed);
  const ip = (bracketed?.[1] ?? trimmed).toLowerCase();
  return isIP(ip) ? ip : null;
}

export async function isIpBlocked(ip: string): Promise<boolean> {
  if (ip === "local") return false;
  const db = await getDb();
  return Boolean(await db.collection<IpBlockDoc>(COLLECTIONS.ipBlocks).findOne({ _id: ip }, { projection: { _id: 1 } }));
}

export async function blockIp(ip: string, blockedBy: string, linkedUserId?: ObjectId): Promise<void> {
  const db = await getDb();
  await db.collection<IpBlockDoc>(COLLECTIONS.ipBlocks).updateOne(
    { _id: ip },
    { $set: { ip, blockedAt: new Date(), blockedBy, ...(linkedUserId ? { linkedUserId } : {}) } },
    { upsert: true },
  );
}

export async function unblockIp(ip: string): Promise<void> {
  const db = await getDb();
  await db.collection<IpBlockDoc>(COLLECTIONS.ipBlocks).deleteOne({ _id: ip });
}
