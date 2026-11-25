import { execFile } from "node:child_process";
import path from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
// Même User-Agent que les fournisseurs : avec une version de Chrome récente,
// le CDN de Vidzy renvoie une playlist de variantes au lieu des segments.
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 20_000;

/**
 * CDN qui filtrent sur l'empreinte TLS : un `fetch` Node récolte un `403 nginx`
 * là où une empreinte Chrome passe. Pour ces hôtes, la requête part par
 * `scripts/curl-impersonate.py` (`curl_cffi`, `impersonate="chrome"`).
 */
const IMPERSONATE_HOSTS = /(?:tnmr\.org|owphbf24\.com|cloudwindow-route\.com|sprintcdn\.|vmnow\.online|vmget\.online)$/i;
const IMPERSONATE_SCRIPT = path.join(process.cwd(), "scripts", "curl-impersonate.py");
const IMPERSONATE_PYTHON = process.env.CURL_CFFI_PYTHON ?? "python3";

type RelayResult = { ok: boolean; status: number; contentType: string; body: Buffer; headers: Record<string, string> };

/** Relaie une URL via `curl_cffi` (empreinte TLS Chrome). `null` = indisponible. */
function relayWithImpersonation(
  url: string,
  options: { referer?: string | null; origin?: string | null; userAgent?: string | null; range?: string | null },
): Promise<RelayResult | null> {
  const args = [IMPERSONATE_SCRIPT, url];
  if (options.referer) args.push("--referer", options.referer);
  if (options.origin) args.push("--origin", options.origin);
  if (options.userAgent) args.push("--user-agent", options.userAgent);
  if (options.range) args.push("--range", options.range);

  return new Promise((resolve) => {
    execFile(
      IMPERSONATE_PYTHON,
      args,
      { timeout: TIMEOUT_MS + 5_000, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
      (error, stdout, stderr) => {
        if (error) {
          // Code 3 = curl_cffi absent : on laisse l'appelant retomber sur fetch.
          if ((error as NodeJS.ErrnoException & { code?: number }).code !== 0) resolve(null);
          return;
        }
        const meta = stderr.toString("utf8");
        const status = Number.parseInt(/^status:\s*(\d+)/m.exec(meta)?.[1] ?? "0", 10);
        if (!status) {
          resolve(null);
          return;
        }
        const header = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "mi").exec(meta)?.[1]?.trim() ?? "";
        resolve({
          ok: status >= 200 && status < 300,
          status,
          contentType: header("content-type"),
          body: stdout,
          headers: {
            "content-range": header("content-range"),
            "accept-ranges": header("accept-ranges"),
          },
        });
      },
    );
  });
}

/**
 * Un master à variantes ne doit être renvoyé intact que si ses URI RELATIVES
 * se résolvent depuis la racine de son dossier. Vidzy nomme `master.m3u8`
 * aussi bien son master (`…/,code_n,.urlset/master.m3u8`) que sa playlist de
 * segments (`…/troll/master.m3u8`, `…/,code/master.m3u8`) : seule la première
 * forme reste intacte, l'autre est réécrite pour que ses segments passent par
 * le proxy — sinon le lecteur ne lit qu'un fichier de quelques secondes.
 */
function isMasterPlaylist(body: string, url: URL): boolean {
  if (!/#EXT-X-STREAM-INF/i.test(body)) return false;
  return /\/\.urlset\/master\.m3u8$/i.test(url.pathname);
}

function rewritePlaylist(body: string, baseUrl: string, requestUrl: URL): string {
  const proxyFor = (target: string) => {
    const absolute = new URL(target, baseUrl);
    const params = new URLSearchParams({ url: absolute.toString() });
    for (const key of ["referer", "origin", "user-agent"]) {
      const value = requestUrl.searchParams.get(key);
      if (value) params.set(key, value);
    }
    return `/api/proxy?${params.toString()}`;
  };

  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        // Réécrit les URI absolues à l'intérieur des balises HLS (clés, médias).
        const rewritten = line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${proxyFor(uri)}"`);

        // Sous-titres : certains masters (shaka-packager) déclarent
        // une piste anglaise en `DEFAULT=YES`, que hls.js active d'office — le
        // navigateur affiche alors « English » et lance les sous-titres sans
        // qu'on l'ait demandé. On neutralise ce défaut, sauf pour le français.
        if (rewritten.startsWith("#EXT-X-MEDIA:") && /TYPE=SUBTITLES/i.test(rewritten)) {
          const isFrench = /LANGUAGE="(?:fr|fre|fra)/i.test(rewritten);
          // On nettoie aussi les virgules doublées (`NAME="FR Forced",,AUTO…`).
          const withoutDefault = rewritten
            .replace(/,?DEFAULT=(?:YES|NO)/gi, "")
            .replace(/,{2,}/g, ",")
            .replace(/,\s*$/, "");
          return `${withoutDefault},DEFAULT=${isFrench ? "YES" : "NO"}`;
        }
        return rewritten;
      }
      // Ligne de playlist (variante ou piste) : servie en direct, voir plus haut.
      return proxyFor(trimmed);
    })
    .join("\n");
}

