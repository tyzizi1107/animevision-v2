"use client";

/**
 * Lecteur plein écran, sans habillage de page : dès l'arrivée, la vidéo occupe
 * tout l'écran, avec ses contrôles superposés (titre + sous-titre en bas à
 * gauche, barre de progression, rangée d'icônes) et un panneau d'épisodes qui
 * s'ouvre par-dessus l'image.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Hls from "hls.js";
import { LANGUAGE_LABELS, type AnimeLanguage, detailHref } from "@/lib/anime-types";

/** Nom affiché du provider d'origine, dans la liste des sources du lecteur. */
const PROVIDER_LABELS: Record<string, string> = {
  vidzy: "Vidzy",
  franime: "Franime",
  "anime-sama": "Anime-Sama",
  purstream: "Purstream",
};
import { useLibrary } from "@/lib/library";

import { CheckIcon, ChevronDownIcon } from "@/components/icons";
import { DEFAULT_PREFERENCES } from "@/lib/preferences";
import { useAuth } from "@/components/auth/auth-provider";
import { cn } from "@/lib/utils";
import { BROWSER_UA as BROWSER_UA_CLIENT } from "@/lib/providers/types";

type StreamItem = {
  url: string;
  proxyUrl: string;
  embedUrl: string;
  host: string;
  source: string;
  /** Provider d'origine (`vidzy`, `franime`…), s'il est connu. */
  provider?: string;
  language: "vf" | "vostfr";
  languageLabel: string;
  quality: string | null;
  qualities: string[];
  type: "hls" | "mp4" | "dash";
  title: string;
  /** Master HLS du provider (déclare les pistes audio) au lieu des segments. */
  masterUrl?: string | null;
  /** Pistes du provider : VF/VOSTFR ne sont souvent qu'un choix de piste. */
  tracks?: {
    subtitles?: Array<{ language: string; label: string; url: string }>;
    audio?: string[];
    /** Code de langue de chaque piste audio (`fr`, `ja`…). */
    audioLanguages?: string[];
  };
};

type StreamsPayload = {
  streams: StreamItem[];
  error?: string;
};

type EpisodeItem = {
  number: number;
  title: string | null;
  href: string;
  still?: string | null;
  runtime?: number | null;
  /** Langues réellement proposées, et numéro absolu de la série (coche). */
  hasVf?: boolean;
  hasVo?: boolean;
  absolute?: number | null;
};
type SeasonItem = { slug: string; name: string; number: number; episodes: EpisodeItem[] };

type Props = {
  animeId: string;
  title: string;
  seasonSlug: string;
  seasonName: string;
  episodeNumber: number;
  seasonNumber: number;
  episodeTitle?: string;
  language: AnimeLanguage;
  languageHrefs: Partial<Record<AnimeLanguage, string>>;
  previousHref?: string;
  nextHref?: string;
  coverImage?: string | null;
  coverIsEpisodeStill?: boolean;
  poster?: string | null;
  seasons: SeasonItem[];
  activeSeasonSlug: string;
  episodes: EpisodeItem[];
  /** Film : ni saison, ni liste d'épisodes (un seul média). */
  isMovie?: boolean;
};

