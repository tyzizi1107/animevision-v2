"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LAST_ACTIVE_KEY, SESSION_KEY } from "./splash-boot";

/**
 * Écran d'arrivée (maquette Figma 218:4) : fond cinéma sombre, logo 466 px au
 * centre, messages qui se succèdent sous le logo. Chaque message correspond à
 * un chargement réel : il reste affiché tant que ce chargement n'est pas fini,
 * puis le suivant prend sa place. Dès que tout est prêt, le logo grossit
 * jusqu'à remplir l'écran et dévoile le site.
 */
const MESSAGES = [
  "Chargement de AnimeVision...",
  "Chargement des préférences...",
  "Chargement des animes...",
];
// L'écran ne doit jamais retarder une visite : si tout est déjà prêt, il passe
// en un clin d'œil. Il ne s'attarde que si un chargement traîne vraiment.
const QUICK_STEP_MS = 320; // message déjà satisfait → on enchaîne vite
const MIN_STEP_MS = 1100; // un message qui attend un chargement reste lisible
const MIN_SHOW_MS = 900; // l'écran ne clignote jamais
const MAX_WAIT_MS = 12000; // filet de sécurité
const ZOOM_MS = 950;
/** Pages ouvertes en priorité : préchargées pendant l'écran d'arrivée. */
const PREFETCH_ROUTES = ["/", "/catalogue", "/calendrier", "/recherche", "/ma-liste", "/notifications"];

type Phase = "loading" | "zoom" | "done";

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Préférences : compte (thème, taille du texte, animations) + reprises locales. */
async function loadPreferences(): Promise<void> {
  const account = fetch("/api/authentification/me", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  // La bibliothèque locale (reprises, ma liste) se lit pendant la requête.
  try {
    window.localStorage.getItem("animevision.library");
  } catch {
    /* stockage bloqué : rien à lire */
  }
  await account;
}

/** Animés : la page doit être là, polices et images visibles comprises. */
async function loadAnimes(): Promise<void> {
  const page = new Promise<void>((resolve) => {
    if (document.readyState === "complete") resolve();
    else window.addEventListener("load", () => resolve(), { once: true });
  });
  const fonts = (document.fonts?.ready ?? Promise.resolve()).then(() => undefined);
  const images = Promise.all(
    Array.from(document.images)
      .filter((img) => !img.complete && img.getBoundingClientRect().top < window.innerHeight)
      .map((img) => new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      })),
  );
  await Promise.all([page, fonts, images]);
}

export function InitialLoadingScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [step, setStep] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const show = document.documentElement.hasAttribute("data-splash");
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
      localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
    } catch {
      /* stockage indisponible : l'écran fonctionne quand même */
    }

    // Préchargement systématique des pages principales, avec ou sans écran.
    PREFETCH_ROUTES.forEach((route) => {
      try { router.prefetch(route); } catch { /* ignoré */ }
    });

    if (!show) {
      setPhase("done");
      return;
    }

    let cancelled = false;
    const t0 = performance.now();

    const zoomOut = async () => {
      const remaining = MIN_SHOW_MS - (performance.now() - t0);
      if (remaining > 0) await wait(remaining);
      if (cancelled) return;
      setPhase("zoom");
      await wait(ZOOM_MS);
      if (cancelled) return;
      setPhase("done");
      document.documentElement.removeAttribute("data-splash");
    };

    /** Affiche l'étape, attend son chargement réel, puis garantit un temps de lecture. */
    const runStep = async (index: number, work: () => Promise<void>) => {
      if (cancelled) return;
      setStep(index);
      const before = performance.now();
      let slow = false;
      const timer = window.setTimeout(() => { slow = true; }, 250);
      await Promise.race([work(), wait(MAX_WAIT_MS)]);
      window.clearTimeout(timer);
      if (cancelled) return;
      // Chargement déjà fini en moins de 250 ms : on ne fait patienter personne.
      const floor = slow ? MIN_STEP_MS : QUICK_STEP_MS;
      await wait(Math.max(0, floor - (performance.now() - before)));
    };

    const run = async () => {
      // 1. AnimeVision : la base du site (préchargement des pages lancé).
      await runStep(0, () => Promise.resolve());
      // 2. Préférences de l'utilisateur : thème, texte, reprises.
      await runStep(1, loadPreferences);
      // 3. Animés : la page rendue, polices et images.
      await runStep(2, loadAnimes);
      if (cancelled) return;
      await zoomOut();
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (phase === "done") return null;
  const zooming = phase === "zoom";

  return (
    <div
      className="av-splash fixed inset-0 z-[130] overflow-hidden bg-[#0a0711]"
      style={{
        opacity: zooming ? 0 : 1,
        transition: zooming ? `opacity ${ZOOM_MS * 0.55}ms ease-in ${ZOOM_MS * 0.45}ms` : undefined,
      }}
      role="status"
      aria-live="polite"
      aria-label="Chargement d’AnimeVision"
    >
      {/* Fond sombre uni : logo et message au centre. */}
      <div className="absolute inset-0">
        {/* Logo : l'œil mesure 167×133 px dans la maquette (cadre du fichier ≈ 440 px),
            centré à 380 px du haut d'un cadre de 760 px. */}
        <div
          className="absolute left-1/2 top-1/2 aspect-square w-[min(480px,66vw)]"
          style={{
            marginLeft: "calc(min(480px, 66vw) / -2)",
            marginTop: "calc(min(480px, 66vw) / -2)",
            // Le zoom se fait vers la pupille (≈ 48 % / 53 % du logo).
            transformOrigin: "48% 53%",
            transform: zooming ? "scale(70)" : "scale(1)",
            transition: zooming ? `transform ${ZOOM_MS}ms cubic-bezier(0.6, 0, 0.9, 0.3)` : undefined,
            willChange: "transform",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/animevision.png"
            alt="AnimeVision"
            fetchPriority="high"
            decoding="sync"
            className="h-full w-full object-contain"
          />
        </div>

        {/* Messages (Inter 18/28, #DAD5E5, alignés à gauche à x = 598 px) :
            un seul à la fois, ils se succèdent en fondu glissé. */}
        <div
          className="absolute h-[28px] w-[min(510px,86vw)]"
          style={{
            left: "max(16px, calc(50% - 122px))",
            top: "calc(50% + 81px)",
            // Les messages s'effacent très vite : le zoom doit être net.
            opacity: zooming ? 0 : 1,
            transition: zooming ? "opacity 120ms linear" : undefined,
          }}
        >
          {MESSAGES.map((message, index) => (
            <p
              key={message}
              aria-hidden={index !== step}
              className="absolute inset-0 whitespace-nowrap text-[18px] font-normal leading-[28px] text-[#dad5e5] transition-all duration-500 ease-out"
              style={{
                opacity: index === step ? 1 : 0,
                transform: index === step ? "translateY(0)" : index === (step + MESSAGES.length - 1) % MESSAGES.length ? "translateY(-10px)" : "translateY(10px)",
              }}
            >
              {message}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
