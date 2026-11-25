"use client";

import Link from "next/link";
import { BellIcon, CloseIcon, SparklesIcon } from "@/components/icons";
import { useAnnouncements } from "@/components/announcements/announcements-provider";
import { useAuth } from "@/components/auth/auth-provider";

/** La liste des notifications elle-même, rendue dans le volet (ou sur /notifications). */
export function NotificationsPanelContent() {
  const { notices, dismiss, ready } = useAnnouncements();
  const { user, loading } = useAuth();

  if (loading || !ready) {
    return (
      <div className="rounded-2xl border border-line bg-panel/50 p-6 text-sm text-muted">
        Chargement des notifications…
      </div>
    );
  }

  if (notices.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-panel/30 px-5 py-14 text-center">
        <BellIcon className="mx-auto h-8 w-8 text-muted" />
        <p className="mt-4 font-bold text-white">Aucune nouveauté pour le moment</p>
        <p className="mt-1 text-sm text-muted">Les notifications activées apparaîtront ici.</p>
        {!user && (
          <Link href="/connexion" className="mt-4 inline-flex text-sm font-semibold text-brand-2 hover:text-white">
            Connecte-toi pour les personnaliser
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notices.map((notice) => (
        <article key={notice.id} className="relative rounded-2xl border border-line bg-panel/60 p-4 pr-14 sm:p-5 sm:pr-16">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/20 text-white">
              <SparklesIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-white">{notice.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">{notice.body}</p>
              {notice.href && (
                <Link href={notice.href} className="mt-3 inline-flex text-xs font-bold text-brand-2 hover:text-white">
                  {notice.linkLabel ?? (notice.kind === "monthly" ? "Découvrir la sélection" : notice.kind === "episode" ? "Voir l’animé" : "En savoir plus")} →
                </Link>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => dismiss(notice.id)}
            aria-label="Masquer cette notification"
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-white/10 hover:text-white sm:right-4 sm:top-4"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </article>
      ))}
    </div>
  );
}
