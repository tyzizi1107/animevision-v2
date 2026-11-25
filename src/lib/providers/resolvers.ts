/**
 * Résolveurs d'embeds → flux jouables (portage TypeScript ciblé de
 * `gowaru-nuvio-providers/src/utils/resolvers.js`).
 *
 * Seuls les hébergeurs réellement rencontrés dans les providers FR sont
 * couverts : ansembed / vidmoly (HLS via urlset), uqload, sibnet,
 * vidzy, vidoza, filemoon. Un embed inconnu n'est jamais rendu tel quel :
 * le lecteur ne saurait pas l'afficher, donc il est ignoré.
 */

import { createDecipheriv } from "node:crypto";

import { BASE_HEADERS, BROWSER_UA, fetchText, type ProviderStream } from "./types";
import { extractVoeSource } from "./voe";

export type ResolvedStream = {
  url: string;
  type: "hls" | "mp4" | "dash";
  headers: Record<string, string>;
  quality: string | null;
  /** Résolutions proposées par le master HLS (`720p`, `1080p`…). */
  qualities?: string[];
  /** Pistes (sous-titres, audio) trouvées dans l'embed du provider. */
  tracks?: import("./types").ProviderTracks;
  /** Master HLS signé : seul fichier qui déclare les pistes audio. */
  masterUrl?: string | null;
};

/**
 * LuluStream (`lulustream.com/e/<id>`) : page HTML contenant un packer
 * `eval(function(p,a,c,k,e,d)…)`. Une fois déballé, on y trouve un
 * `sources: [{ file: "https://…/master.m3u8?t=…" }]`.
 * Pas de `Referer` : l'hébergeur le refuse.
 */
