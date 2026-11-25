"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimeCard } from "@/components/anime-card";
import { TrashIcon } from "@/components/icons";
import { useLibrary } from "@/lib/library";
import type { AnimeSummary } from "@/lib/anime-types";

export function LibraryView() {
  const { watchlist, toggle } = useLibrary();
  const [animes, setAnimes] = useState<Record<string, AnimeSummary>>({});
  const idsKey = watchlist.join(",");

  useEffect(() => {
    if (!idsKey) {
      setAnimes({});
      return;
    }

    let active = true;
    fetch(`/api/animes?ids=${encodeURIComponent(idsKey)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { items?: AnimeSummary[] } | null) => {
        if (!active || !data?.items) return;
        setAnimes(Object.fromEntries(data.items.map((item) => [item.id, item])));
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [idsKey]);

  const saved = watchlist.flatMap((id) => {
    const anime = animes[id];
    return anime ? [anime] : [];
  });

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight sm:text-xl">Ma liste</h2>
          <p className="mt-1 text-sm text-muted">
            {watchlist.length > 0
              ? `${watchlist.length} ${watchlist.length > 1 ? "animés sauvegardés" : "animé sauvegardé"}`
              : "Vos animés sauvegardés apparaîtront ici."}
          </p>
        </div>
      </div>

      {watchlist.length > 0 && saved.length === 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 xl:grid-cols-6">
          {watchlist.slice(0, 12).map((id) => (
            <div key={id} className="aspect-[2/3] animate-pulse rounded-2xl border border-line bg-panel/50" />
          ))}
        </div>
      ) : saved.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 xl:grid-cols-6">
          {saved.map((anime) => (
            <div key={anime.id} className="group/remove relative">
              <AnimeCard anime={anime} fluid />
              <button
                type="button"
                onClick={() => toggle(anime.id)}
                aria-label={`Retirer ${anime.titre} de ma liste`}
                className="absolute left-2 top-2 z-10 hidden h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/70 text-white/80 backdrop-blur transition hover:border-red-400/50 hover:bg-red-500/80 hover:text-white group-hover/remove:grid"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-line bg-panel/40 px-6 py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand/30 to-brand-2/20 text-white">
            <TrashIcon className="h-6 w-6" />
          </div>
          <h3 className="mt-5 text-lg font-bold">Votre liste est vide</h3>
          <p className="mt-1.5 max-w-sm text-sm text-muted">
            Ajoutez des animés avec le bouton « Ma liste » sur une fiche ou depuis le catalogue.
          </p>
          <Link
            href="/catalogue"
            className="mt-6 inline-flex h-10 items-center rounded-full bg-brand px-5 text-sm font-semibold text-white transition hover:brightness-105"
          >
            Explorer le catalogue
          </Link>
        </div>
      )}
    </section>
  );
}
