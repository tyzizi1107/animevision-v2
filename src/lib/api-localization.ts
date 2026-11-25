import type { SafeUser } from "./db-types";
import { normalizePreferences, type HomeSectionId, type Preferences } from "./preferences";
import type { CalendarDay, CalendarEntry, WeekDay } from "./calendar";
import type { ProgressEntry } from "./library";

const SECTION_TO_FRENCH: Record<HomeSectionId, string> = {
  trending: "tendances",
  promo: "banniereCatalogue",
  calendar: "calendrier",
  recentEpisodes: "episodesRecents",
  recentAnime: "animesRecents",
  continueWatching: "reprendreLecture",
};
const SECTION_FROM_FRENCH = Object.fromEntries(Object.entries(SECTION_TO_FRENCH).map(([english, french]) => [french, english])) as Record<string, HomeSectionId>;

type PreferencesApi = {
  apparence: "sombre" | "clair";
  tailleTexte: "standard" | "grand";
  contrasteRenforce: boolean;
  triCatalogueDefaut: Preferences["defaultCatalogSort"];
  vueCalendrier: Preferences["calendarView"];
  languePreferee: Preferences["preferredLanguage"];
  detailsEpisodesVisibles: boolean;
  imagesEpisodesMasquees: boolean;
  sectionsAccueil: Array<{ section: string; activee: boolean }>;
  lecteur: {
    lectureAutomatique: boolean;
    episodeSuivantAuto: boolean;
    demarrerMuet: boolean;
    masquerCommandes: boolean;
    passerGenerique: boolean;
    reprendreLecture: boolean;
    tailleCommandes: Preferences["playerControlsSize"];
    vitesseLecture: Preferences["playerSpeed"];
  };
  animationsReduites: boolean;
  notifications: { annonces: boolean; nouveauxEpisodes: boolean; infolettre: boolean };
};
type UtilisateurApi = {
  identifiant: string;
  courriel: string;
  nom: string;
  statut: "utilisateur" | "administrateur";
  avatar: string;
  preferences: PreferencesApi;
  creeLe: string;
};

function preferencesVersApi(preferences: Preferences): PreferencesApi {
  return {
    apparence: preferences.appearance === "light" ? "clair" : "sombre",
    tailleTexte: preferences.textSize === "large" ? "grand" : "standard",
    contrasteRenforce: preferences.highContrast,
    triCatalogueDefaut: preferences.defaultCatalogSort,
    vueCalendrier: preferences.calendarView,
    languePreferee: preferences.preferredLanguage,
    detailsEpisodesVisibles: preferences.showEpisodeDetails,
    imagesEpisodesMasquees: preferences.hideEpisodeImages,
    sectionsAccueil: preferences.homeSections.map(({ id, enabled }) => ({ section: SECTION_TO_FRENCH[id], activee: enabled })),
    lecteur: {
      lectureAutomatique: preferences.playerAutoplay,
      episodeSuivantAuto: preferences.playerAutoNext,
      demarrerMuet: preferences.playerStartMuted,
      masquerCommandes: preferences.playerAutoHide,
      passerGenerique: preferences.playerAutoSkipIntro,
      reprendreLecture: preferences.playerResume,
      tailleCommandes: preferences.playerControlsSize,
      vitesseLecture: preferences.playerSpeed,
    },
    animationsReduites: preferences.reduceMotion,
    notifications: {
      annonces: preferences.notifications.announcements,
      nouveauxEpisodes: preferences.notifications.newEpisodes,
      infolettre: preferences.notifications.newsletter,
    },
  };
}

function preferencesDepuisApi(value: unknown): Preferences {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const notifications = raw.notifications && typeof raw.notifications === "object" ? raw.notifications as Record<string, unknown> : {};
  const sections = Array.isArray(raw.sectionsAccueil) ? raw.sectionsAccueil.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const section = item as Record<string, unknown>;
    const id = SECTION_FROM_FRENCH[String(section.section ?? "")];
    return id ? [{ id, enabled: section.activee === true }] : [];
  }) : [];
  return normalizePreferences({
    appearance: raw.apparence === "clair" ? "light" : "dark",
    textSize: raw.tailleTexte === "grand" ? "large" : "normal",
    highContrast: raw.contrasteRenforce,
    defaultCatalogSort: raw.triCatalogueDefaut,
    calendarView: raw.vueCalendrier,
    preferredLanguage: raw.languePreferee,
    showEpisodeDetails: raw.detailsEpisodesVisibles,
    hideEpisodeImages: raw.imagesEpisodesMasquees,
    homeSections: sections,
    playerAutoplay: (raw.lecteur as Record<string, unknown> | undefined)?.lectureAutomatique,
    playerAutoNext: (raw.lecteur as Record<string, unknown> | undefined)?.episodeSuivantAuto,
    playerStartMuted: (raw.lecteur as Record<string, unknown> | undefined)?.demarrerMuet,
    playerAutoHide: (raw.lecteur as Record<string, unknown> | undefined)?.masquerCommandes,
    playerAutoSkipIntro: (raw.lecteur as Record<string, unknown> | undefined)?.passerGenerique,
    playerResume: (raw.lecteur as Record<string, unknown> | undefined)?.reprendreLecture,
    playerControlsSize: (raw.lecteur as Record<string, unknown> | undefined)?.tailleCommandes,
    playerSpeed: (raw.lecteur as Record<string, unknown> | undefined)?.vitesseLecture,
    reduceMotion: raw.animationsReduites,
    notifications: {
      announcements: notifications.annonces,
      newEpisodes: notifications.nouveauxEpisodes,
      newsletter: notifications.infolettre,
    },
  });
}

