"use client";

import { createContext, useContext } from "react";

/**
 * Canal entre le hero de la fiche et sa liste d'épisodes : un épisode survolé
 * (ou sélectionné) demande l'affichage de son image en fond du hero.
 */
export const HeroPreviewContext = createContext<(image: string | null) => void>(() => {});

export function useHeroPreview() {
  return useContext(HeroPreviewContext);
}
