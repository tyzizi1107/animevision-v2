"use client";

import { useState } from "react";
import { AnimeManager } from "@/components/admin/anime-manager";
import { useAuth } from "@/components/auth/auth-provider";
import { CloseIcon, EditIcon } from "@/components/icons";

export function InlineAnimeEditor({ animeId }: { animeId: string }) {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);

  if (loading || user?.role !== "admin") return null;

  return (
    <section className="rounded-2xl border border-brand/25 bg-brand/[0.06] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-2">Administration</p>
          <h2 className="mt-1 text-sm font-bold text-white">Gérer cette fiche anime</h2>
          <p className="mt-1 text-xs text-muted">Modifie les informations, les saisons, les épisodes et leurs lecteurs sans quitter la fiche.</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-xs font-bold text-white transition hover:brightness-110"
        >
          {open ? <><CloseIcon className="h-4 w-4" /> Fermer</> : <><EditIcon className="h-4 w-4" /> Modifier l’anime</>}
        </button>
      </div>
      {open && <div className="mt-5 border-t border-white/10 pt-5"><AnimeManager initialAnimeId={animeId} /></div>}
    </section>
  );
}
