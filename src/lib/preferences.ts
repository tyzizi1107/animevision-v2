export type HomeSectionId = "trending" | "recentAnime" | "continueWatching" | "promo" | "calendar" | "recentEpisodes";
export type HomeSectionPreference = { id: HomeSectionId; enabled: boolean };
export const HOME_SECTION_OPTIONS: Array<{ id: HomeSectionId; label: string; description: string; defaultEnabled: boolean }> = [
  { id: "trending", label: "Tendances du moment", description: "Le meilleur du moment, à découvrir maintenant.", defaultEnabled: true },
  { id: "recentAnime", label: "Derniers ajouts", description: "Les nouvelles fiches ajoutées sur AnimeVision.", defaultEnabled: true },
  { id: "continueWatching", label: "Reprendre la lecture", description: "Retrouver les épisodes commencés.", defaultEnabled: true },
  { id: "promo", label: "Bannière du catalogue", description: "La grande bannière « Découvrez un nouveau monde ».", defaultEnabled: true },
  { id: "calendar", label: "Calendrier du jour", description: "Les épisodes prévus pour aujourd’hui.", defaultEnabled: false },
  { id: "recentEpisodes", label: "Derniers épisodes", description: "Les derniers épisodes ajoutés au catalogue.", defaultEnabled: false },
];

export type Preferences = {
  appearance: "dark" | "light";
  textSize: "normal" | "large";
  highContrast: boolean;
  defaultCatalogSort: "note" | "recent" | "az";
  calendarView: "timeline" | "grid";
  /** « auto » essaie la VOSTFR en premier et prend la VF si la VO manque. */
  preferredLanguage: "auto" | "vostfr" | "vf";
  /**
   * Sous-titres automatiques : `true` = toujours actifs, `false` = jamais,
   * `null` = suivre la langue lue (VOSTFR sous-titré, VF sans sous-titres).
   */
  subtitlesAuto: boolean | null;
  /** Langue des sous-titres (`fre`, `eng`…), `auto` = celle du flux. */
  subtitleLanguage: string;
  showEpisodeDetails: boolean;
  hideEpisodeImages: boolean;
  homeSections: HomeSectionPreference[];
  /** Personnalisation du lecteur. */
  playerAutoplay: boolean;
  playerAutoNext: boolean;
  playerStartMuted: boolean;
  playerAutoHide: boolean;
  playerAutoSkipIntro: boolean;
  /** Reprise automatique de l'épisode là où il a été arrêté. */
  playerResume: boolean;
  /** Taille du texte des contrôles : compact, normal, grand. */
  playerControlsSize: "compact" | "normal" | "grand";
  /** Vitesse de lecture par défaut (1 = normale). */
  playerSpeed: number;
  reduceMotion: boolean;
  notifications: {
    announcements: boolean;
    newEpisodes: boolean;
    newsletter: boolean;
  };
};

