"use client";

import { detailHref } from "@/lib/anime-types";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SectionRow } from "@/components/section-row";
import { useAuth } from "@/components/auth/auth-provider";
import type { RecentEpisode } from "@/lib/animes";
import { LanguageFlags } from "@/components/language-flags";
import { getClientCached } from "@/lib/client-cache";

function formatDate(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function RecentEpisodes() {
  const { user } = useAuth();
  const hideEpisodeImages = user?.preferences.hideEpisodeImages ?? false;
  const showEpisodeDetails = user?.preferences.showEpisodeDetails ?? true;
  const [episodes, setEpisodes] = useState<RecentEpisode[] | null>(null);

  useEffect(() => {
    let active = true;
    getClientCached("home-recent-episodes", 60_000, async () => {
      const response = await fetch("/api/animes/recent-episodes");
      if (!response.ok) return [];
      const data = await response.json() as { episodes?: RecentEpisode[] };
      return Array.isArray(data.episodes) ? data.episodes : [];
    })
      .then((items) => { if (active) setEpisodes(items); })
      .catch(() => { if (active) setEpisodes([]); });
    return () => { active = false; };
  }, []);

  if (!episodes?.length) return null;
  // Ceinture et bretelles : l'API ne renvoie déjà que le passé, on filtre
  // aussi côté client pour ne jamais afficher une sortie à venir.
  const released = episodes.filter((episode) => episode.updatedAt <= Date.now());
  if (released.length === 0) return null;

  return (
 <SectionRow title="Derniers épisodes ajoutés" subtitle="Épisodes déjà sortis, du plus récent au plus ancien.">
      {released.map((episode) => {
        // Affiche de la série, jamais l'image de l'épisode.
        const image = episode.affiche || episode.banniere;
        return (
          <Link key={`${episode.id}-${episode.season}-${episode.number}-${episode.language}`} href={detailHref(episode.id)} className="group group/recent w-[150px] shrink-0 snap-start sm:w-[170px] lg:w-[190px]">
            <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-panel">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" className={`h-full w-full object-cover object-top transition duration-500 group-hover/recent:scale-[1.03] ${hideEpisodeImages ? "blur-md" : ""}`} />
              ) : (
                <div className="grid h-full place-items-center bg-gradient-to-br from-brand/25 to-panel text-3xl font-black text-white/40">{episode.titre.slice(0, 1)}</div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
              <LanguageFlags languages={[episode.language]} enabled />
            </div>
            <div className="px-1 pt-2">
              <h3 className="truncate text-sm font-bold text-white transition group-hover/recent:text-brand-2">{episode.titre} - {episode.season}</h3>
              <p className="mt-1 truncate text-xs text-muted">{showEpisodeDetails && episode.titreEpisode ? `${episode.number} - ${episode.titreEpisode}` : `Épisode ${episode.number}`}</p>
              <p className="mt-1.5 text-[10px] font-medium text-muted/75">Ajouté le {formatDate(episode.updatedAt)}</p>
            </div>
          </Link>
        );
      })}
    </SectionRow>
  );
}
