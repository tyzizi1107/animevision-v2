/**
 * VOE (voe.sx, teresapoliticallearn.com…) — portage TypeScript de
 * `extract_voe_video_source.py` du projet FrenchAnime-Downloader.
 *
 * La page renvoie un `<script type="application/json">["<payload>"]</script>`
 * qui contient le vrai JSON, chiffré par couches successives :
 *   rot13 → retrait de jetons → base64 → décalage de +3 sur chaque caractère
 *   → inversion → base64 → JSON { source, direct_access_url }.
 */

import { BASE_HEADERS, fetchText } from "./types";

const OPERATORS = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];

function rot13(value: string): string {
  return value.replace(/[a-zA-Z]/g, (character) => {
    const code = character.charCodeAt(0);
    const base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

function fromBase64(value: string): string {
  try {
    return Buffer.from(value, "base64").toString("latin1");
  } catch {
    return "";
  }
}

function shiftBack(value: string): string {
  let result = "";
  for (const character of value) result += String.fromCharCode(character.charCodeAt(0) - 3);
  return result;
}

/** Décode le payload VOE ; renvoie `null` si la structure a changé. */
export function decodeVoePayload(payload: string): { source?: string; direct_access_url?: string } | null {
  try {
    let text = rot13(payload);
    for (const operator of OPERATORS) text = text.split(operator).join("");
    text = fromBase64(text);
    if (!text) return null;
    text = shiftBack(text).split("").reverse().join("");
    text = fromBase64(text);
    if (!text) return null;
    return JSON.parse(text) as { source?: string; direct_access_url?: string };
  } catch {
    return null;
  }
}

/** VOE : page embed → URL directe (mp4/HLS), en suivant un éventuel saut JS. */
/** VOE fait tourner son domaine à chaque requête : on borne le nombre de sauts. */
const MAX_HOPS = 6;

export async function extractVoeSource(url: string, signal: AbortSignal, hop = 0): Promise<string | null> {
  if (hop > MAX_HOPS) return null;
  // Pas de `Referer` : VOE (et uqload) répondent « restricted » dès qu'on en
  // envoie un, même celui du site qui l'héberge.
  const page = await fetchText(url, { signal, timeoutMs: 7_000, headers: { ...BASE_HEADERS } });
  if (process.env.PROVIDER_DEBUG === "1") {
    console.log("[voe]", url.slice(0, 44), page ? `${page.status} ${page.text.length}o loc=${page.location ?? "-"}` : "null");
  }
  // Redirection HTTP (302) : `fetchText` ne la suit pas, on la suit nous-mêmes.
  if (page && page.status >= 300 && page.status < 400 && page.location) {
    const next = new URL(page.location, url).toString();
    if (next !== url) return extractVoeSource(next, signal, hop + 1);
  }
  if (!page?.ok) return null;

  // Redirection posée en JS. VOE change de domaine en permanence : la page
  // « Redirecting… » peut écrire `window.location.href = "…"` OU passer par
  // `new URL(...)` puis `currentUrl.toString()`. On suit la première URL
  // absolue trouvée qui n'est pas la page elle-même (une seule fois).
  if (page.text.length < 4_000 && !/<script type="application\/json">/i.test(page.text)) {
    const scriptUrls = [...page.text.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((match) => match[0].replace(/[.,;]+$/, ""));
    const redirect = scriptUrls.find((candidate) => candidate !== url && candidate !== page.url);
    if (redirect) return extractVoeSource(redirect, signal, hop + 1);
  }

  const jsonBlock = /<script type="application\/json">\s*(\[[\s\S]*?\])\s*<\/script>/i.exec(page.text);
  if (jsonBlock) {
    try {
      const list = JSON.parse(jsonBlock[1]!) as unknown[];
      if (Array.isArray(list) && list.length > 0 && typeof list[0] === "string") {
        const decoded = decodeVoePayload(list[0]);
        // `direct_access_url` (MP4) est plus stable que le HLS signé.
        const stream = decoded?.direct_access_url ?? decoded?.source;
        if (stream && !/bigbuckbunny|sample/i.test(stream)) return stream;
      }
    } catch {
      // payload illisible : on tente les m3u8 de la page
    }
  }

  const direct = /["'](https?:\/\/[^\s'"]+\.m3u8[^\s'"]*)["']/i.exec(page.text)?.[1];
  if (direct && !/bigbuckbunny|sample/i.test(direct)) return direct;
  return null;
}
