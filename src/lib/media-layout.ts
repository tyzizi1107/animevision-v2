/**
 * Correspondance TMDB ↔ sources, sans aucune base de données.
 *
 * Les sites FR découpent les longs animés en **arcs** (« Iles des Hommes-
 * Poissons », « Elbaf »), TMDB en **saisons** d'épisodes. Leurs numéros ne
 * veulent donc pas dire la même chose : la S7 de One Piece chez TMDB est
 * « G-8 / Long Ring Long Land / Ocean's Dream », alors que la saga 7 de
 * Franime et d'Anime-Sama est « Iles des Hommes-Poissons ».
 *
 * Le seul repère commun est le **numéro absolu** de l'épisode dans la série :
 *
 *      saga i commence à  start(i) = 1 + Σ (longueur des sagas précédentes)
 *      épisode relatif = absolu − start(i) + 1
 *
 * On l'obtient sans catalogue :
 *
 *  - les longues séries (≥ 100 épisodes, ≥ 2 saisons) sont numérotées en
 *    absolu chez les sources, et leur ligne de saisons tient lieu de
 *    découpage en sagas quand elle est plus fine que celle de TMDB ;
 *  - sinon (saison 2, 3… d'une série classique), la saison TMDB correspond à
 *    la même zone pour les deux sites et le numéro de saison suffit.
 *
 * Tout est calculé depuis TMDB : aucun document Mongo n'est lu.
 */

import type { AnimeSeason } from "./anime-types";

/** Une zone de la série : ce que la source appelle « saison » ou « saga ». */
export type MediaZone = {
  /** Numéro de saga chez la source (ou numéro de saison). */
  number: number;
  /** Titre de la zone, quand on le connaît. */
  title?: string;
  /** Nombre d'épisodes de la zone. */
  length: number;
  /** Numéro absolu du premier épisode. */
  firstAbsolute: number;
};

export type MediaLayout = {
  /** Zones de la source, dans l'ordre. */
  zones: MediaZone[];
  /**
   * Index de la zone (0-based) à interroger pour une saison et un épisode
   * TMDB donnés ; `null` si la série est hors de portée de ce calcul.
   */
  zoneIndexFor: (seasonNumber: number, episodeNumber: number, position: number) => number | null;
  /** Numéro d'épisode relatif à la zone (1-based). */
  absoluteToZone: (absolute: number) => { zone: number; episode: number } | null;
};

const LONG_SERIES_MIN_EPISODES = 100;

/** Total d'épisodes d'une fiche, saisons TMDB. */
export function totalEpisodes(seasons: AnimeSeason[]): number {
  return seasons.reduce((sum, season) => sum + season.episodes.length, 0);
}

/** Saisons triées, sans les spéciales vides. */
export function orderedSeasons(seasons: AnimeSeason[]): AnimeSeason[] {
  return seasons
    .filter((season) => season.episodes.length > 0)
    .map((season) => ({
      season,
      number: Number(/(\d+)$/.exec(season.slug)?.[1] ?? NaN),
    }))
    .sort((a, b) => {
      const left = Number.isFinite(a.number) ? a.number : 999;
      const right = Number.isFinite(b.number) ? b.number : 999;
      return left - right;
    })
    .map((entry) => entry.season);
}

/**
 * Zones déduites des saisons TMDB, quand la série est longue : chaque saison
 * devient une zone dont la longueur est le nombre d'épisodes TMDB, et le
 * premier numéro absolu suit la précédente.
 */
export function layoutFromSeasons(seasons: AnimeSeason[]): MediaLayout {
  const ordered = orderedSeasons(seasons);
  const zones: MediaZone[] = [];
  let cursor = 1;
  for (const [position, season] of ordered.entries()) {
    const number = Number(/(\d+)$/.exec(season.slug)?.[1] ?? position + 1);
    zones.push({
      number: Number.isFinite(number) ? number : position + 1,
      title: season.name,
      length: season.episodes.length,
      firstAbsolute: cursor,
    });
    cursor += season.episodes.length;
  }

  const byNumber = new Map(zones.map((zone, position) => [zone.number, position] as const));
  return {
    zones,
    zoneIndexFor: (seasonNumber, _episodeNumber, position) => {
      const direct = byNumber.get(seasonNumber);
      if (direct !== undefined) return direct;
      // Saison sans numéro TMDB (ajoutée) : sa position dans la liste.
      return position >= 0 && position < zones.length ? position : null;
    },
    absoluteToZone: (absolute) => {
      for (const [position, zone] of zones.entries()) {
        const end = zone.firstAbsolute + zone.length - 1;
        if (absolute >= zone.firstAbsolute && absolute <= end) {
          return { zone: position, episode: absolute - zone.firstAbsolute + 1 };
        }
      }
      return null;
    },
  };
}

/**
 * Layout d'une fiche pour une source dont on connaît les zones (les lignes
 * de saison du site), avec repli sur les longueurs TMDB.
 *
 * `sourceZones` est la liste brute renvoyée par la source (saga → nombre
 * d'épisodes), dans son ordre. C'est ce qui donne les bons numéros quand la
 * source découpe la série plus finement que TMDB.
 */
export function layoutWithSource(
  seasons: AnimeSeason[],
  sourceZones: Array<{ number: number; title?: string; length: number }>,
): MediaLayout {
  const tmdb = layoutFromSeasons(seasons);
  const total = totalEpisodes(seasons);
  const sourceTotal = sourceZones.reduce((sum, zone) => sum + zone.length, 0);

  // La source doit couvrir la série autant que TMDB, sans la dépasser de
  // beaucoup : un site à jour a quelques épisodes d'avance (films, spéciaux),
  // jamais deux fois moins.
  const usable = sourceZones.length > 0
    && total > 0
    && sourceTotal >= total
    && sourceTotal <= total * 1.5;

  if (!usable) return tmdb;

  const zones: MediaZone[] = [];
  let cursor = 1;
  for (const zone of sourceZones) {
    zones.push({
      number: zone.number,
      title: zone.title,
      length: zone.length,
      firstAbsolute: cursor,
    });
    cursor += zone.length;
  }

  // Saison TMDB → zone source : celle qui contient son numéro absolu de début.
  const zoneForStart = (start: number): number | null => {
    const exact = zones.findIndex((zone) => zone.firstAbsolute === start);
    if (exact >= 0) return exact;
    const containing = zones.findIndex((zone) => start >= zone.firstAbsolute && start < zone.firstAbsolute + zone.length);
    return containing >= 0 ? containing : null;
  };
  const startOfSeason = (seasonNumber: number, position: number): number | undefined => {
    const exact = tmdb.zones.find((zone) => zone.number === seasonNumber)?.firstAbsolute;
    if (exact !== undefined) return exact;
    return tmdb.zones[position]?.firstAbsolute;
  };

  return {
    zones,
    zoneIndexFor: (seasonNumber, _episodeNumber, position) => {
      const start = startOfSeason(seasonNumber, position);
      return start === undefined ? null : zoneForStart(start);
    },
    absoluteToZone: (absolute) => {
      for (const [position, zone] of zones.entries()) {
        const end = zone.firstAbsolute + zone.length - 1;
        if (absolute >= zone.firstAbsolute && absolute <= end) {
          return { zone: position, episode: absolute - zone.firstAbsolute + 1 };
        }
      }
      return null;
    },
  };
}

/** Vrai pour les séries que les sources numérotent en absolu. */
export function isLongSeries(seasons: AnimeSeason[]): boolean {
  return orderedSeasons(seasons).length >= 2 && totalEpisodes(seasons) >= LONG_SERIES_MIN_EPISODES;
}
