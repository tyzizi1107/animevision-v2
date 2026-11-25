"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CloseIcon } from "@/components/icons";
import { LEVEL_META } from "@/components/announcements/level";
import { useAnnouncements } from "@/components/announcements/announcements-provider";
import { cn } from "@/lib/utils";

export function AnnouncementToast() {
  const { notices, testNotice, dismiss, ready } = useAnnouncements();
  const pathname = usePathname();

  if (!ready) return null;
  if (pathname.startsWith("/regarder") || pathname.startsWith("/connexion") || pathname.startsWith("/inscription")) {
    return null;
  }

  const visible = testNotice ?? notices[0] ?? null;
  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-24 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:w-[380px]"
      aria-live="polite"
    >
      {(() => {
        const meta = LEVEL_META[visible.level ?? "info"];
        return (
          <div
            key={visible.id}
            className={cn(
              "pointer-events-auto relative w-full animate-fade-up overflow-hidden rounded-2xl border bg-panel/95 p-4 pr-11 shadow-[0_30px_70px_-25px_rgba(0,0,0,1)] backdrop-blur-xl",
              meta.border,
            )}
          >
            <div className="flex items-start gap-2.5">
              <span className={cn("mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-white">{visible.title}</p>
                <p className="mt-1 line-clamp-4 whitespace-pre-line text-xs leading-relaxed text-muted">
                  {visible.body}
                </p>
                {visible.kind === "announcement" && visible.body.length > 220 && (
                  <Link
                    href="/annonces"
                    className="mt-1.5 inline-block text-[11px] font-medium text-white/70 underline underline-offset-2 hover:text-white"
                  >
                    Lire l'annonce complète
                  </Link>
                )}
                {visible.href && (
                  <Link
                    href={visible.href}
                    className="mt-2 inline-block text-[11px] font-semibold text-white underline underline-offset-2 hover:text-brand-2"
                  >
                    {visible.linkLabel ?? (visible.kind === "monthly" ? "Découvrir la sélection" : visible.kind === "episode" ? "Voir l’animé" : "En savoir plus")}
                  </Link>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismiss(visible.id)}
              aria-label="Masquer cette notification"
              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-muted transition hover:bg-white/10 hover:text-white"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })()}
    </div>
  );
}
