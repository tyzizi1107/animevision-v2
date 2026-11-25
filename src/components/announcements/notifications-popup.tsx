"use client";

import { useEffect, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { NotificationsPanelContent } from "@/components/announcements/notifications-panel-content";

/**
 * Volet des notifications : il glisse depuis la droite par-dessus la page,
 * sans changer d'adresse. Le contenu est rendu ici même — aucune page n'est
 * ouverte, aucun en-tête du site n'apparaît dedans.
 */
export function NotificationsPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Monté d'abord hors écran à droite, puis glissé vers la gauche.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const raf = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex justify-end">
      {/* Fond cliquable, en fondu */}
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px] transition-opacity duration-300"
        style={{ opacity: shown ? 1 : 0 }}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        className="relative flex h-full w-full max-w-[420px] flex-col overflow-hidden border-l border-line bg-[#0f0b16] shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.9)] transition-transform duration-[320ms] ease-out"
        style={{ transform: shown ? "translateX(0)" : "translateX(100%)" }}
      >
        <header className="flex items-center justify-end gap-4 px-3 pb-1 pt-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <NotificationsPanelContent />
        </div>
      </section>
    </div>
  );
}