export function utilisateurVersApi(user: SafeUser | null): UtilisateurApi | null {
  if (!user) return null;
  return {
    identifiant: user.id,
    courriel: user.email,
    nom: user.name,
    statut: user.role === "admin" ? "administrateur" : "utilisateur",
    avatar: user.avatar,
    preferences: preferencesVersApi(user.preferences),
    creeLe: user.createdAt,
  };
}

export function utilisateurDepuisApi(value: unknown): SafeUser | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Record<string, unknown>;
  if (typeof user.identifiant !== "string" || typeof user.courriel !== "string" || typeof user.nom !== "string") return null;
  return {
    id: user.identifiant,
    email: user.courriel,
    name: user.nom,
    role: user.statut === "administrateur" ? "admin" : "user",
    avatar: typeof user.avatar === "string" ? user.avatar : "default.jpg",
    preferences: preferencesDepuisApi(user.preferences),
    createdAt: typeof user.creeLe === "string" ? user.creeLe : "",
  };
}

export function progressionVersApi(entry: ProgressEntry) {
  return {
    saison: entry.season,
    nomSaison: entry.seasonName,
    numeroEpisode: entry.episode,
    langue: entry.language,
    misAJourLe: entry.updatedAt,
    position: typeof entry.position === "number" ? entry.position : null,
    duree: typeof entry.duration === "number" ? entry.duration : null,
  };
}

export function progressionDepuisApi(value: unknown): Record<string, ProgressEntry> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, raw]) => {
    if (!raw || typeof raw !== "object") return [];
    const entry = raw as Record<string, unknown>;
    return [[id, {
      season: String(entry.saison ?? ""),
      seasonName: typeof entry.nomSaison === "string" ? entry.nomSaison : undefined,
      episode: Number(entry.numeroEpisode) || 0,
      language: entry.langue === "vf" ? "vf" : "vostfr",
      updatedAt: Number(entry.misAJourLe) || 0,
      position: Number(entry.position) > 0 ? Number(entry.position) : undefined,
      duration: Number(entry.duree) > 0 ? Number(entry.duree) : undefined,
    } satisfies ProgressEntry]];
  }));
}

export type CalendrierApi = {
  jours: Array<{ jour: string; vo: Array<Record<string, unknown>>; vf: Array<Record<string, unknown>> }>;
  indexJourActuel: number;
  semaine: Array<Record<string, unknown>>;
};

function entreeCalendrierVersApi(entry: CalendarEntry) {
  return {
    identifiant: entry.id,
    titre: entry.titre,
    affiche: entry.affiche,
    genres: entry.genres,
    synopsis: entry.synopsis,
    saison: entry.season,
    numeroEpisode: entry.episode,
    titreEpisode: entry.episodeTitle,
    imageEpisode: entry.episodeStill,
    heure: entry.time,
    minutesDebut: entry.startMinutes,
  };
}

export function calendrierVersApi(days: CalendarDay[], todayIndex: number, week: WeekDay[]): CalendrierApi {
  return {
    jours: days.map((day) => ({ jour: day.day, vo: day.vo.map(entreeCalendrierVersApi), vf: day.vf.map(entreeCalendrierVersApi) })),
    indexJourActuel: todayIndex,
    semaine: week.map((day) => ({
      indice: day.index,
      jour: day.day,
      jourCourt: day.short,
      date: day.date,
      mois: day.month,
      estAujourdhui: day.isToday,
    })),
  };
}

export function calendrierDepuisApi(value: unknown): { days: CalendarDay[]; todayIndex: number; week: WeekDay[] } | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.jours) || !Array.isArray(payload.semaine)) return null;
  const days: CalendarDay[] = payload.jours.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const day = item as Record<string, unknown>;
    const toEntries = (entries: unknown): CalendarEntry[] => Array.isArray(entries) ? entries.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const entry = raw as Record<string, unknown>;
      return [{
        id: String(entry.identifiant ?? ""),
        titre: String(entry.titre ?? "Sans titre"),
        affiche: typeof entry.affiche === "string" ? entry.affiche : null,
        genres: Array.isArray(entry.genres) ? entry.genres.filter((genre): genre is string => typeof genre === "string") : [],
        synopsis: String(entry.synopsis ?? ""),
        season: typeof entry.saison === "string" ? entry.saison : null,
        episode: typeof entry.numeroEpisode === "string" ? entry.numeroEpisode : null,
        episodeTitle: typeof entry.titreEpisode === "string" ? entry.titreEpisode : null,
        episodeStill: typeof entry.imageEpisode === "string" ? entry.imageEpisode : null,
        time: typeof entry.heure === "string" ? entry.heure : null,
        startMinutes: Number(entry.minutesDebut) || Number.MAX_SAFE_INTEGER,
      }];
    }) : [];
    return [{ day: String(day.jour ?? ""), vo: toEntries(day.vo), vf: toEntries(day.vf) }];
  });
  const week: WeekDay[] = payload.semaine.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const day = item as Record<string, unknown>;
    return [{
      index: Number(day.indice) || 0,
      day: String(day.jour ?? ""),
      short: String(day.jourCourt ?? ""),
      date: Number(day.date) || 0,
      month: String(day.mois ?? ""),
      isToday: day.estAujourdhui === true,
    }];
  });
  return { days, todayIndex: Number(payload.indexJourActuel) || 0, week };
}
