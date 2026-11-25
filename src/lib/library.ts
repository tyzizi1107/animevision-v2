"use client";

import { useMemo, useSyncExternalStore } from "react";
import { progressionDepuisApi, progressionVersApi } from "./api-localization";

export type ProgressEntry = {
  /** Slug de la saison (ex. « saison-1 », « film »). */
  season: string;
  seasonName?: string;
  episode: number;
  language: "vostfr" | "vf";
  updatedAt: number;
  /** Position de lecture en secondes (reprise « à la minute près »). */
  position?: number;
  /** Durée totale de l'épisode en secondes (pour la barre de progression). */
  duration?: number;
};

export type Library = {
  watchlist: string[];
  progress: Record<string, ProgressEntry>;
};

const STORAGE_KEY = "animevision.library.v2";
/** Le visiteur anonyme n'a ni reprise ni progression : la sienne est vide et rien n'y est écrit. */
const ANON_SCOPE = "anon";
let lastScope = ANON_SCOPE;

function scopedKey(scope: string): string {
  return `${STORAGE_KEY}:${scope}`;
}
const EMPTY: Library = { watchlist: [], progress: {} };
const EMPTY_SNAPSHOT = JSON.stringify(EMPTY);

let cache: Library | null = null;
let snapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();
let storageBound = false;
let cloudSyncEnabled = false;
let cloudSyncInFlight = false;

function pushProgress(animeId: string, entry: ProgressEntry) {
  if (!cloudSyncEnabled || lastScope === ANON_SCOPE) return;
  void fetch("/api/bibliotheque/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiantAnime: animeId, progression: progressionVersApi(entry), duree: entry.duration ?? null, position: entry.position ?? null }),
  }).then((response) => {
    if (response.status === 401) cloudSyncEnabled = false;
  }).catch(() => undefined);
}

/** Un seul démarrage de sync par portée, même sans montage React préalable. */
const syncedScopes = new Set<string>();

function syncForScope(scope: string): void {
  if (scope === ANON_SCOPE || syncedScopes.has(scope)) return;
  syncedScopes.add(scope);
  void syncProgressFromCloud(scope);
}

async function syncProgressFromCloud(scope: string = lastScope) {
  // Jamais pour un visiteur anonyme : « Reprendre » et la reprise à la minute
  // sont réservés aux comptes connectés.
  if (scope === ANON_SCOPE || cloudSyncInFlight || typeof window === "undefined") return;
  cloudSyncInFlight = true;
  try {
    const response = await fetch("/api/bibliotheque/progress", { cache: "no-store" });
    if (response.status === 401) {
      cloudSyncEnabled = false;
      return;
    }
    if (!response.ok) return;
    // La réponse arrive peut-être après une déconnexion ou un changement de compte.
    if (scope !== lastScope || scope === ANON_SCOPE) return;
    cloudSyncEnabled = true;
    const data = await response.json() as { progression?: unknown; progressionSupprimeeLe?: unknown };
    const remote = sanitize({ progress: progressionDepuisApi(data.progression) }).progress;
    const clearedAt = data.progressionSupprimeeLe && typeof data.progressionSupprimeeLe === "object"
      ? Object.fromEntries(Object.entries(data.progressionSupprimeeLe).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
      : {};
    const local = current();
    const merged = { ...remote };

    for (const [animeId, entry] of Object.entries(local.progress)) {
      if ((clearedAt[animeId] ?? 0) >= entry.updatedAt) {
        delete merged[animeId];
        continue;
      }
      const remoteEntry = remote[animeId];
      if (!remoteEntry || entry.updatedAt > remoteEntry.updatedAt) {
        merged[animeId] = entry;
        pushProgress(animeId, entry);
      }
    }

    if (JSON.stringify(merged) !== JSON.stringify(local.progress)) {
      cache = { ...local, progress: merged };
      snapshot = JSON.stringify(cache);
      try {
        window.localStorage.setItem(scopedKey(scope), snapshot);
      } catch {
        /* L'état synchronisé reste disponible en mémoire. */
      }
      emit();
    }
  } catch {
    /* La progression locale reste disponible hors ligne. */
  } finally {
    cloudSyncInFlight = false;
  }
}

function sanitize(raw: unknown): Library {
  const empty: Library = { watchlist: [], progress: {} };
  if (!raw || typeof raw !== "object") return empty;

  const value = raw as Partial<Library>;
  const watchlist = Array.isArray(value.watchlist)
    ? value.watchlist.filter((id): id is string => typeof id === "string")
    : [];

  const progress: Record<string, ProgressEntry> = {};
  if (value.progress && typeof value.progress === "object") {
    for (const [animeId, entry] of Object.entries(value.progress)) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Partial<ProgressEntry>;
      if (typeof item.season !== "string" || typeof item.episode !== "number") continue;
      progress[animeId] = {
        season: item.season,
        seasonName: typeof item.seasonName === "string" ? item.seasonName : undefined,
        episode: item.episode,
        language: item.language === "vf" ? "vf" : "vostfr",
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
        position: typeof item.position === "number" && item.position >= 0 ? item.position : undefined,
        duration: typeof item.duration === "number" && item.duration > 0 ? item.duration : undefined,
      };
    }
  }

  return { watchlist, progress };
}

