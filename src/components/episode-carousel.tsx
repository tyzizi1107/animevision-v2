"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { FigPlayIcon } from "@/components/figma-icons";
import { CheckIcon } from "@/components/icons";
import { useHeroPreview } from "@/components/hero-preview";
import { ScrollRow } from "@/components/scroll-row";
import { watchHref, type SeasonIndex } from "@/lib/anime-types";
import { useLibrary } from "@/lib/library";
import { cn, episodeDuration, padEpisode } from "@/lib/utils";

type Props = {
  animeId: string;
  seasons: SeasonIndex[];
  fallbackPoster?: string | null;
};

/**
 * Épisodes en carrousel horizontal, avec la progression intégrée à la saison :
 * vignettes 424/167, bouton lecture blanc, barre de progression sur l'épisode
 * en cours, coche sur les épisodes déjà vus, flèches gauche/droite au survol.
 *
 * Chaque saison garde sa propre ligne, empilée sous la précédente ; le numéro
 * d'épisode est le numéro absolu de la série (comme le compteur de la fiche).
 */
export function EpisodeCarousel({ animeId, seasons, fallbackPoster = null }: Props) {
  if (seasons.length === 0) return null;
  return (
    <div className="space-y-10">
      {seasons.map((season) => (
        <SeasonRow key={season.slug} animeId={animeId} season={season} fallbackPoster={fallbackPoster} />
      ))}
    </div>
  );
}