/**
 * GET /api/proxy?url=…&referer=…&origin=…
 * Relaie un flux m3u8 / mp4 / mpd en ajoutant les en-têtes exigés par
 * l'hébergeur (Referer, Origin, User-Agent) et en réécrivant les playlists HLS
 * pour que segments et clés passent eux aussi par le proxy.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  // `raw=1` : le master part intact (ses URI relatives sont résolues par le
  // navigateur). Seul le MASTER, jamais une playlist de segments : celle-ci
  // doit passer par le proxy, sinon les segments sont demandés en direct au CDN
  // (sans en-têtes, bloqués par ORB) et le lecteur ne peut rien analyser.
  const rawRequested = requestUrl.searchParams.get("raw") === "1";
  const rawUrl = requestUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "Paramètre « url » requis." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "URL invalide." }, { status: 400 });
  }
  if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
    return NextResponse.json({ error: "Protocole non autorisé." }, { status: 400 });
  }

  const headers: Record<string, string> = {
    "User-Agent": requestUrl.searchParams.get("user-agent") ?? DEFAULT_UA,
    Accept: "*/*",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  };
  const referer = requestUrl.searchParams.get("referer");
  const origin = requestUrl.searchParams.get("origin");
  if (referer) headers.Referer = referer;
  if (origin) headers.Origin = origin;
  const range = request.headers.get("range");
  if (range) headers.Range = range;

  if (IMPERSONATE_HOSTS.test(target.hostname)) {
    const relayed = await relayWithImpersonation(target.toString(), {
      referer,
      origin,
      userAgent: headers["User-Agent"],
      range,
    });
    if (relayed) {
      if (!relayed.ok && relayed.status !== 206) {
        return NextResponse.json(
          { error: `Flux indisponible (HTTP ${relayed.status}).` },
          { status: relayed.status === 404 ? 404 : 502 },
        );
      }
      const isPlaylist = /mpegurl/i.test(relayed.contentType) || /\.m3u8(?:[?#]|$)/i.test(target.pathname + target.search);
      const raw = rawRequested && isMasterPlaylist(relayed.body.toString("utf8"), target);
      if (isPlaylist) {
        return new NextResponse(raw ? relayed.body.toString("utf8") : rewritePlaylist(relayed.body.toString("utf8"), target.toString(), requestUrl), {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      const passthrough = new Headers({
        "Content-Type": relayed.contentType || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "private, max-age=300",
      });
      for (const [key, value] of Object.entries(relayed.headers)) {
        if (value) passthrough.set(key, value);
      }
      return new NextResponse(new Uint8Array(relayed.body), { status: relayed.status, headers: passthrough });
    }
  }

  try {
    const response = await fetch(target, {
      headers,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok && response.status !== 206) {
      return NextResponse.json({ error: `Flux indisponible (HTTP ${response.status}).` }, { status: response.status === 404 ? 404 : 502 });
    }

    const contentType = response.headers.get("content-type") ?? "";
    const isPlaylist = /mpegurl/i.test(contentType) || /\.m3u8(?:[?#]|$)/i.test(target.pathname + target.search);

    if (isPlaylist) {
      const body = await response.text();
      const raw = rawRequested && isMasterPlaylist(body, target);
      return new NextResponse(raw ? body : rewritePlaylist(body, response.url || target.toString(), requestUrl), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const passthrough = new Headers();
    for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
      const value = response.headers.get(key);
      if (value) passthrough.set(key, value);
    }
    passthrough.set("Access-Control-Allow-Origin", "*");
    passthrough.set("Cache-Control", "private, max-age=300");
    return new NextResponse(response.body, { status: response.status, headers: passthrough });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[api/proxy]", message);
    return NextResponse.json({ error: "Impossible de relayer ce flux." }, { status: 502 });
  }
}