async function resolveLulustream(url: string, signal?: AbortSignal): Promise<ResolvedStream | null> {
  const page = await fetchText(url, {
    headers: { ...BASE_HEADERS, "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
    signal,
  });
  if (!page || page.status >= 400) return null;

  const unpacked = unpackScripts(page.text);
  const candidates = [page.text, ...unpacked];
  for (const body of candidates) {
    const media = findMediaUrl(body);
    if (media) {
      const master = /m3u8/i.test(media)
        ? await fetchText(media, { headers: { "User-Agent": BROWSER_UA }, signal })
        : null;
      const qualities = master?.ok ? masterQualities(master.text) : [];
      return {
        url: media,
        type: streamType(media),
        headers: { "User-Agent": BROWSER_UA },
        quality: qualities.at(-1) ?? null,
        qualities,
      };
    }
  }
  return null;
}

const MEDIA_EXTENSION = /\.(?:m3u8|mp4|webm|mkv|mpd)(?:[?#]|$)/i;
const JUNK_URL = /(?:google-analytics|doubleclick|\.jpg|\.png|\.gif|\.css|\.js)$/i;

export function isPlayableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && MEDIA_EXTENSION.test(url) && !JUNK_URL.test(url);
}

function streamType(url: string): "hls" | "mp4" | "dash" {
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return "hls";
  if (/\.mpd(?:[?#]|$)/i.test(url)) return "dash";
  return "mp4";
}

/** `sources: [{ file: '…' }]` ou `file: "…"` dans un player (uqload, vidmoly…). */
function findMediaUrl(html: string): string | null {
  const patterns = [
    /sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*['"]([^'"]+)['"]/i,
    /file\s*:\s*['"](https?:\/\/[^'"]+?\.(?:m3u8|mp4)[^'"]*)['"]/i,
    /["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i,
    /<source[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    const url = match?.[1]?.replace(/\\\//g, "/");
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  return null;
}

/** Toutes les résolutions déclarées par un master HLS, de la plus haute à la plus basse. */
export function masterQualities(master: string): string[] {
  const found = [...master.matchAll(/RESOLUTION=\d+x(\d+)/gi)]
    .map((match) => Number.parseInt(match[1] ?? "0", 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  return [...new Set(found)].sort((a, b) => b - a).map((value) => `${value}p`);
}

/**
 * Pistes audio déclarées par un master (`#EXT-X-MEDIA:TYPE=AUDIO`). Vidzy ne
 * sépare pas toujours VF et VOSTFR en deux fichiers : un même fichier peut
 * annoncer plusieurs langues audio, et c'est le lecteur qui choisit.
 */
export function masterAudioTracks(master: string): Array<{ name: string; lang: string; uri: string | null }> {
  const tracks: Array<{ name: string; lang: string; uri: string | null }> = [];
  for (const line of master.split(/\r?\n/)) {
    if (!/^#EXT-X-MEDIA:/i.test(line) || !/TYPE=AUDIO/i.test(line)) continue;
    const name = /NAME="([^"]*)"/i.exec(line)?.[1] ?? "";
    const lang = /LANGUAGE="([^"]*)"/i.exec(line)?.[1] ?? "";
    const uri = /URI="([^"]*)"/i.exec(line)?.[1] ?? null;
    tracks.push({ name: name || lang.toUpperCase() || `Piste ${tracks.length + 1}`, lang, uri });
  }
  return tracks;
}

/** Master HLS → première variante (URL absolue) pour connaître la qualité. */
function firstVariant(master: string, base: string): { url: string; quality: string | null } | null {
  const lines = master.split(/\r?\n/).map((line) => line.trim());
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    const quality = /RESOLUTION=\d+x(\d+)/i.exec(line)?.[1];
    const next = lines.slice(index + 1).find((candidate) => candidate && !candidate.startsWith("#"));
    if (!next) continue;
    try {
      return { url: new URL(next, base).toString(), quality: quality ? `${quality}p` : null };
    } catch {
      return null;
    }
  }
  return null;
}

type Resolver = (url: string, signal: AbortSignal) => Promise<ResolvedStream | null>;

/** ansembed / vidmoly / voembed : page embed → urlset/master.m3u8. */
const resolveAnsembed: Resolver = async (url, signal) => {
  const page = await fetchText(url, { signal, timeoutMs: 5_000, headers: { Referer: "https://animes-sama.fr/" } });
  if (!page?.ok) return null;
  const media = findMediaUrl(page.text) ?? (await followJsRedirect(page.text, signal));
  if (!media) return null;
  const headers = { Referer: new URL(url).origin + "/", Origin: new URL(url).origin };
  if (streamType(media) !== "hls") return { url: media, type: streamType(media), headers, quality: null };
  const master = await fetchText(media, { signal, timeoutMs: 5_000, headers });
  const variant = master?.ok ? firstVariant(master.text, media) : null;
  const qualities = master?.ok ? masterQualities(master.text) : [];
  return { url: media, type: "hls", headers, quality: variant?.quality ?? null, qualities };
};

/**
 * Certains hébergeurs (vidmoly) renvoient d'abord un `location.replace('…')`
 * avec un jeton, puis la vraie page lecteur : on suit ce saut une seule fois.
 */
async function followJsRedirect(html: string, signal: AbortSignal): Promise<string | null> {
  const target = /location\.(?:replace|href)\s*=\s*['"]([^'"]+)['"]/i.exec(html)?.[1]
    ?? /window\.location\s*=\s*['"]([^'"]+)['"]/i.exec(html)?.[1];
  if (!target || !/^https?:\/\//i.test(target)) return null;
  const next = await fetchText(target, { signal, timeoutMs: 5_000, headers: { Referer: new URL(target).origin + "/" } });
  return next?.ok ? findMediaUrl(next.text) : null;
}

/**
 * bysedikamoum (hébergeur de Franime) : la page embed est un lecteur React qui
 * charge ses sources depuis `/api/videos/{code}` sous forme chiffrée.
 *  - payload base64url, AES-256-GCM, tag GCM en fin de payload, IV de 12 octets ;
 *  - la clé (32 octets) est la concaténation base64url de `key_parts[version-1]`
 *    et `key_parts[31-version]` — la petite permutation du lecteur officiel ;
 *  - le JSON clair contient `sources[]` (url, label) et éventuellement des
 *    `tracks` de sous-titres.
 */
function base64Url(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded + "=".repeat((4 - (padded.length % 4)) % 4), "base64");
}

type BysePlayback = { version?: string | number; iv?: string; payload?: string; key_parts?: string[] };

function decryptByse(playback: BysePlayback): { sources?: Array<{ url?: string; label?: string; mime_type?: string }> } | null {
  const parts = Array.isArray(playback.key_parts) ? playback.key_parts.filter((part) => typeof part === "string" && part.length > 0) : [];
  if (!playback.iv || !playback.payload || parts.length === 0) return null;
  const version = Number(playback.version ?? 1);
  const picked = [version, 31 - version].filter((index) => index >= 1 && index <= parts.length);
  const key = Buffer.concat((picked.length > 0 ? picked : parts.map((_, index) => index + 1)).map((index) => base64Url(parts[index - 1]!)));
  const iv = base64Url(playback.iv);
  const payload = base64Url(playback.payload);
  if (key.length !== 32 || payload.length <= 16) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(payload.subarray(payload.length - 16));
    const clear = Buffer.concat([decipher.update(payload.subarray(0, payload.length - 16)), decipher.final()]);
    return JSON.parse(clear.toString("utf8")) as { sources?: Array<{ url?: string; label?: string; mime_type?: string }> };
  } catch {
    return null;
  }
}

const resolveByse: Resolver = async (url, signal) => {
  const code = /\/e\/([A-Za-z0-9_-]+)/.exec(url)?.[1];
  if (!code) return null;
  const meta = await fetchText(`https://bysedikamoum.com/api/videos/${encodeURIComponent(code)}`, {
    signal,
    timeoutMs: 5_000,
    headers: { Accept: "application/json", Referer: `${new URL(url).origin}/e/${code}` },
  });
  if (!meta?.ok) return null;
  try {
    const data = JSON.parse(meta.text) as { playback?: BysePlayback };
    const clear = data.playback ? decryptByse(data.playback) : null;
    const media = clear?.sources?.find((source) => source.url && /^https?:\/\//i.test(source.url));
    if (!media?.url) return null;
    const headers = { Referer: `${new URL(url).origin}/`, Origin: new URL(url).origin };
    if (streamType(media.url) !== "hls") return { url: media.url, type: streamType(media.url), headers, quality: null };
    const master = await fetchText(media.url, { signal, timeoutMs: 5_000, headers });
    const qualities = master?.ok ? masterQualities(master.text) : [];
    return {
      url: media.url,
      type: "hls",
      headers,
      quality: qualities[0] ?? (media.label && /^\d+p$/.test(media.label) ? media.label : null),
      qualities,
    };
  } catch {
    return null;
  }
};

/** uqload / oneupload : `sources: [{ file: … }]`. */
/**
 * VidHide (domaines tournants : vidhide*, miochinos, bingezove…) : le lien
 * HLS est caché dans un script « packer » `eval(function(p,a,c,k,e,d)…)`.
 */
function unpackScripts(html: string): string[] {
  const pattern = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/g;
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const encode = (value: number, base: number): string => {
    if (value === 0) return "0";
    let rest = value;
    let out = "";
    while (rest > 0) {
      out = alphabet[rest % base]! + out;
      rest = Math.floor(rest / base);
    }
    return out;
  };
  const decoded: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const [, body, rawBase, rawCount, words] = match;
    if (!body || !words) continue;
    const base = Number.parseInt(rawBase ?? "62", 10);
    const count = Number.parseInt(rawCount ?? "0", 10);
    if (!(base >= 2 && base <= 62)) continue;
    const list = words.split("|");
    let text = body;
    for (let index = Math.min(count, list.length) - 1; index >= 0; index -= 1) {
      const word = list[index];
      if (!word) continue;
      text = text.replace(new RegExp(`\\b${encode(index, base)}\\b`, "g"), word);
    }
    decoded.push(text);
  }
  return decoded;
}

/**
 * uqload (et vidzy / filemoon / vidoza, même gabarit) : le lien est dans un
 * script « packer ». Vérifié en direct : envoyer un `Referer` (même celui du
 * site lui-même) fait répondre `Video embed restricted for this domain` en
 * 38 octets ; sans `Referer`, la page complète (≈ 29 Ko) arrive avec le flux.
 */
const resolveUqload: Resolver = async (url, signal) => {
  const origin = new URL(url).origin;
  let page = await fetchText(url, { signal, timeoutMs: 7_000, headers: { "User-Agent": BROWSER_UA } });
  // oneupload renvoie d'abord une page « Loading… » qui redirige en JS vers
  // l'URL réelle (jeton + session) : sans ce second saut, aucun flux.
  const bounce = /window\.location\.replace\('([^']+)'\)/.exec(page?.text ?? "")?.[1];
  if (bounce && /^https?:\/\//i.test(bounce)) {
    page = await fetchText(bounce, {
      signal,
      timeoutMs: 7_000,
      headers: { "User-Agent": BROWSER_UA, Referer: `${origin}/` },
    });
  }
  if (!page?.ok) return null;
  const sources = [page.text, ...unpackScripts(page.text)];
  for (const content of sources) {
    const media = findMediaUrl(content);
    if (!media) continue;
    const absolute = media.startsWith("//") ? `https:${media}` : media.startsWith("/") ? `${origin}${media}` : media;
    if (!/^https?:\/\//i.test(absolute)) continue;
    const headers = { Referer: `${origin}/` };
    const type = streamType(absolute);
    if (type !== "hls") return { url: absolute, type, headers, quality: null };
    const master = await fetchText(absolute, { signal, timeoutMs: 5_000, headers });
    const variant = master?.ok ? firstVariant(master.text, absolute) : null;
    return { url: absolute, type, headers, quality: variant?.quality ?? null, qualities: master?.ok ? masterQualities(master.text) : [] };
  }
  return null;
};

/**
 * Hébergeurs abandonnés : leur domaine est mort ou répond systématiquement
 * 403 (sibnet, sendvid, streamtape, dood, mixdrop…). On ne les tente plus : ils
 * consommaient du budget pour zéro flux.
 */
const DEAD_HOSTS = /sibnet\.|sendvid\.|streamtape|stape\.|dood\.|ds2play|ninjastream|upvid|opvid|jetload|getvid\.|lvturbo|streamlare|myvi\.|myvi\.tv|iframedream|kaztube|fembed\.|vfree\.|mixdrop\.|vudeo\./i;

export function isDeadHost(url: string): boolean {
  return DEAD_HOSTS.test(url);
}

/** VOE : payload JSON chiffré en couches (rot13 → base64 → +3 → inversion). */
const resolveVoe: Resolver = async (url, signal) => {
  const media = await extractVoeSource(url, signal);
  if (!media) return null;
  const headers = { Referer: new URL(url).origin + "/", Origin: new URL(url).origin };
  const type = streamType(media);
  if (type !== "hls") return { url: media, type, headers, quality: null };
  const master = await fetchText(media, { signal, timeoutMs: 5_000, headers });
  const variant = master?.ok ? firstVariant(master.text, media) : null;
  return { url: media, type, headers, quality: variant?.quality ?? null, qualities: master?.ok ? masterQualities(master.text) : [] };
};

const resolveVidhide: Resolver = async (url, signal) => {
  const page = await fetchText(url, {
    signal,
    timeoutMs: 6_000,
    headers: { ...BASE_HEADERS, Referer: new URL(url).origin + "/" },
  });
  if (!page?.ok) return null;
  const candidates = [page.text, ...unpackScripts(page.text)];
  for (const content of candidates) {
    const match = /["']((?:https?:)?\/\/[^"'\s<>]*?\.m3u8(?:\?[^"'\s<>]*)?)["']/i.exec(content);
    if (!match?.[1]) continue;
    const media = match[1].replace(/\\\//g, "/");
    const absolute = media.startsWith("//") ? `https:${media}` : media;
    if (!/^https?:\/\//i.test(absolute)) continue;
    const headers = { Referer: new URL(url).origin + "/", Origin: new URL(url).origin };
    const master = await fetchText(absolute, { signal, timeoutMs: 5_000, headers });
    const variant = master?.ok ? firstVariant(master.text, absolute) : null;
    return { url: absolute, type: "hls", headers, quality: variant?.quality ?? null, qualities: master?.ok ? masterQualities(master.text) : [] };
  }
  return null;
};

/**
 * Vidzy (`vidzy.cc/embed-<code>.html`) : page de lecteur contenant
 * `sources: [{src: "https://v6.vidzy.org/hls2/…/master.m3u8?t=…"}]`. Le flux est
 * un HLS classique, sans Referer obligatoire une fois l'URL signée obtenue.
 */
/** Libellés des pistes de sous-titres publiées par Vidzy. */
const VIDZY_SUBTITLE_LABELS: Record<string, string> = {
  fre: "Français",
  eng: "Anglais",
  jpn: "Japonais",
  spa: "Espagnol",
  por: "Portugais",
  ita: "Italien",
  ger: "Allemand",
  ara: "Arabe",
  rus: "Russe",
  tur: "Turc",
};

/**
 * Pistes de sous-titres de l'embed Vidzy (`srtproxy/<code>_<lang>.vtt?…`).
 * Ce ne sont pas des flux séparés : le même fichier porte la VF et la VOSTFR,
 * seules les pistes changent.
 */
function subtitleTracks(html: string, embedUrl: string): Array<{ language: string; label: string; url: string }> {
  const found = new Map<string, string>();
  for (const match of html.matchAll(/srtproxy\/[a-z0-9]+_([a-z]{3})\.vtt\?[^"'\\\s]*/gi)) {
    const language = match[1].toLowerCase();
    if (found.has(language)) continue;
    const raw = match[0];
    found.set(language, raw.startsWith("http") ? raw : `https://vidzy.cc/${raw}`);
  }
  if (!found.size) {
    const code = /embed-([a-z0-9]+)\.html/i.exec(embedUrl)?.[1];
    if (code) found.set("fre", `https://vidzy.cc/srtproxy/${code}_fre.vtt`);
  }
  return [...found].map(([language, url]) => ({ language, label: VIDZY_SUBTITLE_LABELS[language] ?? language.toUpperCase(), url }));
}

async function resolveVidzy(url: string, signal?: AbortSignal): Promise<ResolvedStream | null> {
  // Une page `/serie/…` (celle que donne l'API) contient l'iframe du lecteur
  // (`#pf` → `vidzy.cc/embed-…`) : sans ce passage, on cherchait un `.m3u8`
  // dans une page qui n'en a pas, et le flux était perdu.
  let html = "";
  let target = url;
  {
    const page = await fetchText(target, {
      headers: { ...BASE_HEADERS, "User-Agent": BROWSER_UA, Accept: "text/html,*/*", Referer: "https://vidzy.cc/" },
      signal,
      timeoutMs: 8_000,
    });
    if (!page || page.status >= 400) return null;
    html = page.text;
    const embed = /<iframe[^>]+id=["']pf["'][^>]+src=["']([^"']+)["']/i.exec(html)?.[1]
      ?? /<iframe[^>]+src=["']([^"']*\/embed-[^"']+)["']/i.exec(html)?.[1];
    if (embed && !/vidzy\.cc\/embed-|vidzy\.cc\/e\//i.test(target)) {
      target = embed.startsWith("http") ? embed : new URL(embed, "https://vidzy.cc/").toString();
      const inner = await fetchText(target, {
        headers: { ...BASE_HEADERS, "User-Agent": BROWSER_UA, Accept: "text/html,*/*", Referer: "https://vidzy.cc/" },
        signal,
        timeoutMs: 8_000,
      });
      if (!inner || inner.status >= 400) return null;
      html = inner.text;
    }
  }
  const page = { text: html };

  const media = /sources\s*:\s*\[\s*\{[^}]*?src\s*:\s*["']([^"']+)["']/i.exec(page.text)?.[1]
    ?? /["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i.exec(page.text)?.[1];
  if (!media) return null;

  // Vidzy sert un master PUBLIC `s1.fsvid.lol/troll/master.m3u8` (bouton
  // « télécharger ») : ce n'est PAS la vidéo, il ne contient que ~13 s.
  // La vraie piste est le lien HLS signé de l'embed (`v6.vidzy.org/hls2/…`).
  // On ne garde donc que les URL signées, dans cet ordre de préférence.
  // Deux formes existent : la playlist de variantes (`…/index.m3u8`) et celle
  // de segments (`…/index-v1-a1.m3u8`). Le master n'étant pas réécrit par le
  // proxy, il faut lui donner DIRECTEMENT la playlist de segments, sinon le
  // navigateur reçoit une playlist de variantes là où il attend des segments
  // (« Missing Target Duration »).
  const candidates = [
    ...page.text.matchAll(/https?:\/\/[^"'\s]*\/hls2\/[^"'\s]+?\.m3u8[^"'\s]*/gi),
    ...page.text.matchAll(/https?:\/\/[^"'\s]+\.m3u8\?t=[^"'\s]*/gi),
  ].map((match) => match[0]);
  const masterUrl = candidates[0] ?? null;
  if (!masterUrl) return null;
  // Le master est signé (`?t=…&s=…&e=…`) : la playlist de segments se
  // reconstruit à partir de son CHEMIN en gardant la même signature, comme le
  // fait le lecteur de Vidzy (`…/,code_n,.urlset/index-v1-a1.m3u8` + la query).
  const signed = (() => {
    const parsed = new URL(masterUrl);
    const dir = parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1);
    // `i`/`sp` sont propres au MASTER : sur la playlist de segments, le CDN
    // répond une playlist de variantes (aucun `#EXTINF`) -> « Missing Target
    // Duration ». On repart de la signature (t, s, e, f) et de `fr` seuls.
    const query = new URLSearchParams();
    for (const key of ["t", "s", "e", "f", "fr"]) {
      const value = parsed.searchParams.get(key);
      if (value) query.set(key, value);
    }
    return `${parsed.origin}${dir}index-v1-a1.m3u8?${query.toString()}`;
  })();

  // Le master donne les résolutions proposées au sélecteur de qualité.
  // Le master (`…/master.m3u8`) est le seul fichier qui déclare les pistes
  // audio (VF + japonais pour un même fichier) : on le lit pour ça, même si le
  // flux joué est la playlist de segments.
  const declaredMasterUrl = (() => {
    const parsed = new URL(signed);
    const query = new URLSearchParams();
    for (const key of ["t", "s", "e", "f", "fr"]) {
      const value = parsed.searchParams.get(key);
      if (value) query.set(key, value);
    }
    const dir = parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1);
    return `${parsed.origin}${dir}master.m3u8?${query.toString()}`;
  })();
  const master = await fetchText(declaredMasterUrl, { headers: { "User-Agent": BROWSER_UA, Referer: "https://vidzy.cc/" }, signal, timeoutMs: 5_000 });
  const qualities = master?.ok ? masterQualities(master.text) : [];
  const subtitles = subtitleTracks(page.text, url);
  const audioTracks = master?.ok ? masterAudioTracks(master.text) : [];
  const audioLanguages = audioTracks.map((track) => track.lang);
  // Ce que le fichier joue réellement : une piste japonaise avec des
  // sous-titres français = VOSTFR, même si Vidzy appelle le flux « VF ».
  // Sans aucune piste audio déclarée, le fichier est mono-piste : c'est le
  // libellé du provider qui tranche (rien ne permet de le contredire).
  // Vidzy sert souvent le même fichier pour « VF » et « VOSTFR », et quand il
  // n'y a qu'une piste (française), c'est la VF : le libellé du provider est
  // alors suivi. Une piste japonaise = version originale sous-titrée.
  const playback: "vostfr" | "vf" | undefined = audioLanguages.length === 0
    ? undefined
    : audioLanguages.includes("ja")
      ? "vostfr"
      : "vf";
  return {
    url: signed,
    type: "hls",
    headers: { "User-Agent": BROWSER_UA, Referer: "https://vidzy.cc/" },
    quality: qualities.at(-1) ?? null,
    qualities,
    tracks: {
      subtitles,
      audio: master?.ok ? audioTracks.map((track) => track.name) : undefined,
      audioLanguages: master?.ok ? audioLanguages : undefined,
      playback,
    },
    masterUrl: declaredMasterUrl,
  };
}

const RESOLVERS: Array<{ match: RegExp; resolve: Resolver }> = [
  { match: /ansembed\.|vidmoly\.|voembed\./i, resolve: resolveAnsembed },
  { match: /lulustream\.|lulu\./i, resolve: resolveLulustream },
  { match: /uqload\.|oneupload\./i, resolve: resolveUqload },
  { match: /vidzy\.cc\/embed-|vidzy\.cc\/e\//i, resolve: resolveVidzy },
  // Le CDN de Vidzy (`v6.vidzy.org`, `u14.vidzy.org`…) doit être reconnu comme
  // Vidzy : sinon l'URL signée retombait sur le résolveur uqload et perdait ses
  // pistes audio, donc la VF.
  { match: /^https?:\/\/[^/]*(?:vidzy|fsvid)\./i, resolve: resolveVidzy },
  { match: /vidzy\.|fsvid\./i, resolve: resolveUqload },
  { match: /filemoon\.|moonplayer\./i, resolve: resolveUqload },
  { match: /vidoza\./i, resolve: resolveUqload },
  { match: /bysedikamoum\./i, resolve: resolveByse },
  // VOE : le domaine change souvent (voe.sx → teresapoliticallearn.com →
  // caseyseemavoid.com). On reconnaît donc la forme `/e/<code>` d'un lien
  // qui n'est pas déjà pris par un autre hébergeur ci-dessus.
  { match: /voe\.|teresapoliticallearn|caseyseemavoid|\/e\/[a-z0-9]{6,}/i, resolve: resolveVoe },
  // VidHide et ses domaines tournants.
  { match: /vidhide|miochinos|bingezove|minochinos/i, resolve: resolveVidhide },
];

/** Un flux direct est conservé tel quel ; un embed connu est résolu. */
export async function resolveProviderStream(
  stream: ProviderStream,
  signal: AbortSignal,
): Promise<ResolvedStream | null> {
  // Hébergeur connu comme mort : inutile de consommer le budget du provider.
  if (isDeadHost(stream.url)) return null;
  if (isPlayableUrl(stream.url)) {
    return {
      url: stream.url,
      type: streamType(stream.url),
      headers: stream.headers ?? {},
      quality: null,
    };
  }
  const resolver = RESOLVERS.find((entry) => entry.match.test(stream.url));
  if (!resolver) {
    if (process.env.PROVIDER_DEBUG === "1") console.log("[resolvers] aucun résolveur pour", stream.url);
    return null;
  }
  try {
    const resolved = await resolver.resolve(stream.url, signal);
    if (process.env.PROVIDER_DEBUG === "1") {
      console.log("[resolvers]", stream.url.slice(0, 48), "→", resolved?.url?.slice(0, 60) ?? "échec");
    }
    if (!resolved || !/^https?:\/\//i.test(resolved.url)) return null;
    return {
      ...resolved,
      headers: { ...BASE_HEADERS, ...resolved.headers, ...(stream.resolveHeaders ?? {}), ...(stream.headers ?? {}) },
    };
  } catch {
    return null;
  }
}