const HIDE_CONTROLS_MS = 3_000;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  // Toujours HH:MM:SS, comme la maquette (01:02:23 · 01:42:44).
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function EmbedPlayer({
  animeId,
  title,
  seasonSlug,
  seasonName,
  episodeNumber,
  seasonNumber,
  episodeTitle,
  language,
  languageHrefs,
  previousHref,
  nextHref,
  coverImage,
  poster,
  seasons,
  activeSeasonSlug,
  episodes,
  isMovie = false,
}: Props) {
  const { saveEpisode, savePosition, progress } = useLibrary();

  /* ------------------------------ sources ------------------------------ */
  const [streams, setStreams] = useState<StreamItem[]>([]);
  /**
   * Langue réellement lue. La langue de l'URL n'est qu'une préférence : si sa
   * source ne répond pas, le lecteur bascule sur l'autre langue et l'interface
   * doit suivre, sinon le panneau annonce une langue et joue l'autre.
   */
  const [activeLanguage, setActiveLanguage] = useState<AnimeLanguage>(language);
  /** Langue du flux réellement retenu : c'est elle qui décide audio + sous-titres. */
  const [playedLanguage, setPlayedLanguage] = useState<AnimeLanguage>(language);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  // Sous-titres : état courant et verrou de choix, lisibles depuis l'effet du
  // flux (l'état React d'origine est déclaré plus bas).
  const subtitlesOnRef = useRef(false);
  const subsLockedRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  // Préférence du compte lue au rendu : sans `lang` dans l'URL, elle décide de
  // l'ordre des sources (la VF d'abord si elle existe).
  const preferredLanguage = useAuth().user?.preferences?.preferredLanguage;
  const accountPrefersVf = preferredLanguage === "vf";
  // `auto` (ou aucune préférence) = VO sous-titrée d'abord, VF en repli.
  const wantedLanguage = language === "vf" || (language !== "vostfr" && accountPrefersVf) ? "vf" : "vostfr";
  // Nommé ainsi pour la lecture : `requestedLanguage` (plus bas) s'appuie dessus.
  /**
   * Langue demandée : celle de l'URL, sinon la préférence du compte. La
   * préférence n'est qu'un voeu : si aucune source ne la sert, le lecteur
   * bascule et le dit, et l'URL est réécrite pour suivre la lecture réelle.
   */
  const requestedLanguage: AnimeLanguage = language === "vf" || language === "vostfr"
    ? language
    : accountPrefersVf
      ? "vf"
      : "vostfr";

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setStreams([]);
    setIndex(0);
    setNotice(null);
    setActiveLanguage(language);
    const params = new URLSearchParams({ id: animeId, season: String(seasonNumber), episode: String(episodeNumber) });
    // Après une première recherche vide, on redemande directement aux sources.
    if (attempt > 0) params.set("force", "1");
    // La langue voulue part avec la demande : l'ordre des flux en dépend.
    params.set("prefer", requestedLanguage);
    fetch(`/api/streams?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as StreamsPayload;
        if (!response.ok && !payload.streams?.length) throw new Error(payload.error ?? "Erreur des sources.");
        return payload;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const ordered = [...(payload.streams ?? [])].sort((a, b) => {
          // Le classement suit la langue DEMANDÉE (préférence du compte
          // comprise) : un fichier à deux pistes est annoncé « VF », et il doit
          // passer devant quand c'est la VF qui est voulue.
          const languageRank = (stream: StreamItem) => (stream.language === requestedLanguage ? 0 : 1);
          const qualityRank = (stream: StreamItem) => Number.parseInt(stream.quality ?? "0", 10) || 0;
          return languageRank(a) - languageRank(b) || qualityRank(b) - qualityRank(a);
        });
        setStreams(ordered);
        setStatus(ordered.length > 0 ? "ready" : "empty");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [animeId, seasonNumber, episodeNumber, requestedLanguage, attempt]);

  const source = streams[index] ?? streams[0] ?? null;

  // Repère de génération : quand un nouveau flux remplace la balise <video>,
  // les effets ne se relancent pas (mêmes dépendances) et les sous-titres
  // restaient éteints sur l'épisode suivant. On incrémente à chaque source.
  const [mediaEpoch, setMediaEpoch] = useState(0);
  useEffect(() => {
    setMediaEpoch((value) => value + 1);
  }, [source?.proxyUrl, source?.masterUrl, source?.url]);

  // « Reprendre la lecture » ne s'enregistre que si une source existe vraiment :
  // ouvrir un épisode sans flux ne doit pas laisser une fiche en attente à 0:00.
  // On enregistre la langue RÉELLEMENT jouée au passage, sinon la reprise
  // repartait sur la langue de l'URL (VOSTFR) après un épisode vu en VF.
  const playedForSave = useRef(source?.language ?? null);
  playedForSave.current = source?.language ?? playedForSave.current;
  useEffect(() => {
    if (!source) return;
    const played = playedForSave.current === "vf" ? "vf" : playedForSave.current === "vostfr" ? "vostfr" : language;
    saveEpisode(animeId, seasonSlug, seasonName, episodeNumber, played);
  }, [animeId, seasonSlug, seasonName, episodeNumber, language, saveEpisode, source]);

  // La langue affichée suit le flux réellement en lecture, et l'URL suit la
  // langue jouée : recharger ou partager le lien doit ouvrir le même flux.
  useEffect(() => {
    if (!source?.language) return;
    const played: AnimeLanguage = source.language === "vf" ? "vf" : "vostfr";
    setActiveLanguage(played);
    setPlayedLanguage(played);
    // La langue n'est plus dans l'URL (les adresses sont celles de Vidzy) :
    // on nettoie seulement un ancien `?lang=` pour que le partage ne réimpose
    // pas une langue à quelqu'un d'autre.
    const url = new URL(window.location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.delete("lang");
      window.history.replaceState(window.history.state, "", url.toString());
    }
    // Préférence VF demandée mais aucune VF servie : on le dit clairement,
    // au lieu de laisser croire que l'épisode est en VF.
    if (requestedLanguage === "vf" && played !== "vf") {
      setNotice("Bascule en VOSTFR : aucun lien disponible en VF");
    } else if (requestedLanguage !== "vf" && played === "vf") {
      setNotice("Bascule en VF : aucun lien disponible en VOSTFR");
    }
  }, [source, requestedLanguage]);

  /** Langue réellement lue (VF ou VOSTFR), indépendante de l'URL. */
  const displayLanguage: AnimeLanguage = activeLanguage === "vf" ? "vf" : "vostfr";

  /**
   * Lien d'épisode qui conserve la langue regardée : la langue affichée prime
   * sur la préférence du compte. Elle est écrite dans l'URL, qui reste donc la
   * seule référence d'un épisode à l'autre.
   */
  const withLanguage = useCallback((href: string) => {
    const url = new URL(href, "http://local");
    url.searchParams.set("lang", displayLanguage);
    return `${url.pathname}${url.search}`;
  }, [displayLanguage]);


  /* ------------------------------ lecteur ------------------------------ */
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeApplied = useRef(false);

  /** L'autoplay muet de départ n'est appliqué qu'une fois. */
  const quietStartDone = useRef(false);
  const lastSaved = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  /** Temps et durée réels, hors rendu : servis à la reprise et au changement de source. */
  const liveTime = useRef(0);
  const liveDuration = useRef(0);
  /** Position à réappliquer après un changement de source (même épisode). */
  const carryPosition = useRef(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  /** Vitesse de lecture : part de la préférence du compte, modifiable ici. */
  const [speed, setSpeed] = useState(1);
  /** Réglages modifiables directement dans le menu du lecteur. */
  const [autoplayOn, setAutoplayOn] = useState(true);
  const [autoNextOn, setAutoNextOn] = useState(true);
  const [startMutedOn, setStartMutedOn] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const speedRef = useRef(1);
  /** Réglages du menu, lus par les événements du <video> (sans re-render). */
  const autoplayRef = useRef(true);
  const autoNextRef = useRef(true);
  const startMutedRef = useRef(true);
  autoplayRef.current = autoplayOn;
  autoNextRef.current = autoNextOn;
  startMutedRef.current = startMutedOn;
  const changeSpeed = (value: number) => {
    speedRef.current = value;
    setSpeed(value);
    const video = videoRef.current;
    if (video) video.playbackRate = value;
  };
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menu, setMenu] = useState<"settings" | null>(null);
  /** Langue de sous-titres choisie (`off` = aucun). */
  /** Langue des sous-titres retenue (`fre` par défaut). */
  // Langue des sous-titres : réglage du compte (« Celle du flux » par défaut),
  // sinon celle du flux publiée par le provider.
  const preferredSubtitleLanguage = useAuth().user?.preferences?.subtitleLanguage ?? "auto";
  const [subtitleLang, setSubtitleLang] = useState<string>(
    preferredSubtitleLanguage === "auto" ? "fre" : preferredSubtitleLanguage,
  );
  // Libellé de la piste retenue : le provider peut publier deux pistes de la
  // même langue (« Français complet » et « Français »).
  const [subtitleLabel, setSubtitleLabel] = useState<string | null>(null);
  /** Sous-titres affichés ou non — indépendant de la langue choisie. */
  const [subtitlesOn, setSubtitlesOn] = useState(false);
  /**
   * Réplique affichée par notre propre calque de sous-titres.
   *
   * Pourquoi pas le rendu natif du navigateur : mesuré dans Chrome, celui-ci
   * ignore `::cue` (couleur, taille, fond, ombre — tout reste par défaut) et
   * ne peint pas la cue dans certaines conditions. On lit donc les `VTTCue`
   * de la piste active et on les dessine dans la page, où le style est maîtrisé.
   */
  const [cueText, setCueText] = useState("");
  /** Réplique courante, en ref : écrite à chaque lecture de piste. */
  const cueTextRef = useRef("");
  /** Pistes audio annoncées par le flux HLS en cours (vide = piste unique). */
  const [hlsAudio, setHlsAudio] = useState<Array<{ name: string; lang: string }>>([]);
  /**
   * Réglage « sous-titres automatiques » du compte : `true` = toujours actifs,
   * `false` = jamais, `null` = suivre la langue lue (VOSTFR sous-titré, VF non).
   */
  const subtitlesAuto = useAuth().user?.preferences?.subtitlesAuto ?? null;
  const subtitlesAutoRef = useRef<boolean | null>(subtitlesAuto);
  subtitlesAutoRef.current = subtitlesAuto;

  /** Piste audio choisie (index), `null` = piste par défaut du flux. */
  const [audioTrack, setAudioTrack] = useState<number | null>(null);
  /**
   * Langue audio voulue (`fr`, `ja`…), retenue d'un épisode à l'autre : sur
   * Vidzy un même fichier porte plusieurs langues, la VF n'est pas un fichier
   * séparé. `null` = pas encore de choix.
   */
  const [audioLanguage, setAudioLanguage] = useState<string | null>(
    () => (requestedLanguage === "vf" ? "fr" : "ja"),
  );
  /** Faux tant que l'utilisateur n'a pas choisi lui-même la piste audio. */
  const [audioPinned, setAudioPinned] = useState(false);
  const [episodePanel, setEpisodePanel] = useState(false);
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seasonSlugState, setSeasonSlugState] = useState(activeSeasonSlug);

  /** Reprise à la minute près — réservée aux comptes connectés. */
  const { user, setUser } = useAuth();

  /** Enregistre un réglage dans les préférences du compte (lecteur ↔ compte). */
  const updatePreferences = useCallback(async (patch: Record<string, unknown>) => {
    if (!user) return;
    const preferences = { ...user.preferences, ...patch };
    try {
      const response = await fetch("/api/compte/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences }),
      });
      const payload = (await response.json().catch(() => ({}))) as { user?: typeof user };
      if (response.ok && payload.user) setUser(payload.user);
    } catch {
      // Réglage non enregistré : le lecteur garde le choix pour cette session.
    }
  }, [user, setUser]);
  /** Personnalisation du lecteur (page Préférences). */
  const playerPrefs = user?.preferences ?? DEFAULT_PREFERENCES;
  // La vitesse choisie dans les paramètres du compte sert de départ.
  const preferredSpeed = playerPrefs.playerSpeed ?? 1;
  useEffect(() => {
    setSpeed(preferredSpeed);
  }, [preferredSpeed]);
  useEffect(() => {
    setAutoplayOn(playerPrefs.playerAutoplay);
    setAutoNextOn(playerPrefs.playerAutoNext);
    setStartMutedOn(playerPrefs.playerStartMuted);
  }, [playerPrefs.playerAutoplay, playerPrefs.playerAutoNext, playerPrefs.playerStartMuted]);
  // Langue demandée : l'URL prime, sinon la préférence du compte.
  const languageToAsk: AnimeLanguage = requestedLanguage === "vostfr" && accountPrefersVf && language !== "vostfr" ? "vf" : requestedLanguage;
  const prefsRef = useRef(playerPrefs);
  prefsRef.current = playerPrefs;
  // Progression de la série, comme sur la fiche : l'épisode en cours garde sa
  // barre, les précédents portent une coche, et le numéro affiché est le
  // numéro absolu de la série.
  const progressEntry = progress[animeId];
  const progressSeason = progressEntry?.season ?? null;
  const progressEpisode = progressEntry?.episode ?? null;
  const watchedPercent = (() => {
    if (!progressEntry?.duration || !progressEntry.position) return null;
    return Math.min(100, Math.max(1, (progressEntry.position / progressEntry.duration) * 100));
  })();
  const remainingMinutes = progressEntry?.duration && progressEntry.position
    ? Math.max(1, Math.round((progressEntry.duration - progressEntry.position) / 60))
    : null;

  const resumeAt = useMemo(() => {
    if (!user || !user.preferences.playerResume) return 0;
    const entry = progress[animeId];
    if (!entry || entry.season !== seasonSlug || entry.episode !== episodeNumber) return 0;
    // Reprise « à la minute près » : on revient à la seconde exacte où la
    // lecture s'est arrêtée (plus d'arrondi volontaire à la minute).
    const position = typeof entry.position === "number" ? entry.position : 0;
    return position >= 5 ? Math.floor(position) : 0;
  }, [progress, animeId, seasonSlug, episodeNumber, user]);

  const isHls = source ? source.type === "hls" || /\.m3u8(?:[?#]|$)/i.test(source.url) : false;

  // Pistes proposées : celles du provider (Vidzy : VF et VOSTFR partagent le
  // même fichier, la version n'est qu'un choix de piste) plus celles du flux.
  const subtitleOptions = useMemo(() => {
    // Une seule entrée « Français » : si le provider publie deux pistes (dont
    // une version catalane/anglaise), c'est la française qui compte, et
    // `/api/sous-titres` la traduit au besoin.
    const raw = source?.tracks?.subtitles ?? [];
    const frenchOnly = raw.filter((track) => /^fr/i.test(track.language));
    const list = frenchOnly.length ? frenchOnly : raw;
    // Une clé par piste : Vidzy publie deux pistes françaises (« Français
    // complet » et « Français »), qu'il faut pouvoir choisir séparément.
    const seen = new Set<string>();
    const unique = list.filter((track) => {
      const key = `${track.language}|${track.label}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });
    // Le lecteur n'affiche que le français : les pistes catalane, japonaise,
    // arabe… publiées par le provider n'ont pas leur place dans les réglages.
    const french = unique.filter((track) => /^fr/i.test(track.language));
    return french.length ? french : unique.slice(0, 1);
  }, [source]);
  const audioOptions = hlsAudio.length ? hlsAudio.map((track) => track.name) : source?.tracks?.audio ?? [];
  const audioLanguageCodes = hlsAudio.length
    ? hlsAudio.map((track) => track.lang)
    : source?.tracks?.audioLanguages ?? [];
  // Piste réellement demandée : le choix explicite (index) sinon la langue
  // mémorisée (c'est elle qui fait la VF).
  const wantedAudioIndex = (() => {
    if (!audioLanguageCodes.length) {
      // Le manifeste n'a pas encore publié ses pistes : on garde la valeur
      // courante, sauf si c'est la piste par défaut (0) alors que la VF est
      // demandée — sinon `null` fait retomber l'interface sur la position 0,
      // c'est-à-dire le japonais.
      return requestedLanguage === "vf" && audioTrack === 0 ? null : audioTrack;
    }
    // La langue mémorisée prime : elle est réappliquée à chaque nouveau flux.
    // Seul un choix explicite s'impose : sinon on laisse la piste déclarée par
    // le fichier (VOSTFR = japonaise, même si la langue mémorisée est `fr`).
    if (audioPinned && audioLanguage) {
      const position = audioLanguageCodes.indexOf(audioLanguage);
      if (position >= 0) return position;
    }
    if (audioTrack !== null) return audioTrack;
    // Aucun choix : la langue du flux décide. VOSTFR = piste japonaise,
    // VF = piste française ; à défaut, la piste marquée par défaut.
    // La langue DEMANDÉE décide (préférence du compte comprise) : sinon on
    // suivait la langue annoncée par le fichier, souvent VOSTFR, et la VF
    // choisie dans le compte ne s'appliquait jamais.
    const wantedCode = requestedLanguage === "vf" ? "fr" : "ja";
    const position = audioLanguageCodes.findIndex((code) => code.slice(0, 2).toLowerCase() === wantedCode);
    return position >= 0 ? position : null;
  })();

  const handleStreamError = useCallback(() => {
    if (index < streams.length - 1) {
      // On garde la minute atteinte : la source suivante reprend au même endroit.
      carryPosition.current = liveTime.current;
      setIndex((current) => current + 1);
      setNotice("Cette source ne répond pas — passage à la suivante.");
      return;
    }
    setNotice("Aucun lecteur n'a démarré. Nouvelle recherche des sources…");
    if (attempt < 2) {
      // force=1 : on redemande aux sources au lieu de lire le cache.
      setAttempt((current) => current + 1);
      return;
    }
    setAttempt((current) => current + 1);
  }, [index, streams.length, attempt]);

  // Mise en place du flux (HLS via hls.js, sinon lecture native).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return;
    let destroyed = false;
    setError(null);
    setBuffering(true);
    resumeApplied.current = false;
    // Nouvelle source : les pistes précédentes ne valent plus rien.
    setHlsAudio([]);
    setAudioTrack(null);
    setAudioPinned(false);
    // Sous-titres : réglage du compte (préférence « Sous-titres automatiques »).
    // Par défaut ils suivent la langue lue — VOSTFR = japonais sous-titré, VF =
    // audio seul — mais un choix explicite dans les paramètres du lecteur gagne.
    // Un choix déjà fait (clic dans le menu, ou sous-titres auto déjà allumés)
    // prime : Vidzy change de fichier en cours de lecture, et chaque changement
    // remettait les sous-titres à zéro.
    if (subsLockedRef.current || subtitlesOnRef.current) {
      // On garde l'état courant.
    } else {
      setSubtitlesOn(subtitlesAutoRef.current ?? playedLanguage === "vostfr");
    }

    // Un master multi-pistes (VF + japonais dans le même fichier) doit passer
    // par hls.js : la lecture native du manifeste ne permet pas de choisir la
    // piste audio, la VF resterait donc inaudible.
    // Toujours hls.js : lui seul expose les pistes audio (VF et japonais dans
    // un même fichier), y compris quand le manifeste est une playlist simple.
    const nativeHls = false;

    if (isHls && !nativeHls) {
      import("hls.js")
        .then(({ default: HlsLib }) => {
          if (destroyed) return;
          if (!HlsLib.isSupported()) {
            setError("Ce navigateur ne peut pas lire ce flux.");
            return;
          }
          const hls = new HlsLib({
            enableWorker: true,
            backBufferLength: 90,
          });
          hlsRef.current = hls;
          // Le master déclare les pistes audio (VF + japonais dans un même
          // fichier) : on le charge quand le provider en donne un, sinon la
          // playlist de segments jouée directement.
          const playable = source.masterUrl
            ? `/api/proxy?url=${encodeURIComponent(source.masterUrl)}&user-agent=${encodeURIComponent(BROWSER_UA_CLIENT)}`
            : source.proxyUrl;
          hls.loadSource(playable);
          hls.attachMedia(video);
          // Pistes audio du manifeste (Vidzy en déclare parfois plusieurs).
          hls.on(HlsLib.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
            const tracks = (data.audioTracks ?? []).map((track, position) => ({
              name: track.name || track.lang || `Piste ${position + 1}`,
              lang: (track.lang || "").slice(0, 2).toLowerCase(),
            }));
            // Une seule piste : inutile d'encombrer les réglages.
            setHlsAudio(tracks.length > 1 ? tracks : []);
          });
          hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
            // hls.js démarre sur la piste par défaut (souvent le japonais) :
            // on applique tout de suite la langue demandée, sans attendre
            // l'effet qui dépend du re-rendu.
            try {
              const codes = (hls.audioTracks ?? []).map((track) => (track.lang || "").slice(0, 2).toLowerCase());
              const want = requestedLanguage === "vf" ? "fr" : "ja";
              const found = codes.findIndex((code) => code === want);
              if (found >= 0 && hls.audioTrack !== found) hls.audioTrack = found;
            } catch {
              // Pas de pistes multiples : rien à faire.
            }
            // Les pistes texte du manifeste sont désactivées ; celles du
            // provider (`data-player-subs`) restent gérées par l'effet des
            // sous-titres, sinon elles étaient éteintes juste après.
            if (video.textTracks) {
              for (const track of Array.from(video.textTracks)) {
                if (track.kind !== "subtitles" && track.kind !== "captions") continue;
                track.mode = "disabled";
              }
            }
            // Muet au départ seulement si la préférence le demande (sinon le
            // navigateur peut refuser l'autoplay : le ▶ central reste là).
            const startMuted = startMutedRef.current;
            video.muted = startMuted;
            video.playbackRate = speedRef.current;
            if (!autoplayRef.current) return;
            void video.play().then(() => {
              if (!quietStartDone.current) {
                quietStartDone.current = true;
                if (startMuted) video.muted = false;
              }
            }).catch(() => {
              // Autoplay refusé : le lecteur attend un clic, sans message d'erreur.
            });
          });
          // Une coupure réseau n'est pas une source morte : on recharge la même
          // source plusieurs fois avant d'envisager la suivante.
          let networkRetries = 0;
          hls.on(HlsLib.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
              networkRetries += 1;
              if (networkRetries <= 6) {
                window.setTimeout(() => hls.startLoad(), 800 * networkRetries);
                return;
              }
              setError("Le flux s'est interrompu.");
              handleStreamError();
              return;
            }
            // Erreur de média : une seule tentative de reprise, puis on change.
            if (networkRetries < 1) {
              networkRetries += 1;
              hls.recoverMediaError();
              return;
            }
            setError("Le flux s'est interrompu.");
            handleStreamError();
          });
        })
        .catch(() => setError("Lecteur HLS indisponible."));
      return () => {
        destroyed = true;
        hlsRef.current?.destroy();
        hlsRef.current = null;
      };
    }

    video.src = source.proxyUrl;
    const startMuted = startMutedRef.current;
    video.muted = startMuted;
    video.playbackRate = speedRef.current;
    if (autoplayRef.current) {
      void video.play().then(() => {
        if (!quietStartDone.current) {
          quietStartDone.current = true;
          if (startMuted) video.muted = false;
        }
      }).catch(() => undefined);
    }
    return () => {
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.proxyUrl, source?.masterUrl, isHls, playedLanguage]);

  // La préférence du compte peut arriver APRÈS la recherche des flux (le
  // profil se charge en asynchrone) : on relance alors la demande, sinon
  // l'ordre des flux restait celui de la langue par défaut.
  const accountPrefRef = useRef(requestedLanguage);
  useEffect(() => {
    if (accountPrefRef.current === requestedLanguage) return;
    accountPrefRef.current = requestedLanguage;
    setAttempt((value) => value + 1);
  }, [requestedLanguage]);

  // Piste audio choisie : on la réapplique dès qu'elle change, qu'un nouveau
  // manifeste arrive (hls.js repart sur la piste par défaut sinon) ou que le
  // choix est fait après le chargement du flux.
  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls || wantedAudioIndex === null) return;
    const select = () => {
      try {
        if (hls.audioTrack !== wantedAudioIndex) hls.audioTrack = wantedAudioIndex;
      } catch {
        // Piste absente du flux courant : on garde la piste par défaut.
      }
    };
    select();
    hls.on("hlsAudioTracksUpdated" as never, select as never);
    // hls.js revient à la piste par défaut (le japonais) quand on entre en
    // plein écran ou après un saut : on réapplique à chaque fois, sinon la VF
    // choisie dans le compte repassait en japonais en cours de lecture.
    const enforce = () => {
      if (hls.audioTrack !== wantedAudioIndex) select();
    };
    hls.on("hlsAudioTrackSwitched" as never, enforce as never);
    videoRef.current?.addEventListener("enterpictureinpicture", enforce);
    return () => {
      hls.off("hlsAudioTracksUpdated" as never, select as never);
      hls.off("hlsAudioTrackSwitched" as never, enforce as never);
      videoRef.current?.removeEventListener("enterpictureinpicture", enforce);
    };
  }, [wantedAudioIndex, source?.proxyUrl, hlsAudio.length]);

  // Le provider peut publier plusieurs pistes : on garde la française, dont le
  // code (`fre`) et le libellé (`Français`) changent d'un épisode à l'autre.
  useEffect(() => {
    if (preferredSubtitleLanguage !== "auto") return;
    const french = subtitleOptions.find((option) => /^fr/i.test(option.language));
    if (!french) return;
    setSubtitleLang(french.language);
    setSubtitleLabel((current) => current ?? french.label);
  }, [subtitleOptions, preferredSubtitleLanguage]);

  // Sous-titres : un <track> par langue publiée par le provider, servie par le
  // proxy (l'URL `srtproxy` renvoie vers le CDN, qu'il faut relayer). Une seule
  // piste est active à la fois, et le choix est retenu d'un épisode à l'autre.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const existing = video.querySelectorAll("track[data-player-subs]");
    existing.forEach((track) => track.remove());
    for (const option of subtitleOptions) {
      const element = document.createElement("track");
      element.kind = "subtitles";
      element.label = option.label;
      element.srclang = option.language.slice(0, 3);
      // Sous-titres servis par `/api/sous-titres` : il récupère le VTT chez le
      // provider et le traduit en français quand la piste est en anglais (Vidzy
      // ne publie qu'une langue par épisode).
      const page = (option as { pageUrl?: string }).pageUrl;
      element.src = `/api/sous-titres?url=${encodeURIComponent(option.url)}${page ? `&page=${encodeURIComponent(page)}` : ""}`;
      element.dataset.playerSubs = "1";
      video.appendChild(element);
    }
    const apply = (..._args: unknown[]) => {
      const textTracks = Array.from(video.textTracks).filter((track) => track.kind === "subtitles" || track.kind === "captions");
      // Aucune correspondance de libellé/code (le provider renomme ses pistes
      // d'un épisode à l'autre) : on affiche la première piste plutôt que rien.
      const fallback = textTracks[0];
      let matched = false;
      for (const track of Array.from(video.textTracks)) {
        if (track.kind !== "subtitles" && track.kind !== "captions") continue;
        // `track.language` vaut le code du fichier (`fr`, `en`…) alors que
        // `subtitleLang` est le code du provider (`fre`) : on compare les trois
        // premières lettres, sinon la piste choisie restait désactivée.
        const sameLanguage = subtitleOptions.filter((option) => option.language === subtitleLang);
        const selected = sameLanguage.find((option) => option.label === subtitleLabel)
          ?? (sameLanguage.length === 1 ? sameLanguage[0] : undefined);
        // La piste visée est désignée par son libellé, sinon par le code de
        // langue ; les deux peuvent différer d'un épisode à l'autre.
        const wanted = subtitlesOn
          && (selected
            ? track.label === selected.label
            : track.language.slice(0, 2) === subtitleLang.slice(0, 2));
        if (wanted) matched = true;
        // `hidden` : le navigateur charge le .vtt et remplit `activeCues`, mais
        // ne peint rien — c'est notre calque qui dessine le texte. En `showing`
        // le rendu natif se superposait au nôtre (deux textes décalés).
        track.mode = wanted ? "hidden" : "disabled";
      }
      if (!matched && fallback && subtitlesOn) fallback.mode = "hidden";
    };
    // Les VTT du provider enveloppent chaque réplique dans <b><i> : le style
    // des balises internes n'est pas appliqué par le navigateur, d'où un texte
    // plus petit. On force donc la même taille et la même graisse sur les
    // balises (voir globals.css) au lieu de réécrire les cues.
    apply();
    // Les pistes arrivent en asynchrone : on réapplique dès qu'une d'elles est
    // réellement chargée (sinon un épisode gardait le mode `disabled`).
    video.textTracks.addEventListener?.("addtrack", apply);
    video.textTracks.addEventListener?.("change", apply);
    return () => {
      video.textTracks.removeEventListener?.("addtrack", apply);
      video.textTracks.removeEventListener?.("change", apply);
    };
  }, [subtitleOptions, subtitleLang, subtitleLabel, subtitlesOn, source?.proxyUrl, mediaEpoch]);

  // Lecture des répliques de la piste active → calque de sous-titres.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const read = () => {
      // La piste à lire est celle que l'effet des <track> a mise en `hidden` :
      // c'est le seul mode qui garde les répliques sans que le navigateur les
      // peigne. Filtrer en plus par libellé écartait la piste quand celui du
      // provider (`Français`) ne correspondait pas exactement au choix — le
      // calque restait alors vide alors que les répliques étaient chargées.
      const active = Array.from(video.textTracks).find((track) => track.mode === "hidden")
        ?? Array.from(video.textTracks).find((track) => track.mode === "showing");
      const cues = active?.activeCues ? Array.from(active.activeCues as unknown as Array<{ text?: string }>) : [];
      const next = cues.map((cue) => (cue.text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
      // Comparaison avec la RÉF, jamais avec l'état : la closure de l'intervalle
      // garde un état périmé, et `current === next` renvoyait toujours l'ancien
      // texte, c'est-à-dire rien.
      if (cueTextRef.current === next) return;
      cueTextRef.current = next;
      setCueText(next);
    };
    // Boucle d'affichage : `requestAnimationFrame` plutôt que `setTimeout`.
    // Mesuré dans Chrome : une boucle de `setTimeout` ne tourne pas (ou très
    // lentement) quand l'onglet est en arrière-plan ou en lecture sans focus,
    // et le calque restait vide alors que les répliques étaient chargées —
    // l'événement `timeupdate`, lui, n'arrive que 4 fois par seconde.
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      read();
      frame = window.requestAnimationFrame(loop);
    };
    // Deux moteurs, pour ne dépendre d'aucun des deux : `requestAnimationFrame`
    // (fluide quand la page est visible) ET un intervalle de 100 ms (qui tourne
    // aussi en arrière-plan et en lecture sans focus). Mesuré : la seule boucle
    // d'animation laissait le calque vide quand la page n'était pas au premier
    // plan, ce qui est le cas d'un onglet de lecteur ouvert à côté.
    let interval = 0;
    if (subtitlesOn) {
      read();
      loop();
      interval = window.setInterval(read, 100);
    } else setCueText("");
    video.addEventListener("timeupdate", read);
    video.addEventListener("seeked", read);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(frame);
      video.removeEventListener("timeupdate", read);
      video.removeEventListener("seeked", read);
    };
  }, [subtitlesOn, subtitleOptions, subtitleLabel, source?.proxyUrl, mediaEpoch]);

  // Ce que le lecteur décide LUI-MÊME (automatique ou clic dans le menu) ne doit
  // pas être écrasé par la règle « automatique » ci-dessous, qui se rejoue à
  // chaque nouveau flux. Vidzy change de fichier en cours de lecture : sans ce
  // verrou, les sous-titres se coupaient tout seuls.
  subtitlesOnRef.current = subtitlesOn;
  useEffect(() => {
    if (!subsLockedRef.current) return;
    if (!subtitlesOn) subsLockedRef.current = false;
  }, [subtitlesOn]);

  // VOSTFR = version originale sous-titrée : si le réglage du compte ne dit rien
  // (« automatiques »), les sous-titres s'activent dès que les pistes arrivent.
  // Sans cela, `subtitlesOn` restait faux au premier rendu (aucune piste encore)
  // et rien ne l'allumait ensuite : c'est pourquoi ils n'apparaissaient jamais.
  useEffect(() => {
    if (subtitlesAuto !== null) return;
    if (subtitleOptions.length === 0) return;
    // Le choix de l'utilisateur (menu du lecteur) ne se rejoue pas.
    if (subsLockedRef.current) return;
    const wanted = playedLanguage === "vostfr";
    subsLockedRef.current = wanted;
    setSubtitlesOn(wanted);
    if (process.env.NODE_ENV !== "production") console.log("[subs] auto →", wanted, "depuis played=", playedLanguage);
  }, [subtitleOptions.length, playedLanguage, subtitlesAuto, mediaEpoch]);

  // Événements de la balise vidéo.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoaded = () => {
      setDuration(video.duration || 0);
      liveDuration.current = video.duration || 0;
      setBuffering(false);
      // Une source qui recharge remet la vitesse à 1 : on la rétablit.
      if (Math.abs(video.playbackRate - speedRef.current) > 0.01) video.playbackRate = speedRef.current;
      const wanted = carryPosition.current > 0 ? carryPosition.current : resumeAt;
      if (wanted > 0 && Number.isFinite(video.duration) && wanted < video.duration - 10) {
        video.currentTime = wanted;
        resumeApplied.current = true;
      }
      carryPosition.current = 0;
    };
    const onTime = () => {
      setCurrentTime(video.currentTime);
      liveTime.current = video.currentTime;
      liveDuration.current = video.duration || 0;
      // Position mémorisée toutes les 15 s, jamais à chaque image, et seulement
      // une fois quelques secondes réellement lues.
      if (video.currentTime >= 5 && Math.abs(video.currentTime - lastSaved.current) >= 15) {
        lastSaved.current = video.currentTime;
        savePosition(animeId, video.currentTime, video.duration);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onVolume = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onErrorEvent = () => {
      // Coupure passagère (réseau, buffer) : on ne saute pas de source, on réessaie.
      const code = video.error?.code;
      if (code === MediaError.MEDIA_ERR_NETWORK || code === MediaError.MEDIA_ERR_ABORTED) {
        setBuffering(true);
        window.setTimeout(() => {
          if (videoRef.current) void videoRef.current.play().catch(() => undefined);
        }, 1200);
        return;
      }
      setError("Lecture impossible.");
      handleStreamError();
    };
    const onEnded = () => {
      if (nextHref && autoNextRef.current) window.location.href = withLanguage(nextHref);
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("error", onErrorEvent);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("error", onErrorEvent);
      video.removeEventListener("ended", onEnded);
    };
  }, [animeId, resumeAt, savePosition, handleStreamError, nextHref, withLanguage]);

  /* ----------------------------- commandes ----------------------------- */
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min((video.duration || 0) - 0.4, video.currentTime + delta));
  }, []);

  /**
   * Enregistre un réglage du lecteur sur le compte (connecté seulement) et
   * l'applique tout de suite. Les visiteurs non connectés gardent le réglage
   * pour la session en cours, sans écriture.
   */
  const persistPreference = useCallback(async (patch: Partial<typeof playerPrefs>) => {
    if (!user) return;
    setSaveState("saving");
    try {
      const next = { ...prefsRef.current, ...patch };
      prefsRef.current = next;
      const response = await fetch("/api/compte/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: next }),
      });
      setSaveState(response.ok ? "saved" : "idle");
      if (response.ok) window.setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("idle");
    }
  }, [user]);

  /**
   * Règle le volume (jauge) : 0 coupe le son, au-delà on le rétablit.
   * Arrondi au pourcent pour que la jauge et les flèches restent d'accord.
   */
  const changeVolume = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
    video.volume = next;
    video.muted = next === 0;
    setVolume(next);
    setMuted(next === 0);
  }, []);

  /** Active ou coupe le son. */
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 1;
    setMuted(video.muted);
    setVolume(video.volume);
  }, []);

  const togglePictureInPicture = useCallback(async () => {
    const video = videoRef.current as (HTMLVideoElement & {
      webkitSetPresentationMode?: (mode: "picture-in-picture" | "inline") => void;
      webkitPresentationMode?: string;
    }) | null;
    if (!video) return;

    // Safari (macOS / iPadOS) : mode présentation.
    if (typeof video.webkitSetPresentationMode === "function") {
      try {
        video.webkitSetPresentationMode(video.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture");
      } catch {
        setNotice("Le mode image dans l'image n'est pas disponible sur cet appareil.");
      }
      return;
    }
    // iPhone : pas de PiP pour un <video> non natif. On masque le bouton.
    if (!("pictureInPictureEnabled" in document) || !document.pictureInPictureEnabled || typeof video.requestPictureInPicture !== "function") {
      setNotice("Le mode image dans l'image n'est pas disponible sur cet appareil.");
      return;
    }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      setNotice("Le mode image dans l'image n'est pas disponible sur ce navigateur.");
    }
  }, []);

  /**
   * Plein écran. Sur iPhone, l'API Fullscreen n'existe pas pour un élément :
   * on passe par la vidéo native (`webkitEnterFullscreen`), qui est la seule
   * voie supportée par Safari iOS.
   */
  /**
   * Diffusion (cast). Deux chemins, car le `<video>` joue du HLS via hls.js et
   * non en natif : l'API Remote Playback du navigateur d'abord (Chrome/Edge,
   * avec le sélecteur d'appareils), sinon on signale pourquoi.
   */
  // Tout message (notice ou erreur) s'efface de lui-même au bout de 3 s.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error]);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    const video = videoRef.current as (HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
      webkitDisplayingFullscreen?: boolean;
    }) | null;

    const doc = document as Document & {
      webkitFullscreenElement?: Element;
      webkitExitFullscreen?: () => void;
    };
    const active = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
    if (active) {
      if (document.exitFullscreen) void document.exitFullscreen().catch(() => undefined);
      else doc.webkitExitFullscreen?.();
      return;
    }

    const element = shell as (HTMLDivElement & {
      webkitRequestFullscreen?: () => void;
      msRequestFullscreen?: () => void;
    }) | null;

    if (element?.requestFullscreen) {
      void element.requestFullscreen().catch(() => video?.webkitEnterFullscreen?.());
      return;
    }
    if (element?.webkitRequestFullscreen) {
      element.webkitRequestFullscreen();
      return;
    }
    if (element?.msRequestFullscreen) {
      element.msRequestFullscreen();
      return;
    }
    // Dernier recours (iPhone) : plein écran natif de la balise vidéo.
    if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
      return;
    }
    setNotice("Le plein écran n'est pas disponible sur ce navigateur.");
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, HIDE_CONTROLS_MS);
  }, []);

  useEffect(() => {
    if (!playing) setControlsVisible(true);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [playing]);

  /**
   * Raccourcis clavier du lecteur.
   *  Espace / K : lecture ou pause · F : plein écran · M : son ·
   *  ↑ ↓ : volume (±5 %) · ← → : reculer / avancer de 10 s (Maj : 30 s) ·
   *  E : panneau des épisodes · I : image dans l'image · Échap : fermer.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (/input|textarea|select/i.test(target.tagName) || target.isContentEditable)) return;
      // Une combinaison avec Ctrl/Alt/Meta reste au navigateur.
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      switch (event.key) {
        case " ":
        case "k":
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          event.preventDefault();
          seekBy(event.shiftKey ? 30 : 10);
          break;
        case "ArrowLeft":
          event.preventDefault();
          seekBy(event.shiftKey ? -30 : -10);
          break;
        case "ArrowUp":
          event.preventDefault();
          changeVolume((videoRef.current?.muted ? 0 : (videoRef.current?.volume ?? 0)) + 0.05);
          break;
        case "ArrowDown":
          event.preventDefault();
          changeVolume((videoRef.current?.muted ? 0 : (videoRef.current?.volume ?? 0)) - 0.05);
          break;
        case "m":
        case "M":
          event.preventDefault();
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "i":
          void togglePictureInPicture();
          break;
        case "e":
        case "E":
          // Ouvre ou referme le panneau des épisodes (sans effet sur un film,
          // qui n'a pas de liste d'épisodes).
          if (isMovie) break;
          event.preventDefault();
          setMenu(null);
          setEpisodePanel((open) => !open);
          break;
        case "Escape":
          setMenu(null);
          setEpisodePanel(false);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekBy, toggleFullscreen, togglePictureInPicture, changeVolume, toggleMute, isMovie]);

  /** Bascule VF ↔ VOSTFR sur le même épisode, sans recharger si la source est déjà là. */


  /**
   * Bascule VF ↔ VOSTFR : l'URL suit immédiatement la langue choisie
   * (`?lang=vf` / `?lang=vo`) sans recharger, puis on joue la source correspondante.
   * Le choix est gardé pour la suite de la série : les liens « épisode
   * suivant / précédent » réécrivent `?lang=` avec la langue réellement
   * regardée, qui prime alors sur la préférence du compte.
   */
  /**
   * Une piste dans cette langue existe-t-elle ? On regarde TOUS les flux de la
   * réponse : chez Vidzy c'est souvent le fichier « VF » qui porte aussi la
   * piste japonaise, et le fichier courant peut n'en déclarer aucune.
   */
  const audioLanguageAvailable = (code: "fr" | "ja") =>
    audioLanguageCodes.includes(code)
    || streams.some((item) => (item.tracks?.audioLanguages ?? []).includes(code));

  const toggleLanguage = () => {
    const other: AnimeLanguage = displayLanguage === "vf" ? "vostfr" : "vf";
    // Aucune source dans cette langue : on ne bascule pas, on explique
    // pourquoi (une langue absente des sources ne doit jamais être simulée).
    const hasOther = streams.some((item) => item.language === (other === "vf" ? "vf" : "vostfr"));
    if (!hasOther && !languageHrefs[other]) {
      setNotice(
        other === "vf"
          ? "Bascule en VOSTFR : aucun lien disponible en VF"
          : "Bascule en VF : aucun lien disponible en VOSTFR",
      );
      return;
    }
    // La langue reste un réglage du lecteur : rien à écrire dans l'URL.

    // Vidzy ne sépare pas toujours VF et VOSTFR : le même fichier peut porter
    // plusieurs pistes audio. Basculer la langue, c'est alors changer de piste
    // audio — et la mémoriser pour les épisodes suivants.
    const wanted = other === "vf" ? "fr" : "ja";
    if (audioLanguageAvailable(wanted)) {
      setAudioPinned(true);
      setAudioLanguage(wanted);
      setAudioTrack(audioLanguageCodes.indexOf(wanted));
      setActiveLanguage(other);
      setMenu(null);
      setNotice(other === "vf" ? "Piste française activée." : "Piste originale (sous-titres) activée.");
      return;
    }

    const target = streams.findIndex((item) => item.language === (other === "vf" ? "vf" : "vostfr"));
    if (target >= 0) {
      setIndex(target);
      setActiveLanguage(other);
      setMenu(null);
      return;
    }
    const href = languageHrefs[other];
    if (href) window.location.href = href;
  };

  /** L'autre langue est-elle disponible (source déjà chargée ou lien de la fiche) ? */
  const otherLanguage: AnimeLanguage = displayLanguage === "vf" ? "vostfr" : "vf";
  // On ne propose jamais une langue que la fiche ne possède pas : les langues
  // connues du catalogue font foi, sinon on retombe sur les flux chargés.
  const declaredLanguages = languageHrefs;
  const canSwitchLanguage = declaredLanguages[otherLanguage]
    ? true
    : streams.some((item) => item.language === (otherLanguage === "vf" ? "vf" : "vostfr"))
      // Même fichier, autre piste audio (Vidzy) : la bascule est réelle.
      || audioLanguageAvailable(otherLanguage === "vf" ? "fr" : "ja");

  /**
   * Sources de la langue regardée uniquement : VOSTFR si l'URL est en VO, VF si
   * elle est en VF. Le panneau « Source » ne propose jamais l'autre langue.
   */
  const sameLanguage = useMemo(() => {
    const counters = { vf: 0, vostfr: 0 } as Record<string, number>;
    return streams
      .filter((item) => item.language === (displayLanguage === "vf" ? "vf" : "vostfr"))
      .map((item) => {
        counters[item.language] = (counters[item.language] ?? 0) + 1;
        // Le nom du provider (Vidzy, Franime…) accompagne le numéro : on sait
        // d'où vient le flux qu'on regarde.
        const providerLabel = PROVIDER_LABELS[item.provider ?? ""] ?? null;
        const name = providerLabel
          ? `Source ${counters[item.language]} · ${providerLabel}`
          : `Source ${counters[item.language]}`;
        return { stream: item, rank: counters[item.language]!, name };
      });
  }, [streams, displayLanguage]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  /** Saison réellement jouée : celle de l'URL. Elle ne suit pas le sélecteur du volet. */
  const playingSeason = isMovie ? undefined : seasons.find((item) => item.slug === activeSeasonSlug)
    ?? seasons.find((item) => item.slug === seasonName)
    ?? seasons[0];
  /** Saison parcourue dans le volet des épisodes (choix local, sans effet sur la lecture). */
  const shownSeason = isMovie ? undefined : seasons.find((item) => item.slug === seasonSlugState) ?? playingSeason;

  // À l'ouverture du volet : on affiche la saison en cours de lecture, puis la
  // liste glisse en douceur jusqu'à l'épisode regardé.
  const episodeListRef = useRef<HTMLElement>(null);
  const openedPanelRef = useRef(false);
  useEffect(() => {
    if (!episodePanel) {
      openedPanelRef.current = false;
      return;
    }
    if (openedPanelRef.current) return;
    openedPanelRef.current = true;
    setSeasonSlugState(activeSeasonSlug);
    setSeasonMenuOpen(false);
  }, [episodePanel, activeSeasonSlug]);
  useEffect(() => {
    if (!episodePanel || shownSeason?.slug !== activeSeasonSlug) return;
    const timer = window.setTimeout(() => {
      const list = episodeListRef.current;
      const row = list?.querySelector<HTMLElement>('[aria-current="true"]');
      if (!list || !row) return;
      const top = row.offsetTop - list.offsetTop - 90;
      list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [episodePanel, shownSeason?.slug, activeSeasonSlug, episodeNumber]);
  // Titre du panneau, comme dans la maquette : « One Piece · S01 - Arc East Blue ».
  // En-tête de la maquette : « One Piece · S01 - Arc East Blue ». Le nom de
  // saison du catalogue contient déjà « S01 - … » ; on retombe sur le numéro
  // quand il s'appelle simplement « Saison 1 ».
    // Les commandes ne se masquent qu'une fois la vidéo réellement en lecture :
  // pendant un chargement, une erreur ou une pause, elles restent affichées.
  const hide = Boolean(source)
    && playing
    && controlsVisible === false
    && playerPrefs.playerAutoHide
    && !menu
    && !episodePanel;

  /** Taille des commandes choisie dans les préférences. */
  const controlsSize = playerPrefs.playerControlsSize;

  /** Options d'affichage des épisodes (mêmes réglages que la fiche). */
  const showEpisodeDetails = playerPrefs.showEpisodeDetails;
  const hideEpisodeImages = playerPrefs.hideEpisodeImages;

  return (
    <div
      ref={shellRef}
      className={cn("fixed inset-0 overflow-hidden bg-black", hide && "cursor-none")}
      onMouseMove={revealControls}
      onMouseLeave={() => playing && setControlsVisible(false)}
    >
      {/* Image */}
      <video
        ref={videoRef}
        // `captions` garde les sous-titres visibles en plein écran et en
        // lecture native, sans dépendre du menu du navigateur.
        controlsList="nodownload"
        playsInline
        preload="metadata"
        // `pb-[76px]` : le sous-titre remonte au-dessus de la barre de lecture,
        // sinon les répliques sont collées au bord et recouvertes.
        className="absolute inset-0 h-full w-full bg-black object-contain pb-[76px]"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
      />

      {/* Voile de lisibilité des contrôles */}
      <div
        className={cn("pointer-events-none absolute inset-0 transition-opacity duration-200", hide ? "opacity-0" : "opacity-100")}
        style={{
          background:
            "linear-gradient(to bottom, rgba(10,10,12,.92) 0%, rgba(10,10,12,.55) 12%, rgba(10,10,12,0) 26%, rgba(10,10,12,0) 55%, rgba(10,10,12,.82) 78%, rgba(10,10,12,.99) 100%)",
        }}
      />

      {/* Sous-titres : calque maison, texte blanc contouré noir, lisible sur
          n'importe quelle image, au-dessus de la barre de lecture. */}
      {subtitlesOn && cueText && (
        <div
          data-subtitle-overlay="1"
          className="pointer-events-none absolute inset-x-0 bottom-[86px] z-20 flex justify-center px-10"
        >
          <span
            data-subtitle-line="1"
            className="max-w-[85%] whitespace-pre-line text-center text-[clamp(18px,2.2vw,32px)] font-bold leading-snug text-white"
            style={{
              // Liseré noir de 2 px : le texte reste lisible sur une image
              // claire comme sur une image sombre. Une simple ombre portée
              // devient invisible sur les cartons de titre clairs.
              WebkitTextStroke: "2px #000",
              paintOrder: "stroke fill",
              textShadow: "0 3px 12px rgba(0,0,0,.85)",
            }}
          >
            {cueText}
          </span>
        </div>
      )}

      {buffering && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="h-12 w-12 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        </div>
      )}

      {/* Chargement / absence de sources */}
      {/* Recherche des sources : une simple roue, centrée, sans texte */}
      {!source && status === "loading" && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <span
            role="status"
            aria-label="Recherche des sources"
            className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/25 border-t-white/90"
          />
        </div>
      )}

      {/* Aucune source : un texte discret avec une petite icône, sans panneau */}
      {!source && (status === "error" || status === "empty") && (
        <div className="absolute inset-0 z-10 grid place-items-center px-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="flex items-center gap-2 text-[14px] font-medium text-white/85">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current text-red-400" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5.5M12 16.4v.2" />
              </svg>
              {status === "error" ? "Sources indisponibles" : isMovie ? "Aucune source pour ce film" : "Aucune source pour cet épisode"}
            </p>
            <button
              type="button"
              onClick={() => setAttempt((current) => current + 1)}
              className="text-[12px] font-semibold text-white/55 underline underline-offset-4 transition hover:text-white"
            >
              Réessayer
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------- barre haute : retour / titre centré */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/80 to-transparent pb-12 transition-opacity duration-200",
          hide ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        <div className="relative flex items-start justify-between px-3 pt-3 sm:px-4 sm:pt-4">
          <button
            type="button"
            onClick={() => { window.location.href = detailHref(animeId); }}
            aria-label="Retour"
            title="Retour"
            className="grid h-9 w-9 place-items-center text-white transition hover:text-white/70"
          >
            <img src="/player-icons/retour.svg" alt="" draggable={false} className="h-10 w-10" />
          </button>

          {/* Titre centré sur la largeur, indépendant des boutons. */}
          <div className="pointer-events-none absolute inset-x-14 top-2.5 text-center sm:inset-x-24 sm:top-3.5">
            <p style={{ fontFamily: PLAYER_FONT }} className="truncate text-[16px] font-semibold leading-[1.5] text-white sm:text-[21px]">
              {title}
              {!isMovie && playingSeason ? ` · ${playingSeason.name}` : ""}
            </p>
            {/* Un film n'a ni saison ni épisode : la ligne d'épisode disparaît. */}
            {!isMovie && (
              <p style={{ fontFamily: PLAYER_FONT }} className="truncate text-[12px] font-light leading-[1.5] text-white sm:text-[16px]">
                Ép. {episodeNumber}
                {showEpisodeDetails && episodeTitle ? ` · ${episodeTitle}` : ""}
              </p>
            )}
          </div>

        </div>
      </div>

      {/* ------------------------------------- centre : −10 s / lecture / +10 s */}
      {source && (
      <div className={cn("pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-200", hide ? "opacity-0" : "opacity-100")}>
        <div className="pointer-events-auto flex items-center gap-8 sm:gap-[60px]">
          <RoundButton label="Reculer de 10 secondes" onClick={() => seekBy(-10)} size="lg">
            <img src="/player-icons/reculer-10.svg" alt="" draggable={false} className="h-8 w-8" />
          </RoundButton>

          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Lecture"}
            title={playing ? "Pause" : "Lecture"}
            className="grid h-16 w-16 place-items-center rounded-full bg-black/50 text-white shadow-[0_0_4px_rgba(0,0,0,0.4)] transition hover:bg-black/60 active:scale-95 sm:h-20 sm:w-20"
          >
            {playing
              ? <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current"><path d="M7 5h3.6v14H7zm6.4 0H17v14h-3.6z" /></svg>
              : <img src="/player-icons/lecture-grand.svg" alt="" draggable={false} className="h-8 w-8" />}
          </button>

          <RoundButton label="Avancer de 10 secondes" onClick={() => seekBy(10)} size="lg">
            <img src="/player-icons/avancer-10.svg" alt="" draggable={false} className="h-8 w-8" />
          </RoundButton>
        </div>
      </div>

      )}

      {(notice || error) && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-40 flex justify-center px-4">
          <p className="max-w-[90vw] rounded-full bg-black/75 px-3.5 py-1.5 text-center text-[12px] font-medium text-white/85 backdrop-blur-sm">
            {notice ?? error}
          </p>
        </div>
      )}

      {/* -------------------------------------------------- barre de contrôle */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/85 via-black/45 to-transparent pt-10 transition-opacity duration-200",
          hide ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        {/* progression (Figma) : temps au-dessus, piste 8 px pleine largeur */}
        <div className="px-5" style={{ fontFamily: PLAYER_FONT }}>
          <div className="flex items-center justify-between text-[13px] font-normal text-white sm:text-[16px]">
            <span className="tabular-nums">{formatTime(currentTime)}</span>
            <span className="tabular-nums">{formatTime(duration)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            aria-label="Progression"
            onChange={(event) => {
              const video = videoRef.current;
              if (video) video.currentTime = Number(event.target.value);
            }}
            style={{ ["--played" as string]: `${progressPercent}%` }}
            className="player-progress mt-0.5"
          />
        </div>

        {/* rangée de commandes : plus aérée sur mobile (cibles tactiles) */}
        <div className="mt-1 flex items-center justify-between px-5 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center gap-4 sm:gap-6">
            <button
              type="button"
              onClick={() => { if (previousHref) window.location.href = withLanguage(previousHref); }}
              disabled={!previousHref}
              aria-label="Épisode précédent"
              title="Épisode précédent"
              className="grid h-6 w-6 place-items-center text-white transition hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <img src="/player-icons/precedent.svg" alt="" draggable={false} className="h-6 w-6" />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Lecture"}
              title={playing ? "Pause" : "Lecture"}
              className="grid h-6 w-6 place-items-center text-white transition hover:text-white/70"
            >
              {playing
                ? <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M7 5h3.4v14H7zm6.6 0H17v14h-3.4z" /></svg>
                : <img src="/player-icons/lecture.svg" alt="" draggable={false} className="h-6 w-6" />}
            </button>

            <button
              type="button"
              onClick={() => { if (nextHref) window.location.href = withLanguage(nextHref); }}
              disabled={!nextHref}
              aria-label="Épisode suivant"
              title="Épisode suivant"
              className="grid h-6 w-6 place-items-center text-white transition hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <img src="/player-icons/suivant.svg" alt="" draggable={false} className="h-6 w-6" />
            </button>

            {/* Son : un clic coupe ou rétablit, la jauge s'ouvre au survol, à côté. */}
            <div className="group/son relative flex items-center gap-2">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? "Activer le son" : "Couper le son"}
                title={muted ? "Activer le son" : "Couper le son"}
                className="grid h-6 w-6 place-items-center text-white transition hover:text-white/70"
              >
                {muted || volume === 0
                  ? <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7 2.7-1.4 1.4L15.2 13l-2.7 2.7-1.4-1.4L13.8 12l-2.7-2.7 1.4-1.4L15.2 10.6l2.7-2.7 1.4 1.4z" /></svg>
                  : <img src="/player-icons/son.svg" alt="" draggable={false} className="h-6 w-6" />}
              </button>
              <div className="pointer-events-none absolute bottom-1/2 left-full z-40 flex w-36 translate-y-1/2 items-center gap-2 rounded-lg bg-[#1b1b1f]/95 px-2.5 py-2 opacity-0 shadow-xl transition group-hover/son:pointer-events-auto group-hover/son:opacity-100 group-focus-within/son:pointer-events-auto group-focus-within/son:opacity-100">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round((muted ? 0 : volume) * 100)}
                  onChange={(event) => changeVolume(Number(event.target.value) / 100)}
                  aria-label="Volume"
                  style={{ ["--level" as string]: `${Math.round((muted ? 0 : volume) * 100)}%` }}
                  className="player-volume"
                />
                <span className="w-8 shrink-0 text-right text-[10px] font-bold tabular-nums text-white/80">
                  {Math.round((muted ? 0 : volume) * 100)} %
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            {!isMovie && (
              <button
                type="button"
                onClick={() => setEpisodePanel((open) => !open)}
                aria-label="Liste des épisodes"
                title="Liste des épisodes"
                className={cn("grid h-6 w-6 place-items-center text-white transition hover:text-white/70", episodePanel && "text-brand-2")}
              >
                <img src="/player-icons/episodes.svg" alt="" draggable={false} className="h-6 w-6" />
              </button>
            )}




            <div className="relative">
              <button
                type="button"
                onClick={() => setMenu((value) => (value ? null : "settings"))}
                aria-label="Paramètres"
                title="Paramètres"
                className="grid h-6 w-6 place-items-center text-white transition hover:text-white/70"
              >
                <img src="/player-icons/parametres.svg" alt="" draggable={false} className="h-6 w-6" />
              </button>
              {menu === "settings" && (
                <div className="absolute bottom-full right-0 z-50 mb-2 w-64 rounded-xl border border-white/10 bg-[#1b1b1f] p-3 text-xs shadow-2xl">
                  {/* Piste audio en tête : c'est le premier réglage cherché, et il
                      est relié à la préférence du compte (choix retenu). */}
                  {audioOptions.length > 1 && new Set(audioOptions).size > 1 && (
                    <div className="mb-3">
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Source audio</p>
                      <div className="space-y-1">
                        {audioOptions.map((label, position) => {
                          // Tant que le manifeste n'a rien publié, on montre la
                          // piste qui correspond à la langue demandée plutôt
                          // que la première de la liste (le japonais).
                          const active = (wantedAudioIndex
                            ?? Math.max(0, audioLanguageCodes.findIndex((code) => code.slice(0, 2) === (requestedLanguage === "vf" ? "fr" : "ja")))) === position;
                          return (
                            <button
                              key={`${label}-${position}`}
                              type="button"
                              onClick={() => {
                                setAudioTrack(position);
                                setAudioPinned(true);
                                const code = audioLanguageCodes[position];
                                if (code) setAudioLanguage(code);
                                // Même réglage que dans les préférences du compte.
                                void updatePreferences({
                                  preferredLanguage: audioLanguageCodes[position] === "ja" ? "vostfr" : "vf",
                                });
                              }}
                              aria-pressed={active}
                              className={cn(
                                "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left font-bold transition",
                                active ? "bg-[#41009a] text-white" : "bg-white/10 text-white/80 hover:bg-white/20",
                              )}
                            >
                              <span className="truncate">{label}</span>
                              {active && (
                                <svg viewBox="0 0 24 24" className="ml-2 h-3.5 w-3.5 shrink-0 fill-current">
                                  <path d="M9.6 17.4 4.2 12l1.4-1.4 4 4 8-8L19 8z" />
                                </svg>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* « Langue » ne sert que s'il n'y a rien à choisir : avec
                      plusieurs pistes, c'est « Source audio » qui commande. */}
                  {!(audioOptions.length > 1 && new Set(audioOptions).size > 1) && (
                  <div className="mb-3">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Langue</p>
                    <button
                      type="button"
                      onClick={toggleLanguage}
                      disabled={!canSwitchLanguage}
                      title={canSwitchLanguage ? undefined : `Aucune source en ${LANGUAGE_LABELS[otherLanguage]}`}
                      className="flex w-full items-center justify-between rounded-md bg-white/10 px-2.5 py-1.5 font-bold text-white transition hover:bg-white/20 disabled:opacity-40"
                    >
                      <span>{LANGUAGE_LABELS[displayLanguage]}</span>
                      <span className="text-[10px] font-semibold text-white/50">
                        {canSwitchLanguage ? `passer en ${LANGUAGE_LABELS[otherLanguage]}` : "indisponible"}
                      </span>
                    </button>
                  </div>
                  )}
                  {subtitleOptions.length > 0 && (
                    <div className="mt-3 border-t border-white/10 pt-2.5">
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Sous-titres</p>
                      <div className="space-y-1">
                        {[{ language: "off", label: "Désactivés" }, ...subtitleOptions].map((option) => {
                          // Le provider publie deux pistes françaises (« Français
                          // complet » et « Français ») : la langue seule ne suffit
                          // pas à dire laquelle est cochée, on compare le libellé.
                          const active = option.language === "off"
                            ? !subtitlesOn
                            : subtitlesOn && subtitleLang === option.language
                              && subtitleLabel === option.label;
                          return (
                            <button
                              key={`${option.language}-${option.label}`}
                              type="button"
                              onClick={() => {
                                // « Désactivés » coupe l'affichage sans perdre la
                                // langue retenue ; choisir une langue les rallume.
                                if (option.language === "off") {
                                  subsLockedRef.current = true;
                                  setSubtitlesOn(false);
                                  void updatePreferences({ subtitlesAuto: false });
                                  return;
                                }
                                setSubtitleLang(option.language);
                                setSubtitleLabel(option.label);
                                subsLockedRef.current = true;
                                setSubtitlesOn(true);
                                // Même réglage que dans les préférences du compte.
                                void updatePreferences({ subtitlesAuto: true, subtitleLanguage: option.language });
                              }}
                              aria-pressed={active}
                              className={cn(
                                "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left font-bold transition",
                                active ? "bg-[#41009a] text-white" : "bg-white/10 text-white/80 hover:bg-white/20",
                              )}
                            >
                              <span className="truncate">{option.label}</span>
                              {active && (
                                <svg viewBox="0 0 24 24" className="ml-2 h-3.5 w-3.5 shrink-0 fill-current">
                                  <path d="M9.6 17.4 4.2 12l1.4-1.4 4 4 8-8L19 8z" />
                                </svg>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="mt-3 border-t border-white/10 pt-2.5">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Vitesse</p>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => changeSpeed(Math.max(0.5, Math.round((speed - 0.25) * 100) / 100))}
                        aria-label="Ralentir"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/10 text-white/80 transition hover:bg-white/20"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z" /></svg>
                      </button>
                      <div className="min-w-0 flex-1 rounded-md bg-white/10 px-2 py-1.5 text-center text-[12px] font-bold text-white">
                        {String(speed).replace(".", ",")}×
                      </div>
                      <button
                        type="button"
                        onClick={() => changeSpeed(Math.min(2, Math.round((speed + 0.25) * 100) / 100))}
                        aria-label="Accélérer"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/10 text-white/80 transition hover:bg-white/20"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M8.6 7.4 10 6l6 6-6 6-1.4-1.4L13.2 12z" /></svg>
                      </button>
                    </div>
                  </div>
                  {user && (
                    <div className="mt-3 border-t border-white/10 pt-2.5">
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Lecture</p>
                      <div className="space-y-1">
                        {([
                          { key: "autoplay", label: "Démarrer la vidéo à l’ouverture", value: autoplayOn },
                          { key: "autonext", label: "Passer à l’épisode suivant", value: autoNextOn },
                          { key: "muted", label: "Démarrer sans son", value: startMutedOn },
                        ] as const).map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => {
                              const next = !option.value;
                              if (option.key === "autoplay") {
                                setAutoplayOn(next);
                                void persistPreference({ playerAutoplay: next });
                              } else if (option.key === "autonext") {
                                setAutoNextOn(next);
                                void persistPreference({ playerAutoNext: next });
                              } else {
                                setStartMutedOn(next);
                                void persistPreference({ playerStartMuted: next });
                              }
                            }}
                            role="switch"
                            aria-checked={option.value}
                            className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left transition hover:bg-white/[0.06]"
                          >
                            <span className="text-[11px] font-medium text-white/85">{option.label}</span>
                            <span className={cn("relative h-4 w-7 shrink-0 rounded-full transition", option.value ? "bg-brand" : "bg-white/20")}>
                              <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all", option.value ? "left-3.5" : "left-0.5")} />
                            </span>
                          </button>
                        ))}
                      </div>
                      {saveState !== "idle" && (
                        <p className="mt-1 px-1.5 text-[10px] text-white/40">
                          {saveState === "saving" ? "Enregistrement…" : "Enregistré"}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

            </div>

            <button
              type="button"
              onClick={() => void togglePictureInPicture()}
              aria-label="Image dans l'image"
              title="Image dans l'image"
              className="grid h-6 w-6 place-items-center text-white transition hover:text-white/70"
            >
              <img src="/player-icons/pip.svg" alt="" draggable={false} className="h-6 w-6" />
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="Plein écran"
              title="Plein écran"
              className="grid h-6 w-6 place-items-center text-white transition hover:text-white/70"
            >
              <img src="/player-icons/plein-ecran.svg" alt="" draggable={false} className="h-6 w-6" />
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------- volet latéral des épisodes */}
      {episodePanel && (
        <>
          {/* Fond assombri : un clic ferme le volet */}
          <button
            type="button"
            aria-label="Fermer la liste des épisodes"
            onClick={() => setEpisodePanel(false)}
            className="absolute inset-0 z-[55] cursor-default bg-black/[0.62]"
          />
          {/* Colonne de la maquette Figma (167:328) : aucun fond propre, le
              décor est la vidéo assombrie. Elle s'arrête au-dessus de la barre
              de contrôle (bottom-[150px]) pour ne jamais la recouvrir. */}
          <aside
            ref={episodeListRef}
            style={{ fontFamily: PLAYER_FONT }}
            className="no-scrollbar absolute right-0 top-0 z-[60] flex w-[min(365px,100%)] flex-col overflow-y-auto bottom-[150px]"
          >
            {/* En-tête : sélecteur de saison 316×42, croix de fermeture à droite */}
            <div className="relative mt-[28px] shrink-0">
              <button
                type="button"
                onClick={() => setEpisodePanel(false)}
                aria-label="Fermer la liste des épisodes"
                className="absolute right-[10px] top-[5px] grid h-8 w-8 place-items-center text-white transition hover:text-white/70"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-7 w-7" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>

              {!isMovie && seasons.length > 1 && (
                <div className="relative mt-0 w-[316px] max-w-[calc(100%-48px)]">
                  <button
                    type="button"
                    aria-label="Choisir une saison"
                    aria-haspopup="listbox"
                    aria-expanded={seasonMenuOpen}
                    onClick={() => setSeasonMenuOpen((open) => !open)}
                    className="relative flex h-[42px] w-full items-center justify-center rounded-lg border border-[#36303f] bg-[#221d30] px-11 text-[14px] font-semibold text-white transition hover:border-white/30"
                  >
                    <span className="truncate">{shownSeason?.name ?? seasonName}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={cn("absolute right-3 top-1/2 h-6 w-6 -translate-y-1/2 transition-transform", seasonMenuOpen && "rotate-180")} aria-hidden="true">
                      <path d="m7 10 5 5 5-5" />
                    </svg>
                  </button>
                  {seasonMenuOpen && (
                    <div role="listbox" aria-label="Saisons" className="no-scrollbar absolute inset-x-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-lg border border-[#36303f] bg-[#221d30] p-1.5 shadow-[0_18px_45px_-15px_rgba(0,0,0,.9)]">
                      {seasons.map((item) => {
                        const selected = item.slug === (shownSeason?.slug ?? seasonSlugState);
                        return (
                          <button
                            key={item.slug}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              setSeasonSlugState(item.slug);
                              setSeasonMenuOpen(false);
                            }}
                            className={cn(
                              "flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-[13.5px] font-medium transition",
                              selected ? "bg-white/[0.10] text-white" : "text-white/70 hover:bg-white/[0.06] hover:text-white",
                            )}
                          >
                            <span className="truncate">{item.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Liste : une ligne par épisode, 150 px de haut */}
            <div className="mt-3 pb-6">
              {(shownSeason?.episodes ?? episodes).map((item) => {
                const active = shownSeason?.slug === activeSeasonSlug && item.number === episodeNumber;
                const number = item.absolute ?? item.number;
                const seen =
                  progressSeason !== null &&
                  progressEpisode !== null &&
                  shownSeason?.slug === progressSeason &&
                  item.number < progressEpisode;
                const started =
                  progressSeason === shownSeason?.slug && progressEpisode === item.number;
                const percent = started ? watchedPercent ?? 100 : seen ? 100 : null;
                const remaining = started ? remainingMinutes : null;
                return (
                  <Link
                    key={`${shownSeason?.slug}-${item.number}`}
                    href={withLanguage(item.href)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "group mb-[12px] block w-[277px] max-w-[calc(100%-23px)] pl-0 ml-[23px] transition",
                      active && "[&>span:first-child]:ring-2 [&>span:first-child]:ring-brand",
                    )}
                  >
                    {/* Vignette 277×116 avec fondu vers le bas */}
                    <span className="relative block h-[116px] w-full overflow-hidden rounded-lg bg-white/[0.05]">
                      {item.still ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.still}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className={cn(
                            "h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]",
                            hideEpisodeImages && "scale-110 blur-xl",
                          )}
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-[28px] font-semibold text-white/20">
                          {String(number).padStart(2, "0")}
                        </span>
                      )}
                      <span className="pointer-events-none absolute inset-0 rounded-lg bg-[linear-gradient(180deg,rgba(9,5,17,0)_0%,rgba(9,5,17,0.05)_50%,rgba(9,5,17,0.95)_100%)]" />

                      {/* Bouton lecture 30 px, ou coche sur un épisode vu */}
                      <span
                        className={cn(
                          "absolute bottom-[17px] left-[8px] grid h-[30px] w-[30px] place-items-center rounded-full shadow-[0_0_4px_0_rgba(0,0,0,0.4)]",
                          seen ? "bg-brand text-white" : "bg-white text-brand",
                        )}
                      >
                        {seen ? (
                          <CheckIcon className="h-4 w-4" />
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-[13px] w-[13px] fill-current" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                        )}
                      </span>

                      {/* « Il reste X min » à droite du bouton */}
                      {remaining !== null && (
                        <span className="absolute bottom-[24px] left-[45px] text-[12px] font-medium leading-[14.5px] text-white">
                          Il reste {remaining} min
                        </span>
                      )}

                      {/* Piste de progression 3 px */}
                      {percent !== null && (
                        <span className="absolute inset-x-[8px] bottom-[11px] h-[3px] rounded-sm bg-[#544d60]">
                          <span className="block h-full rounded-sm bg-brand" style={{ width: `${percent}%` }} />
                        </span>
                      )}
                    </span>

                    {/* Libellé sous la vignette */}
                    <span className="mt-[8px] block truncate text-[16px] font-semibold leading-[19.4px] text-white [text-shadow:-1px_0_#000,1px_0_#000,0_-1px_#000,0_1px_#000]">
                      Ép. {number}
                      {showEpisodeDetails && item.title ? ` · ${item.title}` : ""}
                    </span>
                  </Link>
                );
              })}
              {(shownSeason?.episodes ?? episodes).length === 0 && (
                <p className="px-3 py-8 text-center text-[12px] text-white/40">Aucun épisode dans cette saison.</p>
              )}
            </div>
          </aside>
        </>
      )}

    </div>
  );
}

/** Bouton rond translucide (façon lecteur Celix). */
const PLAYER_FONT = 'Poppins, "Helvetica Neue", Arial, sans-serif';

function RoundButton({
  label,
  onClick,
  children,
  size = "sm",
  disabled = false,
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  active?: boolean;
}) {
  const dimensions = size === "lg" ? "h-12 w-12 sm:h-[60px] sm:w-[60px]" : size === "md" ? "h-12 w-12" : "h-8 w-8";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-black/50 text-white shadow-[0_0_4px_rgba(0,0,0,0.4)] transition hover:bg-black/60 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30",
        dimensions,
        active && "bg-black/70 text-white",
      )}
    >
      {children}
    </button>
  );
}

function IconButton({
  label,
  onClick,
  children,
  disabled = false,
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-md text-white/85 transition hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-35",
        active && "bg-white/15 text-white",
      )}
    >
      {children}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-md px-2 py-1 font-bold transition", active ? "bg-brand text-white" : "bg-white/10 text-white/75 hover:bg-white/20")}
    >
      {children}
    </button>
  );
}
