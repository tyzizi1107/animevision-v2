"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { LanguageFlags } from "@/components/language-flags";
import { SearchIcon } from "@/components/icons";
import { watchHref, type SeasonIndex } from "@/lib/anime-types";
import { cn, padEpisode } from "@/lib/utils";

type Props = {
  animeId: string;
  seasons: SeasonIndex[];
  activeSeasonSlug?: string;
  activeEpisode?: number;
  compact?: boolean;
  fallbackPoster?: string | null;
};

export function SeasonEpisodes({
  animeId,
  seasons,
  activeSeasonSlug,
  activeEpisode,
  compact = false,
  fallbackPoster = null,
}: Props) {
  const { user } = useAuth();
  // « auto » = VOSTFR en priorité (comportement historique), « vf » = VF en priorité.
  const preferredLanguage = user?.preferences.preferredLanguage === "vf" ? "vf" : "vostfr";
  const showEpisodeDetails = user?.preferences.showEpisodeDetails ?? true;
  const hideEpisodeImages = user?.preferences.hideEpisodeImages ?? false;
  const initial =
    seasons.find((season) => season.slug === activeSeasonSlug)?.slug ?? seasons[0]?.slug ?? "";
  const [selected, setSelected] = useState(initial);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const season = seasons.find((item) => item.slug === selected) ?? seasons[0];

  if (!season) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
        Aucune saison ni liste d&apos;épisodes n&apos;est disponible pour cette fiche.
      </p>
    );
  }

  const filteredEpisodes = season.episodes.filter((episode) => {
    const needle = query.trim().toLocaleLowerCase("fr-FR");
    return (
      !needle ||
      String(episode.number).includes(needle) ||
      (showEpisodeDetails && (episode.titre ?? "").toLocaleLowerCase("fr-FR").includes(needle))
    );
  });
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(filteredEpisodes.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleEpisodes = filteredEpisodes.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const firstPage = Math.max(0, Math.min(currentPage - 2, pageCount - 5));
  const pages = Array.from({ length: Math.min(pageCount, 5) }, (_, index) => firstPage + index);

  return (
    <div className={compact ? "" : "space-y-9"}>
      {seasons.length > 1 && (
        compact ? (
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {seasons.map((item) => {
              const active = item.slug === season.slug;
              return (
                <button
                  key={item.slug}
                  type="button"
                  onClick={() => {
                    setSelected(item.slug);
                    setPage(0);
                    setQuery("");
                  }}
                  aria-pressed={active}
                  className={cn(
                    "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition",
                    active
                      ? "border-transparent bg-brand text-white"
                      : "border-line bg-white/[0.03] text-muted hover:border-white/20 hover:text-white",
                  )}
                >
                  {item.name}
                  <span className={cn("ml-1.5 text-[10px]", active ? "text-white/70" : "text-muted/60")}>
                    {item.episodes.length}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <section>
            <SectionHeading title="Saisons" detail={`${seasons.length} au total`} />
            <div className="no-scrollbar -mx-4 mt-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:gap-4 sm:px-0">
              {seasons.map((item) => {
                const active = item.slug === season.slug;
                const poster = item.affiche;
                return (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => {
                      setSelected(item.slug);
                      setPage(0);
                      setQuery("");
                    }}
                    aria-pressed={active}
                    className="group w-[112px] shrink-0 snap-start text-left sm:w-[136px]"
                  >
                    <span
                      className={cn(
                        "relative block aspect-[2/3] overflow-hidden rounded-xl border bg-panel transition",
                        active
                          ? "border-brand ring-2 ring-brand/70 ring-offset-2 ring-offset-bg"
                          : "border-white/10 group-hover:border-white/35",
                      )}
                    >
                      {poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={poster}
                          alt=""
                          loading="lazy"
                          className={cn(
                            "h-full w-full object-cover transition duration-500 group-hover:scale-105",
                            !active && "brightness-75 group-hover:brightness-100",
                          )}
                        />
                      ) : (
                        <span className="grid h-full place-items-center bg-gradient-to-br from-brand/20 to-panel text-3xl font-black text-white/30">
                          {item.name.slice(0, 1)}
                        </span>
                      )}
                    </span>
                    <span className="mt-2 block truncate text-xs font-semibold text-white/90">{item.name}</span>
                    <span className="mt-0.5 block text-[10px] text-muted">
                      {item.year ? `${item.year} · ` : ""}
                      {item.episodes.length} épisode{item.episodes.length > 1 ? "s" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )
      )}

      {!compact && (
        <section>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <SectionHeading title="Épisodes" detail={`${season.name} · ${season.episodes.length} épisodes`} />
            </div>
            <label className="relative block w-full sm:max-w-[290px]">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                placeholder="Aller à l’épisode…"
                aria-label="Rechercher un épisode"
                className="h-10 w-full rounded-full border border-white/10 bg-white/[0.045] pl-10 pr-4 text-xs text-white placeholder:text-muted focus:border-brand/50 focus:outline-none"
              />
            </label>
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {pages.map((pageIndex) => {
                const start = pageIndex * pageSize + 1;
                const end = Math.min((pageIndex + 1) * pageSize, filteredEpisodes.length);
                return (
                  <button
                    key={pageIndex}
                    type="button"
                    onClick={() => setPage(pageIndex)}
                    aria-pressed={pageIndex === currentPage}
                    className={cn(
                      "rounded-full border px-3.5 py-2 text-[11px] font-semibold transition",
                      pageIndex === currentPage
                        ? "border-brand bg-brand/10 text-brand-2"
                        : "border-white/10 text-muted hover:border-white/25 hover:text-white",
                    )}
                  >
                    {start}–{end}
                  </button>
                );
              })}
            </div>
          )}

          {visibleEpisodes.length ? (
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {visibleEpisodes.map((episode) => {
                const playable = episode.hasVo || episode.hasVf;
                const language =
                  preferredLanguage === "vf" && episode.hasVf
                    ? "vf"
                    : episode.hasVo
                      ? "vostfr"
                      : "vf";
                const image = hideEpisodeImages ? episode.still : episode.still || fallbackPoster;
                const card = (
                  <>
                    <span className="group relative block aspect-[1.5/1] overflow-hidden rounded-xl bg-panel">
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={image}
                          alt=""
                          loading="lazy"
                          className={cn(
                            "h-full w-full object-cover transition duration-500 group-hover:scale-105",
                            hideEpisodeImages && "scale-110 blur-xl",
                          )}
                        />
                      ) : (
                        <span className="grid h-full place-items-center bg-gradient-to-br from-brand/20 to-panel text-4xl font-black text-white/25">
                          {padEpisode(episode.number)}
                        </span>
                      )}
                      {hideEpisodeImages && image && (
                        <span className="absolute bottom-2 right-2 rounded-full border border-white/15 bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white/80 backdrop-blur-sm">
                          Image floutée
                        </span>
                      )}
                      <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                      <LanguageFlags languages={[...(episode.hasVo ? ["vostfr" as const] : []), ...(episode.hasVf ? ["vf" as const] : [])]} />
                    </span>
                    <span className="block px-1 pt-2">
                      <span className="block truncate text-sm font-bold text-white transition group-hover:text-brand-2">{showEpisodeDetails ? episode.titre || `Épisode ${episode.number}` : `Épisode ${episode.number}`}</span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="truncate">Épisode {episode.number}{showEpisodeDetails && episode.airDate ? ` · ${episode.airDate}` : ""}</span>
                        <span className="shrink-0">
                          {showEpisodeDetails
                            ? episode.runtime
                              ? `${episode.runtime} min`
                              : playable
                                ? "Disponible"
                                : "Indisponible"
                            : "Durée indisponible"}
                        </span>
                      </span>
                    </span>
                  </>
                );

                const className = cn(
                  "group block min-w-0 text-left transition",
                  playable
                    ? "hover:-translate-y-0.5"
                    : "opacity-75",
                );

                return (
                  <article key={episode.number}>
                    {playable ? (
                      <Link
                        href={watchHref(animeId, season.slug, episode.number, language)}
                        className={className}
                      >
                        {card}
                      </Link>
                    ) : (
                      <div className={className} aria-disabled="true">
                        {card}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="mt-5 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted">
              Aucun épisode ne correspond à cette recherche.
            </p>
          )}
        </section>
      )}

      {compact && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel/50">
          {season.episodes.map((episode) => {
          const playable = episode.hasVo || episode.hasVf;
          const language =
            preferredLanguage === "vf" && episode.hasVf
              ? "vf"
              : episode.hasVo
                ? "vostfr"
                : "vf";
          const active =
            activeEpisode === episode.number && season.slug === activeSeasonSlug;
          const rowClassName = cn("flex items-center gap-3.5 px-3.5 py-2.5", active && "bg-white/[0.05]", playable && "group transition-colors hover:bg-white/[0.045]");
          const rowContent = (
            <>
              <span
                className={cn(
                  "shrink-0 text-center font-mono text-[11px] font-semibold tabular-nums",
                  compact ? "w-6" : "w-7",
                  active ? "text-brand-2" : "text-muted",
                )}
              >
                {padEpisode(episode.number)}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate font-medium",
                    "text-[13px]",
                    active ? "text-white" : "text-white/85",
                  )}
                >
                  {showEpisodeDetails ? episode.titre || `Épisode ${episode.number}` : `Épisode ${episode.number}`}
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
                  {showEpisodeDetails && episode.airDate && <span>{episode.airDate}</span>}
                  {!playable && <span>Aucun lecteur disponible</span>}
                  {active && <span className="text-brand-2">En cours</span>}
                </p>
              </div>

            </>
          );

          return (
            <li key={episode.number}>
              {playable ? (
                <Link
                  href={watchHref(animeId, season.slug, episode.number, language)}
                  className={rowClassName}
                >
                  {rowContent}
                </Link>
              ) : (
                <div className={rowClassName} aria-disabled="true">
                  {rowContent}
                </div>
              )}
            </li>
          );
          })}
        </ul>
      )}
    </div>
  );
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <h2 className="text-lg font-bold tracking-tight text-white sm:text-xl">{title}</h2>
      <p className="mt-1 text-xs text-muted">{detail}</p>
      <span className="mt-2 block h-0.5 w-11 rounded-full bg-brand" />
    </div>
  );
}
