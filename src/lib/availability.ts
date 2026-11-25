/**
 * Cache de disponibilité des sources.
 *
 * Interroger les providers coûte plusieurs secondes : on ne peut donc pas le
 * faire pour chaque fiche d'une liste. Ce cache retient, avec un TTL, ce que
 * l'on sait déjà :
 *  - `unknown` : jamais testé (rien à cacher au catalogue) ;
 *  - `available` : au moins un flux a été résolu ;
 *  - `empty` : vérifié, aucun flux (la fiche/l'épisode est masqué).
 *
 * Il est alimenté par `/api/streams` (à chaque lecture réelle) et par le
 * préchauffage de `/api/availability` (petits lots, jamais depuis le rendu
 * d'une page). Stockage mémoire du process, plus une copie disque optionnelle
 * pour survivre à un redémarrage en développement.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type AvailabilityStatus = "available" | "empty";

type AvailabilityEntry = {
  status: AvailabilityStatus;
  at: number;
  /** Nombre de flux trouvés (0 pour `empty`). */
  count: number;
  providers?: string[];
};

const STORE_KEY = "av_stream_availability";
/** Un épisode vide est re-testé plus souvent qu'une fiche qui marche. */
const TTL_AVAILABLE_MS = 6 * 60 * 60_000;
/**
 * Un « vide » est provisoire : les sources FR tombent et reviennent sans
 * prévenir. On le re-teste au bout de 20 minutes au lieu de masquer un animé
 * qui marche pendant 2 h.
 */
const TTL_EMPTY_MS = 20 * 60_000;
const MAX_ENTRIES = 5_000;

const store = new Map<string, AvailabilityEntry>();
let diskLoaded = false;
let diskWriteTimer: NodeJS.Timeout | null = null;

function storePath(): string | null {
  if (process.env.AVAILABILITY_STORE === "off") return null;
  return path.join(process.cwd(), ".cache", `${STORE_KEY}.json`);
}

function ttlFor(status: AvailabilityStatus): number {
  return status === "available" ? TTL_AVAILABLE_MS : TTL_EMPTY_MS;
}

async function loadFromDisk(): Promise<void> {
  if (diskLoaded) return;
  diskLoaded = true;
  const file = storePath();
  if (!file) return;
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Record<string, AvailabilityEntry>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry.at !== "number") continue;
      if (now - entry.at > ttlFor(entry.status)) continue;
      store.set(key, entry);
    }
  } catch {
    // Pas de fichier (premier lancement) ou illisible : on repart à vide.
  }
}

function scheduleDiskWrite(): void {
  if (diskWriteTimer) return;
  diskWriteTimer = setTimeout(() => {
    diskWriteTimer = null;
    const file = storePath();
    if (!file) return;
    const payload = JSON.stringify(Object.fromEntries(store));
    fs.mkdir(path.dirname(file), { recursive: true })
      .then(() => fs.writeFile(file, payload, "utf8"))
      .catch(() => undefined);
  }, 2_000);
  // Ne bloque pas l'arrêt du process.
  diskWriteTimer.unref?.();
}

/** Clé d'une fiche : `tv-123` ; d'un épisode : `tv-123/s2e5`. */
export function availabilityKey(id: string, season?: number | null, episode?: number | null): string {
  if (season === null || season === undefined) return id;
  const ep = episode === null || episode === undefined ? 1 : episode;
  return `${id}/s${season}e${ep}`;
}

export async function getAvailability(key: string): Promise<AvailabilityStatus | null> {
  await loadFromDisk();
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ttlFor(entry.status)) {
    store.delete(key);
    return null;
  }
  return entry.status;
}

export async function getAvailabilityEntry(key: string): Promise<AvailabilityEntry | null> {
  await loadFromDisk();
  const entry = store.get(key);
  if (!entry) return null;
  return Date.now() - entry.at > ttlFor(entry.status) ? null : entry;
}

export async function setAvailability(
  key: string,
  status: AvailabilityStatus,
  count = 0,
  providers?: string[],
): Promise<void> {
  await loadFromDisk();
  if (store.size >= MAX_ENTRIES) {
    // Purge des plus anciennes entrées avant d'ajouter.
    const sorted = [...store.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [oldKey] of sorted.slice(0, Math.ceil(MAX_ENTRIES / 10))) store.delete(oldKey);
  }
  store.set(key, { status, at: Date.now(), count, ...(providers && providers.length > 0 ? { providers } : {}) });
  scheduleDiskWrite();
}

/** Fiches connues comme vérifiées sans flux — jamais proposées au catalogue. */
export async function hiddenIds(ids: string[]): Promise<Set<string>> {
  await loadFromDisk();
  const hidden = new Set<string>();
  for (const id of ids) {
    const entry = await getAvailabilityEntry(id);
    // Un épisode sans flux (ex. un épisode spécial) ne doit pas faire
    // disparaître l'anime de la recherche : seule la fiche elle-même compte.
    if (entry?.status === "empty") hidden.add(id);
  }
  return hidden;
}

/** Vrai si l'épisode a été vérifié sans flux (masqué dans les listes). */
export async function isEpisodeHidden(id: string, season: number, episode: number): Promise<boolean> {
  return (await getAvailability(availabilityKey(id, season, episode))) === "empty";
}

export async function clearAvailability(): Promise<void> {
  store.clear();
  const file = storePath();
  if (file) await fs.rm(file, { force: true }).catch(() => undefined);
}
