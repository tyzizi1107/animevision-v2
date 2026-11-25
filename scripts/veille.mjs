/**
 * Veille des nouveautés Franime + Anime-Sama, hors du serveur Next.
 *
 *   node scripts/veille.mjs                # une passe
 *   node scripts/veille.mjs --minutes=5    # boucle, une passe toutes les 5 min
 *
 * Le serveur Next lance déjà cette passe tout seul (`instrumentation.ts`).
 * Ce script sert pour un cron système :
 *   toutes les 10 min (crontab) : 10 * * * * cd ~/Bureau/site && node scripts/veille.mjs
 *
 * Il appelle la route /api/administration/veille du serveur, avec un jeton
 * d'administration (`VEILLE_TOKEN` dans .env.local) : la logique reste en un
 * seul endroit, côté application.
 */
import { readFileSync } from "node:fs";

function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n")) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        const value = match[2].replace(/^["']|["']$/g, "");
        if (!process.env[match[1]]) process.env[match[1]] = value;
      }
    } catch {
      // fichier absent
    }
  }
}
loadEnvFiles();

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "1"];
  }),
);
const MINUTES = Number.parseInt(args.get("minutes") ?? "0", 10);
const BASE = process.env.SITE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const TOKEN = process.env.VEILLE_TOKEN || "";

if (!TOKEN) {
  console.error("VEILLE_TOKEN absent de .env.local : ajoute une chaîne secrète, identique à celle du serveur.");
  process.exit(1);
}

async function runOnce() {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${BASE}/api/administration/veille`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(290_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`[veille] ${response.status} : ${result.error || "échec"}`);
      return;
    }
    console.log(
      `[veille] ${new Date().toLocaleTimeString("fr-FR")} — `
      + `${result.refreshed?.length ?? 0} fiche(s) réécrite(s), `
      + `${result.newAnimeSama?.length ?? 0} nouveauté(s) Anime-Sama, `
      + `${Math.round((Date.now() - startedAt) / 1000)} s`
      + (result.errors?.length ? ` · ${result.errors.join(" · ")}` : ""),
    );
  } catch (error) {
    console.error(`[veille] serveur injoignable (${BASE}) :`, error instanceof Error ? error.message : error);
  }
}

await runOnce();
if (MINUTES > 0) {
  console.log(`[veille] nouvelle passe toutes les ${MINUTES} min. Ctrl+C pour arrêter.`);
  setInterval(() => void runOnce(), MINUTES * 60_000);
}
