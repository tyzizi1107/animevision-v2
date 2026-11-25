"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Fond du hero de la fiche : le visuel de la série (bannière), remplacé par
 * l'image de l'épisode survolé quand la liste d'épisodes en signale une.
 * Deux couches qui se croisent en fondu, pour éviter le clignotement.
 */
export function HeroBackdrop({ image, fallback = null }: { image: string | null; fallback?: string | null }) {
  const [layers, setLayers] = useState<{ front: string | null; back: string | null }>({
    front: image,
    back: null,
  });
  const [shown, setShown] = useState<string | null>(image);

  // Rendu pendant le rendu (pas d'effet) : la couche arrière reçoit la nouvelle
  // image, la couche avant s'efface, puis on échange.
  if (shown !== image) {
    setShown(image);
    setLayers((current) => ({ front: image, back: current.front ?? fallback }));
  }

  const layersList = [layers.back, layers.front];

  return (
    <div className="absolute inset-0" aria-hidden="true">
      {layersList.map((source, index) => (
        <div
          key={source ?? `empty-${index}`}
          className={cn(
            "absolute inset-0 transition-opacity duration-500",
            index === 1 ? "opacity-100" : "opacity-0",
          )}
        >
          {source ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={source}
              alt=""
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover object-[60%_20%]"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-brand/25 via-bg to-brand-2/10" />
          )}
        </div>
      ))}
    </div>
  );
}
