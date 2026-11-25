"use client";

import { useRef, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  /** Classe du conteneur défilant (largeurs de vignettes, gouttières). */
  className?: string;
  /** Ce que la rangée contient, pour l'étiquette des boutons. */
  label?: string;
  /** Gouttière nulle sur téléphone : la rangée colle au bord comme avant. */
  mobileGutter?: boolean;
};

/**
 * Rangée défilante horizontale avec flèches gauche/droite.
 *
 * Les deux flèches vivent dans une **gouttière de 52 px** réservée à côté de la
 * rangée (`lg:pl-[52px] lg:pr-[52px]`) : elles ne se superposent jamais aux
 * affiches ni aux vignettes, même en fin de course. Le conteneur défilant n'a
 * aucun décalage interne, donc `snap-start` cale chaque carte sur le bord de la
 * zone visible, pas sous une flèche.
 */
export function ScrollRow({ children, className, label = "la liste", mobileGutter = false }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollBy = (direction: 1 | -1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * Math.max(280, scroller.clientWidth * 0.85), behavior: "smooth" });
  };

  return (
    // Gouttière en CSS inline : elle ne dépend d'aucune classe générée, donc
    // les flèches restent hors du contenu même si le CSS servi est en retard.
    // Sur téléphone (`mobileGutter`), la rangée touche le bord : les flèches
    // sont masquées là, le glissement au doigt suffit.
    <div className="group/row relative">
      <div
        ref={scrollerRef}
        style={{
          marginInline: `var(--gutter, ${mobileGutter ? "0px" : "48px"})`,
          scrollPaddingInline: `var(--gutter, ${mobileGutter ? "0px" : "48px"})`,
        }}
        className={cn(
          "no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 sm:gap-5",
          className,
        )}
      >
        {children}
      </div>

      <button
        type="button"
        aria-label={`Faire défiler ${label} vers la gauche`}
        onClick={() => scrollBy(-1)}
        style={{ left: "4px" }}
        className="absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/70 text-white opacity-0 backdrop-blur-md transition hover:bg-black/90 focus-visible:opacity-100 group-hover/row:opacity-100 lg:grid"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label={`Faire défiler ${label} vers la droite`}
        onClick={() => scrollBy(1)}
        style={{ right: "4px" }}
        className="absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/70 text-white opacity-0 backdrop-blur-md transition hover:bg-black/90 focus-visible:opacity-100 group-hover/row:opacity-100 lg:grid"
      >
        <ChevronRightIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
