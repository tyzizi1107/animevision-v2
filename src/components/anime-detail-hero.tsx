"use client";

import Link from "next/link";
import { useState } from "react";
import { HeroBackdrop } from "@/components/hero-backdrop";
import { FigPlayIcon } from "@/components/figma-icons";
import { HeroPreviewContext } from "@/components/hero-preview";
import { useAuth } from "@/components/auth/auth-provider";
import { useLibrary } from "@/lib/library";
import { watchHref, type SeasonIndex } from "@/lib/anime-types";
import { SynopsisScroller } from "@/components/synopsis-scroller";
import { WatchlistButton } from "@/components/watchlist-button";
import { cn } from "@/lib/utils";

type Props = {
  animeId: string;
  titre: string;
  logo: string | null;
  synopsis: string;
  image: string | null;
  year: number | null;
  typeLabel: string;
  genres: string[];
  playHref: string | null;
  isMovie: boolean;
  hasVostfr: boolean;
  hasVf: boolean;
  seasons: SeasonIndex[];
  children?: React.ReactNode;
};

/**
 * Hero de la fiche anime, aux dimensions exactes de celui de l'accueil
 * (min-h 520 px, 600 px à partir de lg) : même grille, mêmes dégradés, même
 * typographie. L'image de fond suit l'épisode survolé dans la liste.
 */
export function AnimeDetailHero({
  animeId,
  titre,
  logo,
  synopsis,
  image,
  year,
  typeLabel,
  genres,
  playHref,
  isMovie,
  hasVostfr,
  hasVf,
  seasons,
  children,
}: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const { progress } = useLibrary();
  const { user } = useAuth();
  const entry = progress[animeId];

  // Reprise : l'épisode déjà commencé sur CET anime, s'il y en a un. Le bouton
  // devient « Reprendre », et la saison + l'épisode exacts s'affichent juste
  // à côté, en légende grise.
  const resume = (() => {
    if (!user || !entry) return null;
    const season = seasons.find((item) => item.slug === entry.season);
    const episode = season?.episodes.find((item) => item.number === entry.episode);
    if (!season || !episode) return null;
    const position = typeof entry.position === "number" ? entry.position : 0;
    const remaining = entry.duration && position
      ? Math.max(1, Math.round((entry.duration - position) / 60))
      : null;
    return {
      href: watchHref(animeId, season.slug, episode.number, entry.language),
      label: `${season.name} · Épisode ${episode.number}`,
      remaining,
    };
  })();
  const target = resume?.href ?? playHref;

  return (
    <section className="relative min-h-[520px] w-full overflow-hidden lg:min-h-[600px]" onMouseLeave={() => setPreview(null)}>
      <HeroBackdrop image={preview ?? image} />
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/90 via-[38%] to-bg/0" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/[0.02] via-[68%] to-bg" />

      <div className="relative mx-auto flex min-h-[520px] max-w-[1440px] flex-col justify-center px-4 pb-20 pt-24 sm:px-6 lg:min-h-[600px] lg:px-16">
        <HeroPreviewContext.Provider value={setPreview}>
          <div className="max-w-[650px]">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo}
                alt={titre}
                referrerPolicy="no-referrer"
                className="max-h-32 w-auto max-w-[min(100%,440px)] object-contain object-left drop-shadow-[0_12px_40px_rgba(0,0,0,0.9)]"
              />
            ) : (
              <h1 className="text-3xl font-extrabold uppercase leading-[1.05] tracking-[-0.01em] text-white sm:text-4xl lg:text-[44px] lg:leading-[46px]">
                {titre}
              </h1>
            )}
            {logo && <p className="sr-only">{titre}</p>}

            <SynopsisScroller text={synopsis || "Synopsis indisponible pour le moment."} />

            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-medium text-[#c2b9cf]">
              {year && <span className="text-[#e2dcea]">{year}</span>}
              <span className="rounded bg-[#271d36] px-[7px] py-[5px] text-xs text-white">{typeLabel}</span>
              {genres.length > 0 && (
                <>
                  <span aria-hidden="true">•</span>
                  <span className="truncate">{genres.slice(0, 2).join("  •  ")}</span>
                </>
              )}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {target ? (
                <Link
                  href={target}
                  className="inline-flex h-11 items-center gap-2.5 rounded-md bg-brand px-4 pr-6 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98]"
                >
                  <FigPlayIcon className="h-5 w-5" />
                  {resume ? "Reprendre" : "Regarder"}
                </Link>
              ) : (
                <span className="inline-flex h-11 items-center rounded-md border border-white/15 bg-black/30 px-4 text-sm text-white/55">
                  Aucun lecteur disponible
                </span>
              )}
              <WatchlistButton
                animeId={animeId}
                showLabel={false}
                className="!h-11 !w-11 !rounded-md !border-0 !bg-white/[0.12] hover:!bg-white/20"
              />
              {/* Langues disponibles : un simple texte, rien à cliquer. */}
              <span className="ml-1 flex items-center gap-2 text-sm font-semibold">
                <span className={hasVostfr ? "text-white" : "text-white/35"}>VOSTFR</span>
                <span aria-hidden="true" className="text-white/25">
                  /
                </span>
                <span className={hasVf ? "text-white" : "text-white/35"}>VF</span>
              </span>
            </div>

            {/* Où reprendre : la saison et l'épisode exacts, sous les boutons. */}
            {resume && (
              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#c2b9cf]">
                <span className="font-semibold text-white">{resume.label}</span>
                {resume.remaining !== null && (
                  <span className="text-[#a79db7]">· il reste {resume.remaining} min</span>
                )}
              </p>
            )}
          </div>

          {children}
        </HeroPreviewContext.Provider>
      </div>
    </section>
  );
}
