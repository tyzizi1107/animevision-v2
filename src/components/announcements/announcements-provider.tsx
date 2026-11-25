"use client";

import { detailHref } from "@/lib/anime-types";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Announcement, SafeUser } from "@/lib/db-types";
import type { RecentEpisode } from "@/lib/animes";
import type { AnimeSummary } from "@/lib/anime-types";
import { useAuth } from "@/components/auth/auth-provider";
import { useLibrary } from "@/lib/library";

const DISMISSED_KEY = "animevision.dismissed-announcements";

type AnnouncementsState = {
  announcements: Announcement[];
  notices: SiteNotice[];
  testNotice: SiteNotice | null;
  ready: boolean;
  dismissed: string[];
  dismiss: (id: string) => void;
  refresh: () => Promise<void>;
  testNotifications: () => void;
};

export type SiteNotice = {
  id: string;
  kind: "announcement" | "episode" | "monthly" | "test";
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
  level?: Announcement["level"];
};

const AnnouncementsContext = createContext<AnnouncementsState | null>(null);

function readDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function AnnouncementsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { watchlist } = useLibrary();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [episodes, setEpisodes] = useState<RecentEpisode[]>([]);
  const [recentAnime, setRecentAnime] = useState<AnimeSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [testNotice, setTestNotice] = useState<SiteNotice | null>(null);
  const testTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const tasks: Promise<void>[] = [fetch("/api/annonces", { cache: "no-store" })
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json() as { announcements?: Announcement[] };
          setAnnouncements(Array.isArray(data.announcements) ? data.announcements : []);
        }
      })
      .catch(() => undefined)];
    if (user && (user.preferences.notifications.newEpisodes || user.preferences.notifications.newsletter)) {
      const params = new URLSearchParams();
      if (user.preferences.notifications.newEpisodes) {
        params.set("episodes", "1");
        const followedIds = [...new Set(watchlist)].slice(0, 100);
        if (followedIds.length) params.set("animeIds", followedIds.join(","));
      }
      if (user.preferences.notifications.newsletter) params.set("animes", "1");
      tasks.push(fetch(`/api/notifications/feeds?${params.toString()}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const data = await response.json() as { episodes?: RecentEpisode[]; animes?: AnimeSummary[] };
          setEpisodes(Array.isArray(data.episodes) ? data.episodes : []);
          setRecentAnime(Array.isArray(data.animes) ? data.animes : []);
        })
        .catch(() => undefined));
    } else {
      setEpisodes([]);
      setRecentAnime([]);
    }
    await Promise.all(tasks);
    setReady(true);
  }, [user?.id, user?.preferences.notifications.newEpisodes, user?.preferences.notifications.newsletter, watchlist]);

  useEffect(() => {
    setDismissed(readDismissed());
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5 * 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => () => {
    if (testTimer.current !== null) window.clearInterval(testTimer.current);
  }, []);

  const dismiss = useCallback((id: string) => {
    if (id.startsWith("test-")) {
      if (testTimer.current !== null) window.clearInterval(testTimer.current);
      testTimer.current = null;
      setTestNotice(null);
      return;
    }
    setDismissed((current) => {
      const next = Array.from(new Set([...current, id])).slice(-50);
      try {
        window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
      } catch {
        /* mode privé */
      }
      return next;
    });
  }, []);

  const testNotifications = useCallback(() => {
    const samples: SiteNotice[] = [
      { id: "test-announcement", kind: "test", title: "Test · Annonce du site", body: "Les annonces actives apparaissent ici. Un administrateur publie leur contenu sur AnimeVision.", href: "/annonces" },
      { id: "test-episode", kind: "test", title: "Test · Nouvel épisode", body: "One Piece · Épisode 1 vient d’être ajouté à ta liste suivie.", href: "/catalogue" },
      { id: "test-monthly", kind: "test", title: "Test · Sélection mensuelle", body: "Ta sélection du mois est prête : de nouveaux animés à découvrir dans le catalogue.", href: "/catalogue" },
    ];
    if (testTimer.current !== null) window.clearInterval(testTimer.current);
    let index = 0;
    setTestNotice(samples[index]!);
    testTimer.current = window.setInterval(() => {
      index += 1;
      if (index >= samples.length) {
        if (testTimer.current !== null) window.clearInterval(testTimer.current);
        testTimer.current = null;
        setTestNotice(null);
        return;
      }
      setTestNotice(samples[index]!);
    }, 3000);
  }, []);

  const notices = useMemo<SiteNotice[]>(() => {
    const result: SiteNotice[] = [];
    if (!user || user.preferences.notifications.announcements) {
      result.push(...announcements
        .filter((item) => item.active && !dismissed.includes(item.id))
        .map((item) => ({ id: item.id, kind: "announcement" as const, title: item.titre, body: item.body, href: item.linkHref || "/annonces", linkLabel: item.linkLabel, level: item.level })));
    }
    if (user?.preferences.notifications.newEpisodes) {
      const followed = new Set(watchlist);
      const freshAfter = Date.now() - 14 * 24 * 60 * 60_000;
      const groupedEpisodes = new Map<string, { episode: RecentEpisode; languages: Set<"vf" | "vostfr"> }>();
      for (const episode of episodes) {
        if (!followed.has(episode.id) || episode.updatedAt < freshAfter) continue;
        const id = `episode-${episode.id}-${episode.season}-${episode.number}`;
        const group = groupedEpisodes.get(id) ?? { episode, languages: new Set<"vf" | "vostfr">() };
        if (episode.updatedAt > group.episode.updatedAt) group.episode = episode;
        for (const language of episode.availableLanguages ?? [episode.language]) group.languages.add(language);
        groupedEpisodes.set(id, group);
      }
      for (const [id, { episode, languages }] of groupedEpisodes) {
        if (!languages.size || dismissed.includes(id)) continue;
        const available = [
          ...(languages.has("vf") ? ["VF"] : []),
          ...(languages.has("vostfr") ? ["VOSTFR"] : []),
        ];
        result.push({
          id,
          kind: "episode",
          title: `Nouvel épisode · ${episode.titre}`,
          body: `${episode.season} · Épisode ${episode.number} — ${episode.titreEpisode} · Disponible en ${available.join(" et ")}`,
          href: detailHref(episode.id),
        });
      }
    }
    if (user?.preferences.notifications.newsletter && recentAnime.length > 0) {
      const month = new Date().toISOString().slice(0, 7);
      const id = `monthly-selection-${month}`;
      if (!dismissed.includes(id)) result.push({
        id,
        kind: "monthly",
        title: "Sélection mensuelle AnimeVision",
        body: `${recentAnime.length} nouveautés sont à découvrir ce mois-ci.`,
        href: "/catalogue?sort=recent",
      });
    }
    return result;
  }, [announcements, dismissed, episodes, recentAnime, user, watchlist]);

  const value = useMemo<AnnouncementsState>(
    () => ({ announcements, notices, testNotice, ready, dismissed, dismiss, refresh, testNotifications }),
    [announcements, notices, testNotice, ready, dismissed, dismiss, refresh, testNotifications],
  );

  return (
    <AnnouncementsContext.Provider value={value}>{children}</AnnouncementsContext.Provider>
  );
}

export function useAnnouncements(): AnnouncementsState {
  const context = useContext(AnnouncementsContext);
  if (!context) throw new Error("useAnnouncements doit être utilisé dans <AnnouncementsProvider>.");
  return context;
}
