"use client";

/**
 * Lecteur maison plein écran.
 *
 * Reprend la grammaire des grands lecteurs de streaming (image seule sur fond
 * noir, contrôles superposés) : retour/fermer en haut à gauche, titre au
 * centre, avance/retour 10 s autour du bouton lecture, barre de progression
 * pleine largeur, actions secondaires alignées au centre en bas.
 *
 * HLS via hls.js quand le navigateur ne lit pas nativement le m3u8.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Hls from "hls.js";
import { cn } from "@/lib/utils";

export type PlayerSource = {
  /** URL à lire (déjà passée par /api/proxy). */
  url: string;
  type: "hls" | "mp4" | "dash";
  /** Résolutions connues du master HLS. */
  qualities: string[];
};

export type PlayerAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  icon: "episodes" | "audio" | "next";
};

type Props = {
  source: PlayerSource | null;
  poster?: string | null;
  /** Ligne de titre au centre du haut, ex. `S1:E2 « Le grand départ »`. */
  heading?: string;
  autoPlay?: boolean;
  startAt?: number;
  onProgress?: (position: number, duration: number) => void;
  onEnded?: () => void;
  onError?: () => void;
  actions?: PlayerAction[];
  /** Lien du bouton de fermeture (haut droite). */
  closeHref: string;
  className?: string;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HIDE_CONTROLS_MS = 3_200;

/** `1:05:32` ou `57:09` selon la durée. */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

type HlsState = {
  levels: Array<{ height: number; index: number }>;
  current: number;
  auto: boolean;
};

const ACTION_ICONS: Record<PlayerAction["icon"], React.ReactNode> = {
  episodes: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
      <path d="M3 5h13v11H3z" opacity=".55" />
      <path d="M7 8h13v11H7z" />
      <path d="M10.5 11.2v4.6l3.8-2.3z" fill="#000" />
    </svg>
  ),
  audio: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
      <path d="M2.5 8.5h3.2L10 5v14l-4.3-3.5H2.5z" />
      <path d="M13 8.2a5 5 0 0 1 0 7.6v-2.1a3 3 0 0 0 0-3.4z" opacity=".7" />
      <path d="M15.8 5.6a8.5 8.5 0 0 1 0 12.8v-2.2a6 6 0 0 0 0-8.4z" opacity=".45" />
    </svg>
  ),
  next: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
      <path d="M7 5l9 7-9 7z" />
      <path d="M17 5h2v14h-2z" />
    </svg>
  ),
};

