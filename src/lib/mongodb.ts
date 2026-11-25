import { MongoClient, type Db } from "mongodb";
import { ensureWatchLoop } from "./freshness";

const MONGODB_DB = process.env.MONGODB_DB?.trim() || "animevision";

/** La veille ne démarre qu'une fois par processus. */
let watchLoopStarted = false;
async function ensureWatchLoopOnce(): Promise<void> {
  if (watchLoopStarted) return;
  watchLoopStarted = true;
  ensureWatchLoop();
}
const CONNECT_TIMEOUT_MS = 8_000;

type MongoCache = { client: MongoClient; db: Db; indexesReady: boolean; indexesPromise?: Promise<void> };

declare global {
  // eslint-disable-next-line no-var
  var __animevisionMongo: MongoCache | undefined;
  // eslint-disable-next-line no-var
  var __animevisionMongoPromise: Promise<MongoCache> | undefined;
}

export const COLLECTIONS = {
  users: "comptes",
  sessions: "sessions",
  ipBlocks: "ipBlocks",
  announcements: "annonces",
  /** Catalogue importé depuis Franime, enrichi par TMDB. */
  catalogue: "catalogue",
  /** État de la veille des nouveautés (Franime / Anime-Sama). */
  freshness: "veille",
  /** Calendrier des sorties de la semaine (un document par jour). */
  calendar: "calendriers",
} as const;

/**
 * Connexion MongoDB unique et réutilisée (évite d'ouvrir un pool à chaque requête
 * pendant le hot-reload de `next dev`).
 */
export async function getDb(): Promise<Db> {
  // Première connexion du serveur : c'est ici que la veille des nouveautés
  // démarre (jamais depuis l'instrumentation, qui n'embarque pas les modules
  // Node comme `net`).
  void ensureWatchLoopOnce();
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error(
      "Configuration MongoDB manquante : définissez MONGODB_URI dans .env.local, puis redémarrez Next.js.",
    );
  }

  if (!globalThis.__animevisionMongo) {
    if (!globalThis.__animevisionMongoPromise) {
      globalThis.__animevisionMongoPromise = (async () => {
        const client = new MongoClient(uri, {
          serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
          maxPoolSize: 10,
          retryWrites: true,
        });
        try {
          await client.connect();
          const cache: MongoCache = { client, db: client.db(MONGODB_DB), indexesReady: false };
          globalThis.__animevisionMongo = cache;
          return cache;
        } catch (error) {
          await client.close().catch(() => undefined);
          throw connectionError(error);
        }
      })().finally(() => { globalThis.__animevisionMongoPromise = undefined; });
    }
    await globalThis.__animevisionMongoPromise;
  }

  const cache = globalThis.__animevisionMongo;
  if (!cache) throw new Error("La connexion MongoDB n’a pas pu être initialisée.");

  if (!cache.indexesReady) {
    if (!cache.indexesPromise) {
      cache.indexesPromise = ensureIndexes(cache.db).then(() => { cache.indexesReady = true; });
    }
    await cache.indexesPromise;
  }

  return cache.db;
}

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db
      .collection(COLLECTIONS.users)
      .createIndex({ email: 1 }, { unique: true, name: "email_unique" })
      .catch((error) => console.error("[mongo] index users.email:", error.message)),
    db
      .collection(COLLECTIONS.sessions)
      .createIndex({ tokenHash: 1 }, { unique: true, name: "token_unique" })
      .catch((error) => console.error("[mongo] index sessions.tokenHash:", error.message)),
    db
      .collection(COLLECTIONS.sessions)
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "session_ttl" })
      .catch((error) => console.error("[mongo] index sessions.ttl:", error.message)),
    db
      .collection(COLLECTIONS.sessions)
      .createIndex({ userId: 1 }, { name: "sessions_user" })
      .catch((error) => console.error("[mongo] index sessions.userId:", error.message)),
    db
      .collection(COLLECTIONS.announcements)
      .createIndex({ active: 1, createdAt: -1 }, { name: "announcements_active" })
      .catch((error) => console.error("[mongo] index announcements:", error.message)),
  ]);
}

function connectionError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const details = message
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/gi, "<URI MongoDB masquée>")
    .replace(/(password|pwd)=([^&\s]+)/gi, "$1=<masqué>");

  if (/Server selection timed out|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH/i.test(message)) {
    return new Error(
      `Connexion MongoDB impossible après ${CONNECT_TIMEOUT_MS} ms. Vérifiez que MONGODB_URI est valide, que le cluster Atlas est actif et que son accès réseau autorise votre IP. Détail : ${details}`,
      { cause: error },
    );
  }

  return new Error(`Échec de la connexion MongoDB. Vérifiez MONGODB_URI et les droits du compte MongoDB. Détail : ${details}`, { cause: error });
}
