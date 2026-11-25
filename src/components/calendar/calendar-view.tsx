"use client";

import { detailHref } from "@/lib/anime-types";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CalendarIcon,
  ClockIcon,
  GridIcon,
  InfoIcon,
  SearchIcon,
} from "@/components/icons";
import type { CalendarDay, CalendarEntry, WeekDay } from "@/lib/calendar";
import { useAuth } from "@/components/auth/auth-provider";
import { cn } from "@/lib/utils";
import { LanguageFlags } from "@/components/language-flags";

type Version = "VO" | "VF";
type ViewMode = "grid" | "timeline";

type Props = {
  days: CalendarDay[];
  todayIndex: number;
  week: WeekDay[];
};

type ScheduledEntry = { entry: CalendarEntry; version: Version };

export function CalendarView({ days, todayIndex, week }: Props) {
  const { user } = useAuth();
  const preferredCalendarView = user?.preferences.calendarView;
  const [selected, setSelected] = useState(todayIndex);
  const [view, setView] = useState<ViewMode>("timeline");
  const [query, setQuery] = useState("");
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);
  useEffect(() => {
    if (preferredCalendarView) setView(preferredCalendarView);
  }, [preferredCalendarView]);
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    };
    updateTime();
    const timer = window.setInterval(updateTime, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const normalizedQuery = query.trim().toLocaleLowerCase("fr-FR");

  const entriesFor = (index: number): ScheduledEntry[] => {
    const day = days[index];
    if (!day) return [];
    return [
      ...day.vo.map((entry) => ({ entry, version: "VO" as const })),
      ...day.vf.map((entry) => ({ entry, version: "VF" as const })),
    ]
      .filter(({ entry }) => !normalizedQuery || entry.titre.toLocaleLowerCase("fr-FR").includes(normalizedQuery))
      .sort((a, b) => a.entry.startMinutes - b.entry.startMinutes || a.entry.titre.localeCompare(b.entry.titre, "fr"));
  };

  const weekEntries = week.map((info) => ({ info, entries: entriesFor(info.index) }));
  const dayInfo = week[selected] ?? week[0];
  const currentEntries = weekEntries[selected]?.entries ?? [];
  const weeklyTotal = weekEntries.reduce((sum, day) => sum + day.entries.length, 0);
  const currentVoCount = currentEntries.filter((item) => item.version === "VO").length;
  const currentVfCount = currentEntries.length - currentVoCount;
  const timelineProgress = (() => {
    if (!currentEntries.length || selected > todayIndex || nowMinutes === null) return 0;
    if (selected < todayIndex) return 100;
    const scheduled = currentEntries
      .map(({ entry }, index) => ({ index, minutes: entry.time ? entry.startMinutes : null }))
      .filter((item): item is { index: number; minutes: number } => item.minutes !== null);
    if (!scheduled.length) return 0;
    const next = scheduled.findIndex((item) => item.minutes > nowMinutes);
    let position: number;
    if (next === -1) {
      position = currentEntries.length - 1;
    } else if (next === 0) {
      const upcoming = scheduled[0];
      const fraction = upcoming.minutes > 0 ? Math.min(1, nowMinutes / upcoming.minutes) : 0;
      position = upcoming.index * fraction;
    } else {
      const previous = scheduled[next - 1];
      const upcoming = scheduled[next];
      const duration = upcoming.minutes - previous.minutes;
      const fraction = duration > 0 ? Math.min(1, Math.max(0, (nowMinutes - previous.minutes) / duration)) : 0;
      position = previous.index + (upcoming.index - previous.index) * fraction;
    }
    if (currentEntries.length === 1) {
      return nowMinutes >= scheduled[0].minutes
        ? 100
        : Math.round(Math.min(1, nowMinutes / Math.max(1, scheduled[0].minutes)) * 100);
    }
    return Math.round((position / (currentEntries.length - 1)) * 100);
  })();

  return (
    <div>
      <header className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-brand-2">
            <CalendarIcon className="h-3.5 w-3.5" />
            AnimeVision · Planning
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">
            Planning des sorties
          </h1>
          <p className="mt-2 text-sm text-muted sm:text-base">
            {weeklyTotal} sortie{weeklyTotal === 1 ? "" : "s"} planifiée{weeklyTotal === 1 ? "" : "s"} cette semaine
            {normalizedQuery ? " correspondant à ta recherche" : ""}.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative block min-w-0 sm:w-[260px]">
            <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher un animé…"
              aria-label="Rechercher un animé dans le calendrier"
              className="h-11 w-full rounded-full border border-white/[0.1] bg-[#0c0a11] pl-11 pr-4 text-sm text-white placeholder:text-muted/75 outline-none transition focus:border-brand/70 focus:ring-4 focus:ring-brand/15"
            />
          </label>

          <div className="flex items-center rounded-full border border-white/[0.1] bg-[#121018] p-1">
            <ViewButton active={view === "grid"} onClick={() => setView("grid")}>
              <CalendarIcon className="h-3.5 w-3.5" />
              Grille calendrier
            </ViewButton>
            <ViewButton active={view === "timeline"} onClick={() => setView("timeline")}>
              <GridIcon className="h-3.5 w-3.5" />
              Fil chronologique
            </ViewButton>
          </div>
        </div>
      </header>

      <div className="mt-7 rounded-[24px] border border-white/[0.08] bg-[#111018] p-2 sm:p-3">
        <div className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto rounded-[18px] bg-[#0b0a10] p-1">
          {week.map((info) => {
            const active = info.index === selected;
            const count = weekEntries[info.index]?.entries.length ?? 0;
            return (
              <button
                key={info.day}
                type="button"
                onClick={() => setSelected(info.index)}
                aria-pressed={active}
                className={cn(
                  "relative flex min-w-[110px] flex-1 flex-col items-center justify-center rounded-[15px] px-2 py-3 text-center transition sm:min-w-0 sm:py-3.5",
                  active
                    ? "border border-brand/70 bg-brand/20 text-white shadow-[0_8px_24px_-16px_rgba(65,0,154,0.95)]"
                    : "border border-transparent text-white/80 hover:bg-white/[0.04]",
                )}
              >
                {info.isToday && (
                  <span className="absolute -top-2 rounded-full bg-brand px-2 py-0.5 text-[8px] font-black uppercase tracking-wide text-white">
                    Aujourd&apos;hui
                  </span>
                )}
                <span className="text-xs font-bold sm:text-sm">{info.day}</span>
                <span className="mt-1 text-[10px] text-muted">
                  {count} sortie{count === 1 ? "" : "s"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
            {dayInfo.day} {dayInfo.date} {dayInfo.month}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {currentEntries.length} diffusion{currentEntries.length === 1 ? "" : "s"} · {currentVoCount} VOSTFR · {currentVfCount} VF
          </p>
        </div>
        {dayInfo.isToday && (
          <span className="rounded-full border border-brand/40 bg-brand/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-2">
            Programme du jour
          </span>
        )}
      </div>

      {view === "timeline" ? (
        currentEntries.length ? (
          <div className="relative mt-6 space-y-4 sm:space-y-5">
            <div
              aria-hidden="true"
              className="absolute bottom-8 left-[76.5px] top-8 w-[3px] rounded-full sm:left-[96.5px]"
              style={{
                background: `linear-gradient(to bottom, #41009a 0%, #41009a ${timelineProgress}%, #77717f ${timelineProgress}%, #77717f 100%)`,
              }}
            />
            {currentEntries.map(({ entry, version }, index) => {
              const isPast = selected < todayIndex
                || (selected === todayIndex && Boolean(entry.time) && nowMinutes !== null && entry.startMinutes <= nowMinutes);
              const muted = !isPast || !entry.time;
              return (
                <div key={`${version}-${entry.id}-${index}`} className="relative grid grid-cols-[62px_16px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[76px_20px_minmax(0,1fr)] sm:gap-3">
                <time className={cn(
                  "text-right font-mono text-[11px] font-bold tabular-nums sm:text-sm",
                  muted ? "text-white/35" : "text-brand-2",
                )}>
                  {entry.time ?? "—"}
                </time>
                <span className={cn(
                  "relative z-10 mx-auto h-3 w-3 rounded-full border-[3px] border-[#09080d] transition-colors",
                  muted ? "bg-[#77717f] shadow-[0_0_0_3px_rgba(119,113,127,0.15)]" : "bg-brand-2 shadow-[0_0_0_3px_rgba(65,0,154,0.28)]",
                )} />
                <EntryCard entry={entry} version={version} released={isPast && Boolean(entry.time)} />
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyDay searching={Boolean(normalizedQuery)} />
        )
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {weekEntries.map(({ info, entries }) => (
            <section key={info.day} className={cn(
              "rounded-2xl border p-4",
              info.index === selected ? "border-brand/45 bg-brand/[0.08]" : "border-line bg-panel/40",
            )}>
              <button type="button" onClick={() => { setSelected(info.index); setView("timeline"); }} className="flex w-full items-center justify-between text-left">
                <span className="text-sm font-bold text-white">{info.day}</span>
                <span className="text-[10px] text-muted">{info.date} {info.month} · {entries.length}</span>
              </button>
              <ul className="mt-4 space-y-2.5">
                {entries.slice(0, 6).map(({ entry, version }, index) => (
                  <li key={`${version}-${entry.id}-${index}`} className="flex items-start gap-2 text-[11px] leading-snug">
                    <span className="w-10 shrink-0 font-mono tabular-nums text-brand-2">{entry.time ?? "—"}</span>
                    <span className="min-w-0 flex-1 text-white/75">{entry.titre}</span>
                    <span className="rounded bg-brand/20 px-1 text-[8px] font-bold text-brand-2">{version === "VO" ? "VOSTFR" : "VF"}</span>
                  </li>
                ))}
                {entries.length === 0 && <li className="text-[11px] text-muted/70">Aucune sortie</li>}
                {entries.length > 6 && <li className="text-[10px] font-medium text-brand-2">+ {entries.length - 6} autres sorties</li>}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[10px] font-bold transition sm:px-4 sm:text-[11px]",
        active ? "bg-brand text-white shadow-[0_4px_18px_-8px_rgba(65,0,154,0.9)]" : "text-white/60 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function EntryCard({ entry, version, released }: { entry: CalendarEntry; version: Version; released: boolean }) {
  const { user } = useAuth();
  const hideEpisodeImages = user?.preferences.hideEpisodeImages ?? false;
  const showEpisodeDetails = user?.preferences.showEpisodeDetails ?? true;
  // Affiche de la série (jamais une image d'épisode).
  const image = entry.affiche;
  const episodeTitle = showEpisodeDetails
    ? entry.episodeTitle || (entry.episode ? `Épisode ${entry.episode}` : "Épisode à venir")
    : entry.episode ? `Épisode ${entry.episode}` : "Épisode à venir";

  return (
    <article className="group flex min-w-0 items-center gap-3 rounded-[20px] border border-white/[0.08] bg-[#15141c] p-3 transition hover:border-brand/50 hover:bg-[#191722] sm:gap-4 sm:px-4 sm:py-3.5">
      <div className="relative aspect-[2/3] w-[64px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-brand/35 to-[#20182a] sm:w-[84px]">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" className={cn("h-full w-full object-cover", hideEpisodeImages && "blur-md")} />
        ) : (
          <div className="grid h-full place-items-center text-xl font-black text-white/30">{entry.titre.slice(0, 1)}</div>
        )}
        {released && (
          <span className="absolute inset-x-0 bottom-0 bg-brand/95 px-1 py-0.5 text-center text-[7px] font-black uppercase leading-tight text-white shadow-[0_-4px_12px_rgba(0,0,0,0.45)] sm:text-[8px]">
            Déjà sorti
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 py-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="line-clamp-1 text-[13px] font-bold text-white sm:text-[15px]">{entry.titre}{entry.season ? ` - ${entry.season}` : ""}</h3>
          <span className="rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white/80">
            {version === "VO" ? "VOSTFR" : "VF"}
          </span>
        </div>
        <p className="mt-1 text-[10px] font-medium text-white/60">{episodeTitle}{entry.time ? ` · ${entry.time}` : ""}</p>
        {showEpisodeDetails && entry.synopsis && <p className="mt-1 line-clamp-1 text-[10px] text-muted">{entry.synopsis}</p>}
      </div>
      <Link
        href={detailHref(entry.id)}
        aria-label={`Voir la fiche de ${entry.titre}`}
        title="Voir la fiche de l’anime"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.035] text-white/70 transition hover:border-brand/50 hover:bg-brand/15 hover:text-white"
      >
        <InfoIcon className="h-4 w-4" />
      </Link>
    </article>
  );
}

function EmptyDay({ searching }: { searching: boolean }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-line bg-panel/30 px-5 py-12 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-brand/15 text-brand-2">
        <ClockIcon className="h-5 w-5" />
      </span>
      <p className="mt-4 text-sm font-semibold text-white">
        {searching ? "Aucun animé trouvé" : "Aucune sortie prévue ce jour-là"}
      </p>
      <p className="mt-1 text-xs text-muted">
        {searching ? "Essaie avec un autre titre." : "Sélectionne un autre jour pour consulter le planning."}
      </p>
    </div>
  );
}

