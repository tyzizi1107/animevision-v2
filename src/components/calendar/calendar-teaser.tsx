"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SectionRow } from "@/components/section-row";
import { ClockIcon } from "@/components/icons";
import { useAuth } from "@/components/auth/auth-provider";
import { LanguageFlags } from "@/components/language-flags";
import type { CalendarDay } from "@/lib/calendar";
import { calendrierDepuisApi } from "@/lib/api-localization";
import { getClientCached } from "@/lib/client-cache";

export function CalendarTeaser() {
  const { user } = useAuth();
  const hideEpisodeImages = user?.preferences.hideEpisodeImages ?? false;
  const [days, setDays] = useState<CalendarDay[] | null>(null);

  useEffect(() => {
    let active = true;
    getClientCached("home-calendar", 60_000, async () => {
      const response = await fetch("/api/calendrier");
      if (!response.ok) return null;
      return calendrierDepuisApi(await response.json());
    })
      .then((calendrier) => {
        if (active && calendrier?.days) setDays(calendrier.days);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!days || days.length < 7) return null;

  const todayIndex = (new Date().getDay() + 6) % 7;
  const today = days[todayIndex];
  if (!today) return null;

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const all = [
    ...today.vo.map((entry) => ({ entry, version: "VO" as const })),
    ...today.vf.map((entry) => ({ entry, version: "VF" as const })),
  ].sort((a, b) => b.entry.startMinutes - a.entry.startMinutes);
  // Les sorties déjà passées d'abord (les plus récentes en tête) : à 22 h, on
  // ne montre pas une diffusion annoncée à 02:44 comme si elle arrivait.
  const upcoming = all.filter(({ entry }) => !entry.time || entry.startMinutes > nowMinutes);
  const past = all.filter(({ entry }) => Boolean(entry.time) && entry.startMinutes <= nowMinutes);
  const entries = [...past, ...upcoming].slice(0, 8);

  return (
    <SectionRow
      title={`Programme du ${today.day.toLocaleLowerCase("fr-FR")}`}
      subtitle={
        upcoming.length > 0
          ? `${past.length} déjà sortie${past.length > 1 ? "s" : ""} · ${upcoming.length} à venir aujourd'hui.`
          : `${past.length} sortie${past.length > 1 ? "s" : ""} aujourd'hui, toutes déjà en ligne.`
      }
      href="/calendrier"
    >
      {entries.length === 0 ? (
        <Link
          href="/calendrier"
          className="flex min-h-[92px] w-full shrink-0 items-center rounded-xl border border-dashed border-line bg-panel/30 px-5 text-sm text-muted transition hover:border-brand/40 hover:text-white sm:w-[420px]"
        >
          Aucune sortie prévue pour aujourd&apos;hui. Consulte le planning complet.
        </Link>
      ) : entries.map(({ entry, version }) => (
        <Link
          key={`${version}-${entry.id}`}
          href="/calendrier"
          className="group group/calendar w-[150px] shrink-0 snap-start sm:w-[170px] lg:w-[190px]"
        >
          <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-panel">
              {entry.affiche ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.affiche}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className={`h-full w-full object-cover object-top transition duration-500 group-hover/calendar:scale-[1.03] ${hideEpisodeImages ? "blur-md" : ""}`}
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
              <LanguageFlags languages={[version === "VO" ? "vostfr" : "vf"]} enabled />
              <p className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 font-mono text-[10px] tabular-nums text-white backdrop-blur-sm">
                <ClockIcon className="h-2.5 w-2.5" />
                {entry.time ?? "—"}
              </p>
          </div>
          <div className="px-1 pt-2">
            <h3 className="truncate text-sm font-bold text-white transition group-hover/calendar:text-brand-2">
              {entry.titre} - {entry.season || "Anime"}
            </h3>
            <p className="mt-1 truncate text-xs text-muted">
              {entry.episodeTitle || (entry.episode ? `Épisode ${entry.episode}` : "Épisode à venir")}
            </p>
          </div>
        </Link>
      ))}
    </SectionRow>
  );
}
