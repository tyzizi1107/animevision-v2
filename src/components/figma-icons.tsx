import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" } as const;

export const FigBellIcon = (p: P) => (
  <svg viewBox="0 0 25 25" {...base} strokeWidth={1.8} stroke="currentColor" {...p}>
    <path d="M18.75 8.33337C18.75 6.67577 18.0915 5.08606 16.9194 3.91396C15.7473 2.74185 14.1576 2.08337 12.5 2.08337C10.8424 2.08337 9.25268 2.74185 8.08058 3.91396C6.90848 5.08606 6.25 6.67577 6.25 8.33337C6.25 15.625 3.125 15.625 3.125 17.7084H21.875C21.875 15.625 18.75 15.625 18.75 8.33337Z" />
    <path d="M10.4165 21.875H14.5832" />
  </svg>
);
export const FigUserIcon = (p: P) => (
  <svg viewBox="0 0 25 25" {...base} strokeWidth={2} stroke="currentColor" {...p}>
    <path d="M20.8332 21.875V19.7917C20.8332 18.6866 20.3942 17.6268 19.6128 16.8454C18.8314 16.064 17.7716 15.625 16.6665 15.625H8.33317C7.2281 15.625 6.16829 16.064 5.38689 16.8454C4.60549 17.6268 4.1665 18.6866 4.1665 19.7917V21.875M16.6665 7.29167C16.6665 9.59285 14.801 11.4583 12.4998 11.4583C10.1987 11.4583 8.33317 9.59285 8.33317 7.29167C8.33317 4.99048 10.1987 3.125 12.4998 3.125C14.801 3.125 16.6665 4.99048 16.6665 7.29167Z" />
  </svg>
);
export const FigChevronDownIcon = (p: P) => (
  <svg viewBox="0 0 25 25" {...base} strokeWidth={1.8} stroke="currentColor" {...p}>
    <path d="M7.2915 10.4166L12.4998 15.625L17.7082 10.4166" />
  </svg>
);
export const FigPlayIcon = (p: P) => (
  <svg viewBox="0 0 22 22" fill="currentColor" aria-hidden="true" focusable="false" {...p}>
    <path d="M8.25 4.58331L18.3333 11L8.25 17.4166V4.58331Z" />
  </svg>
);
export const FigInfoIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={1.81512} stroke="currentColor" {...p}>
    <path d="M23.0923 12C23.0923 18.1262 18.126 23.0924 11.9999 23.0924C5.87371 23.0924 0.907463 18.1262 0.907463 12C0.907463 5.87383 5.87371 0.907586 11.9999 0.907586C18.126 0.907586 23.0923 5.87383 23.0923 12Z" />
    <path d="M11.9999 10.7675V18.1625M11.9999 5.83758V6.45382" />
  </svg>
);
export const FigListPlusIcon = (p: P) => (
  <svg viewBox="0 0 22 22" {...base} strokeWidth={2} stroke="currentColor" {...p}>
    <path d="M2.75 5.5H12.8333M2.75 10.0833H12.8333M2.75 14.6667H9.16667M13.75 13.75H19.25M16.5 11V16.5" />
  </svg>
);
export const FigPrevIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={1.8} stroke="currentColor" {...p}>
    <path d="M14 6L8 12L14 18" />
  </svg>
);
export const FigNextIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={1.8} stroke="currentColor" {...p}>
    <path d="M10 6L16 12L10 18" />
  </svg>
);
/** Lecture d'un film (maquette « anime details ») : triangle plein, 22×22. */
export const FigMoviePlayIcon = (p: P) => (
  <svg viewBox="0 0 22 22" fill="currentColor" aria-hidden="true" focusable="false" {...p}>
    <path d="M6.5 3.4v15.2a1 1 0 0 0 1.53.85l12.1-7.6a1 1 0 0 0 0-1.7L8.03 2.55A1 1 0 0 0 6.5 3.4Z" />
  </svg>
);