export function VideoPlayer({
  source,
  poster = null,
  heading,
  autoPlay = false,
  startAt = 0,
  onProgress,
  onEnded,
  onError,
  actions = [],
  closeHref,
  className,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeApplied = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menu, setMenu] = useState<"speed" | "quality" | "audio" | null>(null);
  const [hlsState, setHlsState] = useState<HlsState>({ levels: [], current: -1, auto: true });
  const [error, setError] = useState<string | null>(null);

  const isHls = source ? source.type === "hls" || /\.m3u8(?:[?#]|$)/i.test(source.url) : false;

  /* ----------------------------- mise en place ---------------------------- */

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return;
    let destroyed = false;
    setError(null);
    setBuffering(true);
    resumeApplied.current = false;

    const nativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "";

    if (isHls && !nativeHls) {
      import("hls.js")
        .then(({ default: HlsLib }) => {
          if (destroyed) return;
          if (!HlsLib.isSupported()) {
            setError("Ce navigateur ne peut pas lire ce flux.");
            return;
          }
          const hls = new HlsLib({ enableWorker: true, lowLatencyMode: false, backBufferLength: 90 });
          hlsRef.current = hls;
          hls.loadSource(source.url);
          hls.attachMedia(video);

          hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
            const levels = (hls.levels ?? [])
              .map((level, index) => ({ height: level.height, index }))
              .filter((level) => Number.isFinite(level.height) && level.height > 0)
              .sort((a, b) => b.height - a.height);
            setHlsState({ levels, current: -1, auto: true });
            if (autoPlay) video.play().catch(() => undefined);
          });
          hls.on(HlsLib.Events.LEVEL_SWITCHED, (_event, data) => {
            setHlsState((state) => ({ ...state, current: data.level }));
          });
          hls.on(HlsLib.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
              return;
            }
            setError("Le flux s'est interrompu.");
            onError?.();
          });
        })
        .catch(() => setError("Lecteur HLS indisponible."));
      return () => {
        destroyed = true;
        hlsRef.current?.destroy();
        hlsRef.current = null;
      };
    }

    video.src = source.url;
    setHlsState({ levels: [], current: -1, auto: true });
    if (autoPlay) video.play().catch(() => undefined);
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }, [source?.url, source?.type, isHls, autoPlay, onError]);

  /* -------------------------- événements <video> -------------------------- */

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoaded = () => {
      setDuration(video.duration || 0);
      setBuffering(false);
      // Reprise : on se place une seule fois, sur une durée connue.
      if (!resumeApplied.current && startAt > 0 && Number.isFinite(video.duration) && startAt < video.duration - 10) {
        video.currentTime = startAt;
        resumeApplied.current = true;
      }
    };
    const onTime = () => {
      setCurrentTime(video.currentTime);
      onProgress?.(video.currentTime, video.duration || 0);
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
      setError("Lecture impossible.");
      onError?.();
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("error", onErrorEvent);
    video.addEventListener("ended", () => onEnded?.());
    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("error", onErrorEvent);
    };
  }, [onProgress, onEnded, onError, startAt]);

  /* ------------------------------ commandes ------------------------------ */

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

  const changeVolume = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, video.volume + delta));
    if (video.volume > 0) video.muted = false;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else shell.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Raccourcis clavier (ignorés dans un champ de saisie).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
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
          changeVolume(0.05);
          break;
        case "ArrowDown":
          event.preventDefault();
          changeVolume(-0.05);
          break;
        case "m":
          if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
          break;
        case "f":
          toggleFullscreen();
          break;
        case "Escape":
          setMenu(null);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekBy, changeVolume, toggleFullscreen]);

  // Masquage automatique des contrôles pendant la lecture.
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

  const setQuality = useCallback((levelIndex: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    if (levelIndex < 0) {
      hls.currentLevel = -1;
      setHlsState((state) => ({ ...state, auto: true }));
    } else {
      hls.currentLevel = levelIndex;
      setHlsState((state) => ({ ...state, auto: false, current: levelIndex }));
    }
    setMenu(null);
  }, []);

  const qualityLabel = useMemo(() => {
    if (hlsState.levels.length === 0) return "HD";
    if (hlsState.auto) return "Auto";
    const level = hlsState.levels.find((entry) => entry.index === hlsState.current);
    return level ? `${level.height}p` : "Auto";
  }, [hlsState]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={shellRef}
      className={cn(
        "relative h-dvh w-full select-none overflow-hidden bg-black",
        controlsVisible ? "cursor-default" : "cursor-none",
        className,
      )}
      onMouseMove={revealControls}
      onMouseLeave={() => playing && setControlsVisible(false)}
    >
      <video
        ref={videoRef}
        poster={poster ?? undefined}
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full bg-black object-contain"
        onClick={togglePlay}
      />

      {/* Voile : lisibilité des contrôles sur les images claires */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-200",
          controlsVisible ? "opacity-100" : "opacity-0",
        )}
        style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,.18) 0%, rgba(0,0,0,.62) 100%)" }}
      />

      {buffering && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="h-11 w-11 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        </div>
      )}

      {/* ---------------------------------------------------------- barre haute */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 flex items-center justify-between gap-4 px-5 pt-5 transition-opacity duration-200 sm:px-9 sm:pt-7",
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => { if (window.history.length > 1) window.history.back(); else window.location.href = closeHref; }}
            aria-label="Retour"
            title="Retour"
            className="grid h-10 w-10 place-items-center rounded-full text-white/90 transition hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z" /></svg>
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Quitter le plein écran" : "Plein écran"}
            title="Plein écran (f)"
            className="grid h-10 w-10 place-items-center rounded-full text-white/90 transition hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
          </button>
        </div>

        {heading && (
          <p className="pointer-events-none min-w-0 flex-1 truncate text-center text-[13px] font-semibold text-white/85 sm:text-[15px]">
            {heading}
          </p>
        )}

        <Link
          href={closeHref}
          aria-label="Fermer le lecteur"
          title="Fermer"
          className="grid h-10 w-10 place-items-center rounded-full text-white/90 transition hover:bg-white/10 hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4z" /><path d="M19 6.4 6.4 19 5 17.6 17.6 5z" /></svg>
        </Link>
      </div>

      {/* -------------------------------------------------- zone centrale */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center gap-10 transition-opacity duration-200 sm:gap-24",
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <button
          type="button"
          onClick={() => seekBy(-10)}
          aria-label="Reculer de 10 secondes"
          className="group relative grid h-16 w-16 place-items-center rounded-full text-white/90 transition hover:text-white sm:h-20 sm:w-20"
        >
          <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full stroke-current" fill="none" strokeWidth="1.6">
            <circle cx="24" cy="24" r="22" />
          </svg>
          <span className="flex flex-col items-center leading-none">
            <svg viewBox="0 0 24 24" className="mb-0.5 h-3.5 w-3.5 fill-current"><path d="M11 5V1L6 6l5 5V7a6 6 0 1 1-6 6H3a8 8 0 1 0 8-8z" /></svg>
            <span className="text-[13px] font-bold sm:text-sm">10</span>
          </span>
        </button>

        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Lecture"}
          className="grid h-16 w-16 place-items-center text-white transition hover:scale-105 sm:h-20 sm:w-20"
        >
          {playing
            ? <svg viewBox="0 0 24 24" className="h-12 w-12 fill-current sm:h-16 sm:w-16"><path d="M7 5h3.5v14H7zm6.5 0H17v14h-3.5z" /></svg>
            : <svg viewBox="0 0 24 24" className="h-14 w-14 fill-current sm:h-[72px] sm:w-[72px]"><path d="M8 4.5v15l13-7.5z" /></svg>}
        </button>

        <button
          type="button"
          onClick={() => seekBy(10)}
          aria-label="Avancer de 10 secondes"
          className="group relative grid h-16 w-16 place-items-center rounded-full text-white/90 transition hover:text-white sm:h-20 sm:w-20"
        >
          <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full stroke-current" fill="none" strokeWidth="1.6">
            <circle cx="24" cy="24" r="22" />
          </svg>
          <span className="flex flex-col items-center leading-none">
            <svg viewBox="0 0 24 24" className="mb-0.5 h-3.5 w-3.5 rotate-180 fill-current"><path d="M11 5V1L6 6l5 5V7a6 6 0 1 1-6 6H3a8 8 0 1 0 8-8z" /></svg>
            <span className="text-[13px] font-bold sm:text-sm">10</span>
          </span>
        </button>
      </div>

      {error && (
        <div className="absolute inset-x-0 bottom-40 flex justify-center px-4">
          <p className="rounded-lg bg-black/85 px-3 py-2 text-center text-xs text-amber-200">{error}</p>
        </div>
      )}

      {/* ------------------------------------------------- barre de progression */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 px-5 pb-4 transition-opacity duration-200 sm:px-9 sm:pb-6",
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
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
              style={{ ["--played" as string]: `${progress}%` }}
              className="player-range player-range--big h-6 w-full cursor-pointer appearance-none bg-transparent"
            />
          </div>
          <span className="shrink-0 font-mono text-[13px] tabular-nums text-white/85 sm:text-sm">
            {formatTime(duration)}
          </span>
        </div>

        {/* Actions secondaires, alignées au centre */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[12px] font-semibold text-white/85 sm:mt-4 sm:gap-x-9 sm:text-[13px]">
          {actions.map((action) => {
            const content = (
              <>
                <span className="text-white/85">{ACTION_ICONS[action.icon]}</span>
                {action.label}
              </>
            );
            return action.href ? (
              <Link key={action.label} href={action.href} className="inline-flex items-center gap-2 transition hover:text-white">
                {content}
              </Link>
            ) : (
              <button key={action.label} type="button" onClick={action.onClick} className="inline-flex items-center gap-2 transition hover:text-white">
                {content}
              </button>
            );
          })}

          {/* Vitesse */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((value) => (value === "speed" ? null : "speed"))}
              className="inline-flex items-center gap-2 transition hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current"><path d="M12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-6-6V4z" /><path d="M12.7 11.3 17 7l-1.4-1.4-4.3 4.3z" /></svg>
              {speed}×
            </button>
            {menu === "speed" && (
              <div className="absolute bottom-full left-1/2 z-50 mb-3 w-24 -translate-x-1/2 rounded-xl border border-white/10 bg-black/90 p-1.5 backdrop-blur">
                {SPEEDS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      if (videoRef.current) videoRef.current.playbackRate = value;
                      setSpeed(value);
                      setMenu(null);
                    }}
                    className={cn("block w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] font-semibold transition", value === speed ? "bg-white text-black" : "text-white/80 hover:bg-white/10")}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Qualité HLS */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((value) => (value === "quality" ? null : "quality"))}
              className="inline-flex items-center gap-2 transition hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current"><path d="M3 6h18v12H3zm2 2v8h14V8z" /><path d="M6 13h4v2H6zm6 0h6v2h-6zM6 10h10v1.6H6z" /></svg>
              {qualityLabel}
            </button>
            {menu === "quality" && (
              <div className="absolute bottom-full left-1/2 z-50 mb-3 w-28 -translate-x-1/2 rounded-xl border border-white/10 bg-black/90 p-1.5 backdrop-blur">
                <button
                  type="button"
                  onClick={() => setQuality(-1)}
                  className={cn("block w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] font-semibold transition", hlsState.auto ? "bg-white text-black" : "text-white/80 hover:bg-white/10")}
                >
                  Auto
                </button>
                {hlsState.levels.map((level) => (
                  <button
                    key={level.index}
                    type="button"
                    onClick={() => setQuality(level.index)}
                    className={cn("block w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] font-semibold transition", !hlsState.auto && hlsState.current === level.index ? "bg-white text-black" : "text-white/80 hover:bg-white/10")}
                  >
                    {level.height}p
                  </button>
                ))}
                {hlsState.levels.length === 0 && <p className="px-2.5 py-1.5 text-[11px] text-white/45">Une seule qualité</p>}
              </div>
            )}
          </div>

          {/* Volume */}
          <div className="group/vol relative flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }}
              aria-label={muted ? "Rétablir le son" : "Couper le son"}
              className="inline-flex items-center transition hover:text-white"
            >
              {muted || volume === 0
                ? <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current"><path d="M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7 2.7-1.4 1.4L15.2 13l-2.7 2.7-1.4-1.4L13.8 12l-2.7-2.7 1.4-1.4L15.2 10.6l2.7-2.7 1.4 1.4z" /></svg>
                : <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current"><path d="M3 9v6h4l5 5V4L7 9H3zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zm-2.5-9v2a7 7 0 0 1 0 14v2a9 9 0 0 0 0-18z" /></svg>}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(event) => {
                const video = videoRef.current;
                if (!video) return;
                video.volume = Number(event.target.value);
                video.muted = Number(event.target.value) === 0;
              }}
              className="player-range h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/30 transition-all group-hover/vol:w-20"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
