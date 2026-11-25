"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { PRIVACY_SECTIONS, TERMS_SECTIONS } from "@/lib/legal";

export type LegalDocument = "terms" | "privacy";

const DOCUMENTS: Record<LegalDocument, {
  label: string;
  title: string;
  sections: ReadonlyArray<{ title: string; body: string }>;
}> = {
  terms: {
    label: "Conditions d’utilisation",
    title: "Conditions d’utilisation",
    sections: TERMS_SECTIONS,
  },
  privacy: {
    label: "Politique de confidentialité",
    title: "Politique de confidentialité",
    sections: PRIVACY_SECTIONS,
  },
};

/**
 * Le contexte vit au niveau du module : un composant peut être monté à deux
 * endroits (pied de page, formulaire) sans jamais perdre le bouton qui ouvre
 * la fenêtre. `useSyncExternalStore` sert d'abonnement global — pas de
 * Provider, donc pas de cas où le bouton se retrouve hors du contexte.
 */
let current: LegalDocument | null = null;
const subscribers = new Set<() => void>();

function emit() {
  for (const listener of subscribers) listener();
}

function subscribe(listener: () => void) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

const getSnapshot = () => current;
const getServerSnapshot = (): LegalDocument | null => null;

export function openLegal(document: LegalDocument) {
  current = document;
  emit();
}

/** Bouton/lien qui ouvre une fenêtre au lieu de changer de page. */
export function LegalLink({
  document,
  className,
  children,
}: {
  document: LegalDocument;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => openLegal(document)}
      className={className}
      aria-haspopup="dialog"
    >
      {children}
    </button>
  );
}

/** Fenêtre légale : contenu défilant, fermeture par la croix, Échap ou le fond. */
export function LegalDialog() {
  const currentDocument = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const close = useCallback(() => {
    current = null;
    emit();
  }, []);

  useEffect(() => {
    if (!currentDocument) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [currentDocument, close]);

  const legalDocument = currentDocument ? DOCUMENTS[currentDocument] : null;
  if (!legalDocument) return null;

  return (
    <div className="fixed inset-0 z-[140] grid place-items-center px-4 py-6">
      <button
        type="button"
        aria-label="Fermer"
        onClick={close}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={legalDocument.label}
        className="relative flex max-h-[85vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-line bg-[#0f0b16] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.95)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-7">
          <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">{legalDocument.title}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Fermer"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="no-scrollbar overflow-y-auto px-5 py-5 sm:px-7">
          <div className="space-y-6">
            {legalDocument.sections.map((section) => (
              <section key={section.title}>
                <h3 className="text-base font-bold text-white">{section.title}</h3>
                <p className="mt-2 text-[13.5px] leading-6 text-muted">{section.body}</p>
              </section>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
