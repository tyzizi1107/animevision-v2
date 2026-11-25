"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FigPlayIcon } from "@/components/figma-icons";
import { SectionRow } from "@/components/section-row";
import { useAuth } from "@/components/auth/auth-provider";
import { LanguageFlags } from "@/components/language-flags";
import { watchHref, type AnimeSummary } from "@/lib/anime-types";
import { useLibrary } from "@/lib/library";
import { padEpisode } from "@/lib/utils";
import { getClientCached } from "@/lib/client-cache";

type EpisodeDisplay = { seasonName: string; title: string | null; still: string | null };

export function ContinueWatching({ limit = 8 }: { limit?: number }) {
  const { progress, clear } = useLibrary();
  const { user, loading: authLoading } = useAuth();
  const hideEpisodeImages = user?.preferences.hideEpisodeImages ?? false;
  const showEpisodeDetails = user?.preferences.showEpisodeDetails ?? true;

  // « Reprendre la lecture » est réservé aux comptes connectés : la liste
  // vient de la progression MongoDB, jamais du stockage local.
  const entries = !authLoading && user
    ? Object.entries(progress)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, limit)
    : [];
  const idsKey = entries.map(([id]) => id).join(",");
  const episodesKey = entries.map(([id, entry]) => `${id}:${entry.season}:${entry.episode}`).join(",");

  const [animes, setAnimes] = useState<Record<string, AnimeSummary>>({});
  const [episodeDetails, setEpisodeDetails] = useState<Record<string, EpisodeDisplay>>({});

  const episodeKey = (id: string, season: string, episode: number) => `${id}:${season}:${episode}`;

  useEffect(() => {
    if (!idsKey) return;
    let active = true;

    const load = async () => getClientCached(`continue:${user?.id ?? "guest"}:${episodesKey}`, 0, async () => {
      const [animeResponse, detailsResponse] = await Promise.all([
        fetch(`/api/animes?ids=${encodeURIComponent(idsKey)}`),
        fetch("/api/animes/progress-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: entries.map(([id, entry]) => ({ id, season: entry.season, episode: entry.episode })) }),
        }),
      ]);
      const [animeData, detailsData] = await Promise.all([
        animeResponse.ok ? animeResponse.json() as Promise<{ items?: AnimeSummary[] }> : null,
        detailsResponse.ok ? detailsResponse.json() as Promise<{ items?: Array<{ id: string; season: string; episode: number; seasonName: string; title: string | null; still: string | null }> }> : null,
      ]);
      return {
        animes: animeData?.items ? Object.fromEntries(animeData.items.map((item) => [item.id, item])) : null,
        details: detailsData?.items ? Object.fromEntries(detailsData.items.map((item) => [
          episodeKey(item.id, item.season, item.episode),
          { seasonName: item.seasonName, title: item.title, still: item.still },
        ])) : null,
      };
    });

    void load()
      .then(({ animes: loadedAnimes, details }) => {
        if (!active) return;
        if (loadedAnimes) setAnimes(loadedAnimes);
        if (details) setEpisodeDetails(details);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [idsKey, episodesKey, user?.id]);

  const visible = entries.flatMap(([id, entry]) => {
    const anime = animes[id];
    return anime ? [{ anime, entry }] : [];
  });

  if (visible.length === 0) return null;

  return (
    <SectionRow
      title="Reprendre la lecture"
      subtitle="La suite de vos histoires préférées."
    >
      {visible.map(({ anime, entry }) => {
        const detail = episodeDetails[episodeKey(anime.id, entry.season, entry.episode)];
        const seasonName = detail?.seasonName || entry.seasonName || "Saison";
        // Part de l'épisode déjà vue, d'après la position et la durée réelles.
        const percent = typeof entry.position === "number" && entry.position >= 5
          ? Math.min(100, Math.max(2, entry.duration && entry.duration > 0 ? (entry.position / entry.duration) * 100 : 2))
          : null;
        return (
        <div key={anime.id} className="group group/cw relative w-[300px] shrink-0 snap-start lg:w-[calc((100%-40px)/3)]">
          <Link
            href={watchHref(anime.id, entry.season, entry.episode, entry.language)}
            className="block"
          >
            <div className="relative aspect-[424/167] overflow-hidden rounded-lg bg-panel">
              {detail?.still || anime.affiche ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={detail?.still || anime.affiche || ""}
                  alt=""
                  loading="lazy"
                  className={`h-full w-full object-cover transition duration-500 group-hover/cw:scale-[1.03] ${hideEpisodeImages && detail?.still ? "scale-110 blur-xl" : ""}`}
                />
              ) : (
                <div className="grid h-full place-items-center bg-gradient-to-br from-brand/30 to-panel text-3xl font-black text-white/50">
                  {anime.titre.slice(0, 1)}
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-bg/0 via-bg/5 to-bg/95" />
              <div className="absolute bottom-[25px] left-4 flex items-center gap-3.5">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-brand">
                  <FigPlayIcon className="h-5 w-5" />
                </span>
                {entry.duration && entry.position ? (
                  <span className="text-xs font-medium text-white">
                    Il reste {Math.max(1, Math.round((entry.duration - entry.position) / 60))} min
                  </span>
                ) : null}
              </div>
              {percent !== null && (
                <div className="absolute inset-x-4 bottom-[5px] h-[3px] rounded-sm bg-[#544d60]">
                  <div className="h-full rounded-sm bg-brand" style={{ width: `${percent}%` }} />
                </div>
              )}
            </div>
            <div className="pr-8 pt-3">
              <h3 className="truncate text-base font-semibold text-white">{anime.titre}</h3>
              <p className="mt-1 truncate text-xs text-[#a79db7]">
                {anime.type === "film"
                  ? `Film${entry.duration ? ` · ${Math.floor(entry.duration / 3600) ? `${Math.floor(entry.duration / 3600)} h ` : ""}${String(Math.floor((entry.duration % 3600) / 60)).padStart(2, "0")} min` : ""}`
                  : `${seasonName.replace(/^Saison\s*/i, "S")} : E${entry.episode}${showEpisodeDetails && detail?.title ? ` · ${detail.title}` : ""}`}
              </p>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => clear(anime.id)}
            aria-label={`Retirer ${anime.titre} de la reprise`}
            className="absolute bottom-[26px] right-0 text-base font-bold leading-none text-[#b3a8c2] transition hover:text-white"
          >
            •••
          </button>
        </div>
        );
      })}
    </SectionRow>
  );
}
