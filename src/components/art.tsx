import type { CSSProperties } from "react";

type ArtProps = {
  slug: string;
  palette: [string, string];
  className?: string;
  style?: CSSProperties;
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Illustration générative déterministe : chaque animé possède une affiche unique,
 * dessinée à partir de son slug et de sa palette. Aucune image externe requise.
 */
export function PosterArt({ slug, palette, className, style }: ArtProps) {
  const random = makeRandom(hashString(slug));
  const [first, second] = palette;
  const uid = `p${hashString(slug).toString(36)}`;
  const motif = Math.floor(random() * 3);
  const glowX = 60 + random() * 220;
  const glowY = 120 + random() * 200;
  const centerX = 120 + random() * 180;
  const centerY = 260 + random() * 120;

  return (
    <svg
      viewBox="0 0 400 600"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#06070d" />
          <stop offset="52%" stopColor="#0a0c16" />
          <stop offset="100%" stopColor={first} stopOpacity="0.6" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={second} stopOpacity="0.95" />
          <stop offset="52%" stopColor={first} stopOpacity="0.4" />
          <stop offset="100%" stopColor={first} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-band`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={first} stopOpacity="0" />
          <stop offset="50%" stopColor={second} stopOpacity="0.75" />
          <stop offset="100%" stopColor={first} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${uid}-disc`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={second} stopOpacity="0.95" />
          <stop offset="100%" stopColor={first} stopOpacity="0.55" />
        </linearGradient>
        <pattern id={`${uid}-dots`} width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="1.6" cy="1.6" r="1.05" fill="#ffffff" fillOpacity="0.55" />
        </pattern>
        <linearGradient id={`${uid}-vignette`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="38%" stopColor="#05060b" stopOpacity="0" />
          <stop offset="100%" stopColor="#05060b" stopOpacity="0.94" />
        </linearGradient>
      </defs>

      <rect width="400" height="600" fill={`url(#${uid}-bg)`} />
      <ellipse cx={glowX} cy={glowY} rx="250" ry="210" fill={`url(#${uid}-glow)`} />

      {motif === 0 && (
        <g>
          {[86, 142, 200].map((radius, index) => (
            <circle
              key={radius}
              cx={centerX}
              cy={centerY}
              r={radius}
              fill="none"
              stroke={second}
              strokeOpacity={0.42 - index * 0.1}
              strokeWidth="1.1"
            />
          ))}
          <circle cx={centerX} cy={centerY} r="38" fill={`url(#${uid}-disc)`} opacity="0.9" />
          <rect
            x="-120"
            y={430 + random() * 60}
            width="640"
            height="26"
            fill={`url(#${uid}-band)`}
            opacity="0.55"
            transform={`rotate(${-18 + random() * 12} 200 300)`}
          />
        </g>
      )}

      {motif === 1 && (
        <g transform={`rotate(${-30 + random() * 30} 200 300)`}>
          {[0, 1, 2, 3].map((index) => (
            <rect
              key={index}
              x={-80 + index * 110}
              y={-60}
              width={26 + (index % 2) * 34}
              height="760"
              fill={index % 2 === 0 ? second : first}
              opacity={0.07 + index * 0.045}
            />
          ))}
          <circle cx="300" cy="180" r="104" fill="none" stroke={second} strokeOpacity="0.4" />
          <circle cx="300" cy="180" r="74" fill={`url(#${uid}-disc)`} opacity="0.5" />
        </g>
      )}

      {motif === 2 && (
        <g>
          <path
            d={`M -40 520 Q 200 ${340 + random() * 60} 440 470`}
            fill="none"
            stroke={second}
            strokeOpacity="0.5"
            strokeWidth="1.6"
          />
          <path
            d={`M -40 560 Q 200 ${380 + random() * 60} 440 510`}
            fill="none"
            stroke={second}
            strokeOpacity="0.28"
            strokeWidth="1.2"
          />
          <circle cx="310" cy="150" r="120" fill={`url(#${uid}-disc)`} opacity="0.55" />
          <circle cx="310" cy="150" r="120" fill="none" stroke="#ffffff" strokeOpacity="0.12" />
          <rect
            x="-100"
            y={210 + random() * 60}
            width="620"
            height="12"
            fill={second}
            opacity="0.5"
            transform="rotate(-14 200 300)"
          />
        </g>
      )}

      <rect y="330" width="400" height="270" fill={`url(#${uid}-dots)`} opacity="0.1" />
      <rect width="400" height="600" fill={`url(#${uid}-vignette)`} />
    </svg>
  );
}

/** Variante panoramique pour les bannières (hero, fiche animé, lecteur). */
export function BannerArt({ slug, palette, className, style }: ArtProps) {
  const random = makeRandom(hashString(slug) + 7);
  const [first, second] = palette;
  const uid = `b${hashString(slug).toString(36)}`;
  const glowX = 1050 + random() * 320;
  const glowY = 180 + random() * 260;

  return (
    <svg
      viewBox="0 0 1600 700"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#06070d" />
          <stop offset="45%" stopColor="#0a0b14" />
          <stop offset="100%" stopColor={first} stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={second} stopOpacity="0.85" />
          <stop offset="55%" stopColor={first} stopOpacity="0.35" />
          <stop offset="100%" stopColor={first} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-disc`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={second} stopOpacity="0.9" />
          <stop offset="100%" stopColor={first} stopOpacity="0.45" />
        </linearGradient>
        <pattern id={`${uid}-dots`} width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.3" fill="#ffffff" fillOpacity="0.45" />
        </pattern>
        <linearGradient id={`${uid}-fade`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#06070d" stopOpacity="0.92" />
          <stop offset="38%" stopColor="#06070d" stopOpacity="0.55" />
          <stop offset="70%" stopColor="#06070d" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="1600" height="700" fill={`url(#${uid}-bg)`} />
      <ellipse cx={glowX} cy={glowY} rx="520" ry="420" fill={`url(#${uid}-glow)`} />

      {[190, 300, 420].map((radius, index) => (
        <circle
          key={radius}
          cx="1180"
          cy="360"
          r={radius}
          fill="none"
          stroke={second}
          strokeOpacity={0.3 - index * 0.07}
          strokeWidth="1.4"
        />
      ))}
      <circle cx="1180" cy="360" r="96" fill={`url(#${uid}-disc)`} opacity="0.55" />

      <g transform="rotate(-18 900 420)" opacity="0.5">
        <rect x="420" y="300" width="900" height="10" fill={second} opacity="0.4" />
        <rect x="520" y="352" width="700" height="3" fill={second} opacity="0.5" />
      </g>

      <rect x="820" y="0" width="780" height="700" fill={`url(#${uid}-dots)`} opacity="0.14" />
      <rect width="1600" height="700" fill={`url(#${uid}-fade)`} />
    </svg>
  );
}
