/**
 * Traduction des sous-titres en français.
 *
 * Vidzy ne publie qu'une seule piste VTT par épisode, et ce n'est pas toujours
 * le français : sans traduction, un épisode n'a aucun sous-titre lisible (ou
 * seulement le titre et la bande-annonce). On passe donc le fichier par un
 * service de traduction gratuit (MyMemory, sans clé) quand la piste n'est pas
 * déjà française.
 *
 * Le format WebVTT est reconstruit à l'identique : numéros de séquence,
 * horodatages et index de répliques ne bougent pas, seul le texte change.
 */

const FRENCH = /^fr/i;

/** Extrait les blocs `horodatage + texte` d'un fichier VTT. */
type Cue = { index: number; lines: string[] };

export function parseVtt(body: string): { header: string; cues: Cue[] } {
  const normalized = body.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const header: string[] = [];
  const cues: Cue[] = [];
  let current: Cue | null = null;
  let seenTiming = false;
  for (const line of lines) {
    if (/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(line.trim())) {
      current = { index: cues.length, lines: [line] };
      cues.push(current);
      seenTiming = true;
      continue;
    }
    if (!seenTiming) {
      header.push(line);
      continue;
    }
    if (line.trim() === "") {
      current = null;
      continue;
    }
    current?.lines.push(line);
  }
  return { header: header.join("\n"), cues };
}

/** Texte d'une réplique, sans les balises de style du provider. */
function cueText(cue: Cue): string {
  return cue.lines
    .slice(1)
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Un VTT n'a-t-il que des répliques « décoratives » (titre, à suivre…) ? */
export function isSparseVtt(body: string): boolean {
  const { cues } = parseVtt(body);
  return cues.length <= 8;
}

/** Détecte la langue d'un texte : `fr`, `en`… (heuristique courte et sûre). */
export function guessLanguage(text: string): "fr" | "en" | "other" {
  const sample = text.slice(0, 400).toLowerCase();
  if (!sample.trim()) return "other";
  const french = /\b(le|la|les|des|une|est|que|qui|pour|avec|vous|nous|pas|dans|sur|au|du|il|elle|je|tu|ce|cette|mais|plus|tout|comme|sans|être|fait|dit)\b/g;
  const english = /\b(the|and|you|that|this|with|have|are|was|for|not|but|his|her|they|what|your|from|will|would|there|their|about|just|know|like)\b/g;
  const fr = (sample.match(french) ?? []).length;
  const en = (sample.match(english) ?? []).length;
  if (fr === 0 && en === 0) return "other";
  return fr >= en ? "fr" : "en";
}

/**
 * Adresse réelle d'un sous-titre. Quand le provider n'a donné qu'un gabarit
 * (`…/srtproxy/<code>_fre.vtt`, sans signature), le fichier répond 400 : la
 * vraie adresse (avec `?dx=…&srv=…&disk=…`) est dans le HTML de son lecteur.
 * On lit donc la page, puis l'embed qu'elle contient.
 */
export async function resolveSubtitleUrl(url: string, pageUrl?: string): Promise<string> {
  if (!pageUrl) return url;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: "https://vidzy.cc/",
  };
  const code = /srtproxy\/([a-z0-9]+)_fre\.vtt/i.exec(url)?.[1];
  if (!code) return url;
  const pattern = new RegExp(`srtproxy/${code}_fre\\.vtt\\?[^"'\\s]*`, "i");

  const read = async (target: string): Promise<string | null> => {
    const response = await fetch(target, { headers, redirect: "follow", cache: "no-store" }).catch(() => null);
    if (!response || !response.ok) return null;
    const html = await response.text();
    // Le provider peut servir le HTML compressé en `br`/`deflate` : on le
    // décode à la main, sinon `pattern` ne trouve rien (et `byteString()` rend
    // du binaire).
    const full = pattern.exec(await decoded(html, response))?.[0];
    if (!full) return null;
    return full.startsWith("http") ? full : `https://vidzy.cc/${full}`;
  };

  const direct = await read(pageUrl);
  if (direct) return direct;
  // La page série contient l'iframe du lecteur : l'adresse y est aussi.
  const shell = await fetch(pageUrl, { headers, redirect: "follow", cache: "no-store" }).catch(() => null);
  const iframe = shell && shell.ok
    ? /<iframe[^>]+src=["']([^"']*\/embed-[^"']+)["']/i.exec(await shell.text())?.[1]
    : undefined;
  if (iframe) {
    const fromEmbed = await read(iframe.startsWith("http") ? iframe : `https://vidzy.cc/${iframe.replace(/^\//, "")}`);
    if (fromEmbed) return fromEmbed;
  }
  return url;
}

/** Corps d'une réponse, décompressé si le serveur l'a renvoyé compressé. */
async function decoded(body: string, response: Response): Promise<string> {
  const encoding = response.headers.get("content-encoding") ?? "";
  if (!encoding || encoding === "identity") return body;
  try {
    const raw = Buffer.from(body, "binary");
    const { brotliDecompressSync, inflateSync, gunzipSync } = await import("node:zlib");
    const buffer = encoding.includes("br") ? brotliDecompressSync(raw)
      : encoding.includes("gzip") ? gunzipSync(raw)
        : inflateSync(raw);
    return buffer.toString("utf8");
  } catch {
    return body;
  }
}

async function fetchVtt(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://vidzy.cc/",
      Accept: "text/vtt,text/plain,*/*",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`VTT ${response.status}`);
  return response.text();
}

/** Traduit un lot de répliques (MyMemory accepte ~500 caractères par appel). */
async function translateBatch(texts: string[], source: "en" | "auto"): Promise<string[]> {
  const joined = texts.join("\n");
  const query = joined.slice(0, 1_800);
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=${source}|fr`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return texts;
  const data = (await response.json()) as { responseData?: { translatedText?: string } };
  const translated = data.responseData?.translatedText;
  if (!translated || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(translated)) return texts;
  const parts = translated.replace(/\r/g, "").split("\n");
  return texts.map((original, position) => parts[position]?.trim() || original);
}

/**
 * Renvoie le VTT en français : tel quel s'il est déjà français, traduit sinon.
 */
export async function translateVtt(url: string, pageUrl?: string): Promise<string> {
  const real = await resolveSubtitleUrl(url, pageUrl);
  const body = await fetchVtt(real);
  const { header, cues } = parseVtt(body);
  if (cues.length === 0) return body;
  const texts = cues.map(cueText);
  const language = guessLanguage(texts.join(" "));
  if (language === "fr") return body;
  // Piste « autre » (catalan…) : on laisse le texte d'origine, faute de mieux.
  if (language === "other") return body;

  const translated: string[] = [];
  const batchSize = 12;
  for (let start = 0; start < texts.length; start += batchSize) {
    const slice = texts.slice(start, start + batchSize);
    try {
      translated.push(...await translateBatch(slice, "en"));
    } catch {
      translated.push(...slice);
    }
  }

  const out: string[] = header.trim() ? header.split("\n") : ["WEBVTT", ""];
  while (out.length && out[out.length - 1] === "") out.pop();
  out.push("");
  cues.forEach((cue, position) => {
    out.push(String(position + 1));
    out.push(cue.lines[0]);
    const line = translated[position] || cueText(cue);
    out.push(line);
    out.push("");
  });
  return out.join("\n");
}

export const __subtitleInternals = { FRENCH };
