"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SynopsisScroller } from "@/components/synopsis-scroller";
import { ChevronRightIcon } from "@/components/icons";
import { FigInfoIcon, FigNextIcon, FigPlayIcon, FigPrevIcon } from "@/components/figma-icons";
import { WatchlistButton } from "@/components/watchlist-button";
import { watchHref, typeLabel, type AnimeSummary, type SeasonIndex, detailHref } from "@/lib/anime-types";
import { useAuth } from "@/components/auth/auth-provider";
import { useLibrary } from "@/lib/library";
import { cn } from "@/lib/utils";

export type HeroItem = {
  anime: AnimeSummary;
  playHref?: string;
  /** Saisons de la fiche : servent à retrouver l'épisode déjà commencé. */
  seasons?: SeasonIndex[];
};

export function HeroCarousel({ items }: { items: HeroItem[] }) {
  const { progress } = useLibrary();
  const { user } = useAuth();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || items.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % items.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [items.length, paused]);

  if (items.length === 0) return <EmptyHero />;

  const current = items[Math.min(index, items.length - 1)]!;

  // Même logique que la fiche : « Reprendre » (et l'épisode exact) si un
  // épisode de cette série a déjà été commencé, « Regarder » sinon.
  const resume = (() => {
    const entry = progress[current.anime.id];
    if (!user || !entry || !current.seasons?.length) return null;
    const season = current.seasons.find((item) => item.slug === entry.season);
    const episode = season?.episodes.find((item) => item.number === entry.episode);
    if (!season || !episode) return null;
    return {
      href: watchHref(current.anime.id, season.slug, episode.number, entry.language),
      label: `${season.name} · Épisode ${episode.number}`,
    };
  })();
  const playTarget = resume?.href ?? current.playHref ?? detailHref(current.anime.id);

  return (
    <section
      className="relative min-h-[520px] lg:min-h-[600px] w-full overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {items.map((item, itemIndex) => (
        <div
          key={item.anime.id}
          className={cn(
            "absolute inset-0 transition-opacity duration-700",
            itemIndex === index ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          aria-hidden={itemIndex !== index}
        >
          {item.anime.banniere ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.anime.banniere}
              alt=""
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover object-center"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-brand/20 via-bg to-accent/10" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/90 via-[38%] to-bg/0" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/[0.02] via-[68%] to-bg" />
        </div>
      ))}

      <div className="relative mx-auto flex min-h-[520px] lg:min-h-[600px] max-w-[1440px] flex-col justify-center px-4 pb-20 pt-24 sm:px-6 lg:px-16">
        <div className="max-w-[650px]">
          {current.anime.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.anime.logo}
              alt={current.anime.titre}
              referrerPolicy="no-referrer"
              className="max-h-32 w-auto max-w-[min(100%,440px)] object-contain object-left drop-shadow-[0_12px_40px_rgba(0,0,0,0.9)]"
            />
          ) : (
            <h1 className="text-3xl font-extrabold uppercase leading-[1.05] tracking-[-0.01em] text-white sm:text-4xl lg:text-[44px] lg:leading-[46px]">
              {current.anime.titre}
            </h1>
          )}
          {current.anime.logo && <p className="sr-only">{current.anime.titre}</p>}

          <SynopsisScroller key={current.anime.id} text={current.anime.synopsis || "Synopsis indisponible pour le moment."} />

          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-medium text-[#c2b9cf]">
            {/^\d{4}/.test(current.anime.date ?? "") && (
              <span className="text-[#e2dcea]">{current.anime.date.slice(0, 4)}</span>
            )}
            <span className="rounded bg-[#271d36] px-[7px] py-[5px] text-xs text-white">{current.anime.type === "film" ? "Film" : "Série"}</span>
            {current.anime.genres.length > 0 && (
              <>
                <span aria-hidden="true">•</span>
                <span className="truncate">{current.anime.genres.slice(0, 2).join("  •  ")}</span>
              </>
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={playTarget}
              className="inline-flex h-11 items-center gap-2.5 rounded-md bg-brand px-4 pr-6 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98]"
            >
              <FigPlayIcon className="h-5 w-5" />
              {resume ? "Reprendre" : "Regarder"}
            </Link>
            <Link
              href={detailHref(current.anime.id)}
              className="inline-flex h-11 items-center gap-2.5 rounded-md bg-white/[0.12] px-4 pr-6 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-[0.98]"
            >
              <FigInfoIcon className="h-5 w-5" />
              Plus d’infos
            </Link>
            <WatchlistButton
              animeId={current.anime.id}
              showLabel={false}
              className="!h-11 !w-11 !rounded-md !border-0 !bg-white/[0.12] hover:!bg-white/20"
            />
          </div>

          {/* Où reprendre : la saison et l'épisode exacts, comme sur la fiche. */}
          {resume && (
            <p className="mt-3 text-xs text-[#c2b9cf]">
              <span className="font-semibold text-white">{resume.label}</span>
            </p>
          )}
        </div>

        {items.length > 1 && (
          <div className="absolute inset-x-4 bottom-8 flex items-center justify-between sm:inset-x-6 lg:inset-x-16">
            <div className="flex items-center gap-2">
              {items.map((item, itemIndex) => (
                <button
                  key={item.anime.id}
                  type="button"
                  onClick={() => setIndex(itemIndex)}
                  aria-label={`Voir ${item.anime.titre}`}
                  aria-pressed={itemIndex === index}
                  className={cn(
                    "h-1 rounded-sm bg-white transition-all",
                    itemIndex === index ? "w-[34px]" : "w-3.5 opacity-25 hover:opacity-60",
                  )}
                />
              ))}
            </div>
            <div className="flex items-center gap-4 text-white">
              <button type="button" aria-label="Précédent" onClick={() => setIndex((index - 1 + items.length) % items.length)}>
                <FigPrevIcon className="h-6 w-6" />
              </button>
              <button type="button" aria-label="Suivant" onClick={() => setIndex((index + 1) % items.length)}>
                <FigNextIcon className="h-6 w-6" />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyHero() {
  return (
    <section className="relative flex min-h-[78svh] items-center overflow-hidden">
      <div
        aria-hidden="true"
      />
      <div
        aria-hidden="true"
      />
      <div className="relative mx-auto w-full max-w-[1600px] px-4 pb-20 pt-24 sm:px-6 lg:px-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-2">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Catalogue en préparation
        </span>
        <h1 className="mt-5 max-w-2xl text-4xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl">
          Votre prochain animé
          <br />
          commence ici.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
          La base est vide pour le moment. Ajoutez vos fiches et leurs saisons, puis le
          catalogue, les rangées et la reprise de lecture se rempliront automatiquement.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            href="/catalogue"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-brand px-6 text-sm font-bold text-white transition hover:brightness-105"
          >
            Ouvrir le catalogue
            <ChevronRightIcon className="h-4 w-4" />
          </Link>
          <Link
            href="/calendrier"
            className="inline-flex h-11 items-center rounded-full border border-line px-5 text-sm font-medium text-white/80 transition hover:border-white/25 hover:text-white"
          >
            Voir le calendrier
          </Link>
        </div>

        <div className="mt-14 grid max-w-3xl gap-3 sm:grid-cols-3">
          {[
            { title: "Fiches & saisons", detail: "Formats VO/VF, sources multiples." },
            { title: "Comptes", detail: "Sessions 60 jours et préférences." },
            { title: "Annonces", detail: "Centre de messages + notifications." },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl border border-line bg-panel/50 p-4">
              <p className="text-sm font-semibold text-white/90">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