function readStorage(scope: string = lastScope): Library {
  if (typeof window === "undefined") return { watchlist: [], progress: {} };
  if (scope === ANON_SCOPE) return { watchlist: [], progress: {} };
  try {
    const raw = window.localStorage.getItem(scopedKey(scope));
    if (!raw) return { watchlist: [], progress: {} };
    return sanitize(JSON.parse(raw));
  } catch {
    return { watchlist: [], progress: {} };
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function commit(next: Library) {
  cache = next;
  snapshot = JSON.stringify(next);
  // Rien n'est écrit pour un visiteur anonyme : pas de reprise hors connexion.
  if (lastScope !== ANON_SCOPE) {
    try {
      window.localStorage.setItem(scopedKey(lastScope), snapshot);
    } catch {
      /* quota / mode privé : on garde au moins l'état mémoire */
    }
  }
  emit();
}

function current(): Library {
  return JSON.parse(getSnapshot()) as Library;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageBound && typeof window !== "undefined") {
    storageBound = true;
    window.addEventListener("storage", (event) => {
      if (lastScope === ANON_SCOPE || event.key !== scopedKey(lastScope)) return;
      cache = readStorage(lastScope);
      snapshot = JSON.stringify(cache);
      emit();
    });
    window.addEventListener("animevision:auth-changed", (event) => {
      const detail = (event as CustomEvent<{ userId?: string | null }>).detail;
      cloudSyncEnabled = Boolean(detail?.userId);
      if (cloudSyncEnabled) {
        syncedScopes.delete(lastScope);
        syncForScope(lastScope);
        return;
      }
      // Déconnexion : le store devient celui du visiteur anonyme, sinon les
      // reprises du compte restent visibles et s'effacent mutuellement.
      cache = readStorage(ANON_SCOPE);
      snapshot = JSON.stringify(cache);
      lastScope = ANON_SCOPE;
      cloudSyncEnabled = false;
      emit();
    });
    window.addEventListener("focus", () => syncForScope(lastScope));
    window.addEventListener("online", () => syncForScope(lastScope));
    window.setInterval(() => syncForScope(lastScope), 30_000);
    window.setTimeout(() => syncForScope(lastScope), 0);
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Bascule le store local sur un compte (ou sur le visiteur anonyme si null). */
export function setLibraryScope(userId: string | null): void {
  const scope = userId ?? ANON_SCOPE;
  if (scope === lastScope) return;
  lastScope = scope;
  cache = readStorage(scope);
  snapshot = JSON.stringify(cache);
  cloudSyncEnabled = false;
  emit();
  syncForScope(scope);
}

export function getSnapshot(): string {
  if (cache === null) {
    cache = readStorage();
    snapshot = JSON.stringify(cache);
  }
  return snapshot;
}

export function getServerSnapshot(): string {
  return EMPTY_SNAPSHOT;
}

export function toggleWatchlist(animeId: string): boolean {
  const library = current();
  const alreadySaved = library.watchlist.includes(animeId);
  commit({
    ...library,
    watchlist: alreadySaved
      ? library.watchlist.filter((item) => item !== animeId)
      : [animeId, ...library.watchlist],
  });
  return !alreadySaved;
}

/** Enregistre l'épisode en cours de lecture (les iframes externes ne partagent pas la position). */
export function saveEpisode(
  animeId: string,
  season: string,
  seasonName: string,
  episode: number,
  language: "vostfr" | "vf" = "vostfr",
): void {
  const library = current();
  const previous = library.progress[animeId];
  if (
    previous &&
    previous.season === season &&
    previous.episode === episode &&
    previous.language === language &&
    Date.now() - previous.updatedAt < 60_000
  ) {
    return;
  }

  commit({
    ...library,
    progress: {
      ...library.progress,
      [animeId]: { season, seasonName, episode, language, updatedAt: Date.now() },
    },
  });
  pushProgress(animeId, current().progress[animeId]!);
}

/**
 * Mémorise la position de lecture (en secondes) de l'épisode courant.
 * Appelée toutes les ~15 s par le lecteur : on arrondit à la seconde pour
 * éviter les écritures inutiles, et on n'écrit que si l'écart est notable.
 */
export function savePosition(animeId: string, position: number, duration?: number): void {
  const library = current();
  const entry = library.progress[animeId];
  if (!entry) return;
  const seconds = Math.max(0, Math.floor(position));
  // Rien de réellement lu : on ne crée ni ne modifie d'entrée (sinon la rangée
  // « Reprendre la lecture » se remplit d'animés jamais lancés).
  if (seconds < 5) return;
  const total = typeof duration === "number" && Number.isFinite(duration) && duration > 0
    ? Math.floor(duration)
    : entry.duration;
  const samePosition = Math.abs((entry.position ?? 0) - seconds) < 5;
  const sameDuration = !total || Math.abs((entry.duration ?? 0) - total) < 2;
  if (samePosition && sameDuration) return;
  const next: ProgressEntry = { ...entry, position: seconds, updatedAt: entry.updatedAt };
  if (total) next.duration = total;
  commit({ ...library, progress: { ...library.progress, [animeId]: next } });
  pushProgress(animeId, next);
}

export function removeProgress(animeId: string): void {
  const library = current();
  if (!library.progress[animeId]) return;
  const progress = { ...library.progress };
  delete progress[animeId];
  commit({ ...library, progress });
  void fetch("/api/bibliotheque/progress", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiantAnime: animeId }),
  }).catch(() => undefined);
}

export function useLibrary() {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const library = useMemo(() => JSON.parse(value) as Library, [value]);

  return {
    watchlist: library.watchlist,
    progress: library.progress,
    isSaved: (animeId: string) => library.watchlist.includes(animeId),
    toggle: toggleWatchlist,
    saveEpisode,
    savePosition,
    clear: removeProgress,
  };
}
