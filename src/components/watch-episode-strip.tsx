"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import type { AnimeLanguage, AnimeSeason } from "@/lib/anime-types";
import { watchHref } from "@/lib/anime-types";
import { cn, padEpisode } from "@/lib/utils";

type Props = {
  animeId: string;
  seasons: AnimeSeason[];
  activeSeasonSlug: string;
  activeEpisode: number;
  language: AnimeLanguage;
  fallbackPoster: string | null;
};

export function WatchEpisodeStrip({ animeId, seasons, activeSeasonSlug, activeEpisode, language, fallbackPoster }: Props) {
  const [seasonSlug, setSeasonSlug] = useState(activeSeasonSlug);
  const { user } = useAuth();
  const hideEpisodeImages = user?.preferences.hideEpisodeImages ?? false;
  const showEpisodeDetails = user?.preferences.showEpisodeDetails ?? true;
  const activeSeason = seasons.find((season) => season.slug === seasonSlug) ?? seasons[0];
  const currentRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    setSeasonSlug(activeSeasonSlug);
  }, [activeSeasonSlug]);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeSeasonSlug, activeEpisode]);

  if (!activeSeason) return null;

  return (
    <section className="mt-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-2">Continuer la série</p>
          <h2 className="mt-1 text-lg font-bold text-white">Épisodes</h2>
        </div>
        <div className="flex items-center gap-2">
          {seasons.length > 1 && (
            <select value={activeSeason.slug} onChange={(event) => setSeasonSlug(event.target.value)} aria-label="Choisir une saison" className="av-select h-9 max-w-[220px] rounded-full border border-white/10 bg-[#111114] px-3 text-xs font-semibold text-white outline-none transition focus:border-brand/60">
              {seasons.map((season) => <option key={season.slug} value={season.slug}>{season.name}</option>)}
            </select>
          )}
          <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-[10px] font-semibold text-muted">{activeSeason.episodes.length} épisodes</span>
        </div>
      </div>

      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:gap-4 sm:px-0">
        {activeSeason.episodes.map((episode) => {
          const playable = language === "vf" ? episode.vf.length > 0 || episode.availableLanguages?.includes("vf") : episode.vo.length > 0 || episode.availableLanguages?.includes("vostfr");
          const href = watchHref(animeId, activeSeason.slug, episode.number, playable ? language : (episode.vo.length > 0 ? "vostfr" : "vf"));
          const image = hideEpisodeImages ? episode.still : episode.still || fallbackPoster;
          const isCurrent = activeSeason.slug === activeSeasonSlug && episode.number === activeEpisode;
          const card = (
            <>
              <span className={cn("relative block aspect-video overflow-hidden rounded-xl bg-panel", isCurrent && "ring-2 ring-brand ring-offset-2 ring-offset-bg")}>
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" className={cn("h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]", hideEpisodeImages && episode.still && "scale-110 blur-xl")} />
                ) : <span className="grid h-full place-items-center bg-gradient-to-br from-brand/20 to-panel text-2xl font-black text-white/30">{padEpisode(episode.number)}</span>}
                <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                <span className="absolute bottom-2 left-2.5 rounded-md bg-black/65 px-2 py-1 text-[10px] font-bold text-white backdrop-blur-sm">Ép. {padEpisode(episode.number)}</span>
                {isCurrent && <span className="absolute right-2 top-2 rounded-full bg-brand px-2 py-1 text-[9px] font-bold text-white">En cours</span>}
              </span>
              <span className="mt-2 block truncate text-xs font-semibold text-white/85 transition group-hover:text-brand-2">
                {showEpisodeDetails ? episode.titre || `Épisode ${episode.number}` : `Épisode ${episode.number}`}
              </span>
            </>
          );
          const className = cn("group w-[190px] shrink-0 snap-start text-left", !playable && "cursor-default opacity-60");
          return playable ? (
            <Link key={episode.number} ref={isCurrent ? currentRef : undefined} href={href} className={className}>{card}</Link>
          ) : (
            <div key={episode.number} className={className} aria-disabled="true">{card}</div>
          );
        })}
      </div>
    </section>
  );
}
