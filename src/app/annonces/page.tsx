import type { Metadata } from "next";
import Link from "next/link";
import { LEVEL_META } from "@/components/announcements/level";
import { BellIcon, ChevronRightIcon } from "@/components/icons";
import { getActiveAnnouncements } from "@/lib/announcements";
import { cn, formatDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Annonces",
  description: "Toutes les annonces et informations importantes d'AnimeVision.",
};

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  const announcements = await getActiveAnnouncements();

  return (
    <div className="mx-auto max-w-[900px] px-4 pb-16 pt-28 sm:px-6 lg:px-8">
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-line bg-white/[0.04] text-brand-2">
          <BellIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-2">
            Centre d'annonces
          </p>
          <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">
            Quoi de neuf sur AnimeVision
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Nouveautés, maintenances et informations importantes publiées par l'équipe.
          </p>
        </div>
      </div>

      {announcements.length === 0 ? (
        <div className="mt-10 rounded-3xl border border-dashed border-line bg-panel/40 px-6 py-16 text-center">
          <p className="text-sm font-semibold text-white">Aucune annonce pour le moment</p>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted">
            Tout va bien : les annonces apparaîtront ici dès qu'elles seront publiées.
          </p>
        </div>
      ) : (
        <ul className="mt-10 space-y-3">
          {announcements.map((announcement) => {
            const meta = LEVEL_META[announcement.level] ?? LEVEL_META.info;
            return (
              <li
                key={announcement.id}
                className={cn(
                  "overflow-hidden rounded-2xl border bg-panel/50 p-5 sm:p-6",
                  meta.border,
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      meta.badge,
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-muted">
                    {formatDate(announcement.createdAt, { dateStyle: "long" })}
                  </span>
                  {announcement.pinned && (
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/60">
                      Épinglée
                    </span>
                  )}
                </div>

                <h2 className="mt-3 text-lg font-bold text-white">{announcement.titre}</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">
                  {announcement.body}
                </p>

                {announcement.linkHref && (
                  <Link
                    href={announcement.linkHref}
                    className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-white underline underline-offset-2 hover:text-brand-2"
                  >
                    {announcement.linkLabel ?? "En savoir plus"}
                    <ChevronRightIcon className="h-3 w-3" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