export const DEFAULT_PREFERENCES: Preferences = {
  appearance: "dark",
  textSize: "normal",
  highContrast: false,
  defaultCatalogSort: "note",
  calendarView: "timeline",
  preferredLanguage: "auto",
  subtitlesAuto: null,
  subtitleLanguage: "auto",
  showEpisodeDetails: true,
  hideEpisodeImages: false,
  homeSections: HOME_SECTION_OPTIONS.map(({ id, defaultEnabled }) => ({ id, enabled: defaultEnabled })),
  playerAutoplay: true,
  playerAutoNext: true,
  playerStartMuted: true,
  playerAutoHide: true,
  playerAutoSkipIntro: false,
  playerResume: true,
  playerControlsSize: "normal",
  playerSpeed: 1,
  reduceMotion: false,
  notifications: {
    announcements: true,
    newEpisodes: true,
    newsletter: false,
  },
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizePreferences(input: unknown): Preferences {
  const raw = (input ?? {}) as Partial<Preferences> & Record<string, unknown>;
  const notifications = (raw.notifications ?? {}) as Partial<Preferences["notifications"]>;
  const storedSections = Array.isArray(raw.homeSections) ? raw.homeSections : [];
  // Ancien format (sans « trending ») : on repart sur la nouvelle disposition.
  const isLegacy = storedSections.length > 0 && !storedSections.some((s) => (s as { id?: unknown })?.id === "trending");
  const rawSections = isLegacy ? [] : storedSections;
  const sectionMap = new Map<HomeSectionId, boolean>();
  for (const item of rawSections) {
    if (!item || typeof item !== "object") continue;
    const section = item as Record<string, unknown>;
    if (HOME_SECTION_OPTIONS.some((option) => option.id === section.id) && !sectionMap.has(section.id as HomeSectionId)) {
      sectionMap.set(section.id as HomeSectionId, asBoolean(section.enabled, true));
    }
  }
  const homeSections = [
    ...rawSections.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const section = item as Record<string, unknown>;
      const option = HOME_SECTION_OPTIONS.find((entry) => entry.id === section.id);
      return option ? [{ id: option.id, enabled: sectionMap.get(option.id) ?? true }] : [];
    }).filter((section, index, all) => all.findIndex((item) => item.id === section.id) === index),
    ...HOME_SECTION_OPTIONS.filter(({ id }) => !sectionMap.has(id)).map(({ id, defaultEnabled }) => ({ id, enabled: defaultEnabled })),
  ];

  return {
    appearance: raw.appearance === "light" ? "light" : "dark",
    textSize: raw.textSize === "large" ? "large" : "normal",
    highContrast: asBoolean(raw.highContrast, DEFAULT_PREFERENCES.highContrast),
    defaultCatalogSort: raw.defaultCatalogSort === "recent" || raw.defaultCatalogSort === "az" ? raw.defaultCatalogSort : "note",
    calendarView: raw.calendarView === "grid" ? "grid" : "timeline",
    preferredLanguage: raw.preferredLanguage === "vf" || raw.preferredLanguage === "vostfr" ? raw.preferredLanguage : "auto",
    subtitlesAuto: typeof raw.subtitlesAuto === "boolean" ? raw.subtitlesAuto : null,
    subtitleLanguage: typeof raw.subtitleLanguage === "string" && /^[a-z]{2,3}$/i.test(raw.subtitleLanguage) ? raw.subtitleLanguage.toLowerCase() : "auto",
    showEpisodeDetails: asBoolean(raw.showEpisodeDetails, DEFAULT_PREFERENCES.showEpisodeDetails),
    hideEpisodeImages: asBoolean(raw.hideEpisodeImages, DEFAULT_PREFERENCES.hideEpisodeImages),
    homeSections,
    playerAutoplay: asBoolean(raw.playerAutoplay, DEFAULT_PREFERENCES.playerAutoplay),
    playerAutoNext: asBoolean(raw.playerAutoNext, DEFAULT_PREFERENCES.playerAutoNext),
    playerStartMuted: asBoolean(raw.playerStartMuted, DEFAULT_PREFERENCES.playerStartMuted),
    playerAutoHide: asBoolean(raw.playerAutoHide, DEFAULT_PREFERENCES.playerAutoHide),
    playerAutoSkipIntro: asBoolean(raw.playerAutoSkipIntro, DEFAULT_PREFERENCES.playerAutoSkipIntro),
    playerResume: asBoolean(raw.playerResume, DEFAULT_PREFERENCES.playerResume),
    playerControlsSize: raw.playerControlsSize === "compact" || raw.playerControlsSize === "grand" ? raw.playerControlsSize : "normal",
    playerSpeed: [0.75, 1, 1.25, 1.5, 1.75, 2].includes(Number(raw.playerSpeed)) ? Number(raw.playerSpeed) : 1,
    reduceMotion: asBoolean(raw.reduceMotion, DEFAULT_PREFERENCES.reduceMotion),
    notifications: {
      announcements: asBoolean(notifications.announcements, DEFAULT_PREFERENCES.notifications.announcements),
      newEpisodes: asBoolean(notifications.newEpisodes, DEFAULT_PREFERENCES.notifications.newEpisodes),
      newsletter: asBoolean(notifications.newsletter, DEFAULT_PREFERENCES.notifications.newsletter),
    },
  };
}