function SeasonRow({ animeId, season, fallbackPoster }: { animeId: string; season: SeasonIndex; fallbackPoster: string | null }) {
  const { progress } = useLibrary();
  const { user } = useAuth();
  const setHeroPreview = useHeroPreview();
  const hideEpisodeImages = user?.preferences.hideEpisodeImages ?? false;
  const showEpisodeDetails = user?.preferences.showEpisodeDetails ?? true;
  const preferredLanguage = user?.preferences.preferredLanguage === "vf" ? "vf" : "vostfr";
  const entry = progress[animeId];
  const [showAll, setShowAll] = useState(false);

  // Épisodes déjà vus : tous ceux qui précèdent l'épisode en cours dans cette
  // saison (on avance épisode par épisode), plus l'épisode courant lui-même
  // s'il est terminé.
  const current = entry?.season === season.slug ? entry.episode : null;
  const currentFinished = Boolean(
    current !== null && entry?.duration && entry?.position && entry.duration - entry.position < 60,
  );

  // Rangée compacte : les huit épisodes autour de l'épisode en cours, pour
  // retrouver sa place sans faire défiler cent vignettes.
  const episodes = showAll || current === null
    ? season.episodes
    : (() => {
      const position = season.episodes.findIndex((item) => item.number === current);
      const anchor = position >= 0 ? position : season.episodes.length - 1;
      const start = Math.max(0, anchor - 2);
      return season.episodes.slice(start, start + 8);
    })();
  const hidden = season.episodes.length - episodes.length;

  return (
    <section className="relative">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className={cn("font-semibold tracking-tight text-white", "text-lg sm:text-[25px] sm:leading-[1.2]")}>
          {season.name}
        </h3>
        <div className="flex items-baseline gap-3">
          <p className="text-[13px] text-[#a79db7]">
            {season.episodes.length} épisode{season.episodes.length > 1 ? "s" : ""}
            {season.year ? ` · ${season.year}` : ""}
          </p>
          {(hidden > 0 || showAll) && season.episodes.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="text-[13px] font-medium text-[#cbb9e6] transition hover:text-white"
            >
              {showAll ? "Réduire" : `Tout voir (${hidden} de plus)`}
            </button>
          )}
        </div>
      </div>

      <ScrollRow label={season.name}>
        {episodes.map((episode) => {
          const playable = episode.hasVo || episode.hasVf;
          const language = preferredLanguage === "vf" && episode.hasVf ? "vf" : episode.hasVo ? "vostfr" : "vf";
          const image = episode.still || fallbackPoster;
          const isCurrent = current === episode.number;
          // Épisode terminé (ou vu avant l'épisode en cours) : coche.
          const watched = isCurrent ? currentFinished : current !== null && episode.number < current;
          // Position réelle quand l'épisode a été commencé, sinon aucun
          // avancement (on n'invente pas une barre de progression).
          const percent = isCurrent && entry?.duration && entry.position && entry.position >= 5
            ? Math.min(100, Math.max(1, (entry.position / entry.duration) * 100))
            : null;
          const remaining = isCurrent && entry?.duration && entry.position
            ? Math.max(1, Math.round((entry.duration - entry.position) / 60))
            : null;

          const card = (
            <>
              <div className="relative aspect-[424/167] overflow-hidden rounded-lg bg-panel">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className={cn(
                      "h-full w-full object-cover transition duration-500 group-hover/cw:scale-[1.03]",
                      hideEpisodeImages && episode.still && "scale-110 blur-xl",
                    )}
                  />
                ) : (
                  <div className="grid h-full place-items-center bg-gradient-to-br from-brand/30 to-panel text-3xl font-black text-white/50">
                    {padEpisode(episode.number)}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-bg/0 via-bg/5 to-bg/95" />
                <div className="absolute bottom-[25px] left-4 flex items-center gap-3.5">
                  {/* Épisode vu : la coche prend la place du bouton lecture ;
                      sinon le bouton lecture habituel. */}
                  {watched ? (
                    <span
                      title="Épisode déjà vu"
                      aria-label="Épisode déjà vu"
                      className="grid h-10 w-10 place-items-center rounded-full bg-brand text-white shadow-[0_6px_18px_rgba(0,0,0,0.55)]"
                    >
                      <CheckIcon className="h-5 w-5" />
                    </span>
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-brand">
                      <FigPlayIcon className="h-5 w-5" />
                    </span>
                  )}
                  {remaining !== null && (
                    <span className="text-xs font-medium text-white">Il reste {remaining} min</span>
                  )}
                </div>
                {/* Barre de progression : pleine une fois l'épisode vu. */}
                {watched || percent !== null ? (
                  <div className="absolute inset-x-4 bottom-[5px] h-[3px] rounded-sm bg-[#544d60]">
                    <div
                      className="h-full rounded-sm bg-brand"
                      style={{ width: `${watched ? 100 : percent}%` }}
                    />
                  </div>
                ) : null}
              </div>
              <div className="pt-3">
                <h4 className="truncate text-base font-semibold text-white">
                  Épisode {episode.number}
                  {showEpisodeDetails && episode.titre ? ` · ${episode.titre}` : ""}
                </h4>
                {/* Durée de l'épisode, toujours à droite sous la vignette
                    (« 24 min ») ; la date reste seulement si elle est connue
                    et qu'aucune durée n'est disponible. */}
                <p className="mt-1 flex items-center justify-between gap-2 text-xs text-[#a79db7]">
                  <span className="truncate">{showEpisodeDetails && episode.titre ? season.name : "Épisode"}</span>
                  <span className="shrink-0 tabular-nums">
                    {episodeDuration(episode.runtime) ?? (episode.airDate || "Durée inconnue")}
                  </span>
                </p>
              </div>
            </>
          );

          const hoverProps = {
            onMouseEnter: () => setHeroPreview(hideEpisodeImages ? null : episode.still ?? null),
            onMouseLeave: () => setHeroPreview(null),
            onFocus: () => setHeroPreview(hideEpisodeImages ? null : episode.still ?? null),
            onBlur: () => setHeroPreview(null),
          };

          return (
            <div key={episode.number} className="group/cw w-[300px] shrink-0 snap-start lg:w-[calc((100%-40px)/3)]">
              {playable ? (
                <Link
                  href={watchHref(animeId, season.slug, episode.number, language)}
                  className="block"
                  {...hoverProps}
                >
                  {card}
                </Link>
              ) : (
                <div className="block opacity-70" {...hoverProps}>
                  {card}
                </div>
              )}
            </div>
          );
        })}
      </ScrollRow>
    </section>
  );
}
