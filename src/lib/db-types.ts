import type { ObjectId } from "mongodb";
import type { Preferences } from "./preferences";

export type UserRole = "user" | "admin";

export type UserDoc = {
  _id?: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  blockedAt?: Date;
  avatar?: string;
  /** Ancien champ conservé pour les comptes créés avant les avatars image. */
  avatarColor?: string;
  preferences: Preferences;
  watchProgress?: Record<string, {
    season: string;
    seasonName?: string;
    episode: number;
    language: "vostfr" | "vf";
    updatedAt: number;
    /** Position de lecture (secondes). */
    position?: number;
    /** Durée totale de l'épisode (secondes). */
    duration?: number;
  }>;
  watchProgressClearedAt?: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
  lastLoginIp?: string;
  termsAcceptedAt?: Date;
  termsVersion?: string;
};

export type SessionDoc = {
  _id?: ObjectId;
  tokenHash: string;
  userId: ObjectId;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  userAgent?: string;
  ip?: string;
};

export type IpBlockDoc = {
  _id: string;
  ip: string;
  blockedAt: Date;
  blockedBy: string;
  linkedUserId?: ObjectId;
};

export type AnnouncementLevel = "info" | "success" | "warning" | "critical";

export type AnnouncementDoc = {
  _id?: ObjectId;
  titre: string;
  body: string;
  level: AnnouncementLevel;
  active: boolean;
  pinned: boolean;
  linkLabel?: string;
  linkHref?: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
};

export type SafeUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar: string;
  preferences: Preferences;
  createdAt: string;
};

export type Announcement = {
  id: string;
  titre: string;
  body: string;
  level: AnnouncementLevel;
  active: boolean;
  pinned: boolean;
  linkLabel?: string;
  linkHref?: string;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};
