"use client";

import Link from "next/link";
import { StarIcon } from "@/components/icons";
import { PosterImage } from "@/components/poster-image";
import { type AnimeSummary, detailHref } from "@/lib/anime-types";
import { useLibrary } from "@/lib/library";
import { cn, padEpisode } from "@/lib/utils";

/**
 * Part du temps de l'épisode déjà vue, ou `null` s'il n'a pas été commencé.
 * Le pourcentage vient de la position et de la durée réelles de l'épisode.
 */
function progressPercentOf(entry: { position?: number; duration?: number } | undefined): number | null {
  if (!entry || typeof entry.position !== "number" || entry.position < 5) return null;
  const total = entry.duration && entry.duration > 0 ? entry.duration : 0;
  if (!total) return 2;
  return Math.min(100, Math.max(2, (entry.position / total) * 100));
}

export function AnimeCard({
  anime,
  className,
  fluid = false,
  showScore = false,
  showYear = false,
}: {
  anime: AnimeSummary;
  className?: string;
  /** Remplit la largeur de son conteneur (grilles) au lieu d'une largeur fixe (carrousels). */
  fluid?: boolean;
  showScore?: boolean;
  /** Affiche l'année de première diffusion après le titre (page catalogue). */
  showYear?: boolean;
}) {
  const year = /^\d{4}/.test(anime.date ?? "") ? anime.date.slice(0, 4) : "";
  const isNew = year !== "" && Number(year) >= new Date().getFullYear();
  const { progress } = useLibrary();
  const entry = progress[anime.id];
  const watchedPercent = progressPercentOf(entry);
  // Repère de développement : visible en console pour comprendre une barre absente.
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    console.debug("[progression]", anime.id, entry ?? "aucune entrée", watchedPercent);
  }

  return (
    <Link
      href={detailHref(anime.id)}
      className={cn(
        "group/card block",
        fluid ? "w-full" : "w-[148px] shrink-0 snap-start sm:w-[190px] lg:w-[calc((100%-80px)/5)]",
        className,
      )}
    >
      <div className="relative aspect-[246.4/300] overflow-hidden rounded-lg bg-panel transition duration-300">
        <PosterImage
          src={anime.affiche}
          alt={anime.titre}
          className="transition-transform duration-700 ease-out group-hover/card:scale-[1.06]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg/95 via-bg/5 to-transparent" />

        {isNew && (
          <span className="absolute right-4 top-4 rounded-[3px] bg-brand px-3 py-1 text-[9px] font-bold uppercase text-white">
            Nouveauté
          </span>
        )}

        {showScore && Number(anime.score) > 0 && (
          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/25 px-2 py-0.5 text-[10px] font-bold text-brand-2 backdrop-blur-sm">
            <StarIcon className="h-2.5 w-2.5" />
            {Number.isFinite(Number(anime.score)) ? Number(anime.score).toFixed(1) : "0.0"}
          </span>
        )}

        {entry && (
          <div className="absolute inset-x-2 bottom-2 rounded-full bg-black/70 px-2.5 py-1 text-center text-[10px] font-medium text-white/85 backdrop-blur-sm">
            {entry.seasonName ?? "Saison"} · Ép. {padEpisode(entry.episode)}
          </div>
        )}

        {/* Progression dans l'épisode en cours (reprise à la minute près) */}
        {watchedPercent !== null && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
            <div
              className="h-full rounded-r-full bg-[#41009a]"
              style={{ width: `${watchedPercent}%` }}
            />
          </div>
        )}
      </div>

      <div className="mt-3 px-0.5">
        <h3 className="truncate text-base font-bold text-white transition-colors group-hover/card:text-brand-2">
          {anime.titre}
          {showYear && year ? <span className="ml-1 font-normal text-muted">({year})</span> : null}
        </h3>
        <p className="mt-1 truncate text-[13px] font-medium text-[#b3a8c2]">
          {anime.type === "film" ? "Film" : "Série"}{year ? ` • ${year}` : ""}
        </p>
      </div>
    </Link>
  );
}
