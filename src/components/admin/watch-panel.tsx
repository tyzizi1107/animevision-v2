"use client";

import { useCallback, useEffect, useState } from "react";

type FreshnessState = {
  franimeFetchedAt?: string | null;
  animeSamaFetchedAt?: string | null;
  lastRunAt?: string | null;
  lastRunMs?: number | null;
  lastError?: string | null;
  lastRefreshed?: number;
  lastRefreshedTitles?: string[];
};

type Status = {
  state: FreshnessState | null;
  intervalMinutes: number;
  auto: boolean;
  running: boolean;
};

type RunResult = {
  refreshed: Array<{ id: string; titre: string }>;
  newAnimeSama: Array<{ title: string; episode: number; language: string; saison: string; airsAt: string; url: string }>;
  errors: string[];
  durationMs: number;
};

function when(value?: string | null): string {
  if (!value) return "jamais";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "jamais";
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function WatchPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/administration/veille", { cache: "no-store" });
      if (!response.ok) return;
      setStatus(await response.json());
    } catch {
      // serveur momentanément indisponible
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const runNow = async () => {
    setRunning(true);
    setMessage("Vérification de Franime et Anime-Sama…");
    try {
      const response = await fetch("/api/administration/veille", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "La vérification a échoué.");
      setResult(data as RunResult);
      setMessage(
        `Terminé en ${Math.round((data.durationMs ?? 0) / 1000)} s : `
        + `${data.refreshed?.length ?? 0} fiche(s) réécrite(s), ${data.newAnimeSama?.length ?? 0} nouveauté(s) Anime-Sama.`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur.");
    } finally {
      setRunning(false);
    }
  };

  const state = status?.state ?? null;
  const auto = status?.auto ?? false;
  const minutes = status?.intervalMinutes ?? 10;

  return (
    <div className="grid gap-5">
      <section className="rounded-2xl border border-line bg-[#0c0b10] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">Veille des nouveautés</h2>
            <p className="mt-1 max-w-2xl text-sm text-white/55">
              Toutes les {minutes} minutes, le site relit le catalogue Franime et le planning Anime-Sama,
              réécrit les épisodes des séries qui ont bougé et met à jour la rubrique « Derniers épisodes ».
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runNow()}
            disabled={running}
            className="h-10 rounded-full bg-brand px-5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {running ? "Vérification…" : "Vérifier maintenant"}
          </button>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Automatique", value: auto ? `Toutes les ${minutes} min` : "Désactivée (VEILLE_AUTO=0)" },
            { label: "Dernière passe", value: when(state?.lastRunAt) },
            { label: "Catalogue Franime lu", value: when(state?.franimeFetchedAt) },
            { label: "Planning Anime-Sama lu", value: when(state?.animeSamaFetchedAt) },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-line/70 bg-white/[0.02] px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{item.label}</dt>
              <dd className="mt-1 text-sm font-semibold text-white">{item.value}</dd>
            </div>
          ))}
        </dl>

        {message ? <p className="mt-4 text-sm text-white/70">{message}</p> : null}
        {state?.lastError ? (
          <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-4 py-3 text-xs text-amber-100">
            Dernière erreur : {state.lastError}
          </p>
        ) : null}
      </section>

      {(result?.refreshed?.length ?? 0) > 0 || (state?.lastRefreshedTitles?.length ?? 0) > 0 ? (
        <section className="rounded-2xl border border-line bg-[#0c0b10] p-5">
          <h3 className="text-sm font-bold uppercase tracking-wide text-white/60">Fiches mises à jour</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {(result?.refreshed?.map((entry) => entry.titre) ?? state?.lastRefreshedTitles ?? []).map((titre) => (
              <li key={titre} className="rounded-full border border-line bg-white/[0.03] px-3 py-1 text-xs text-white/75">{titre}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {result && result.newAnimeSama.length > 0 ? (
        <section className="rounded-2xl border border-line bg-[#0c0b10] p-5">
          <h3 className="text-sm font-bold uppercase tracking-wide text-white/60">Nouveautés Anime-Sama</h3>
          <ul className="mt-3 grid gap-2">
            {result.newAnimeSama.map((entry) => (
              <li key={`${entry.title}-${entry.saison}-${entry.language}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/70 px-4 py-2 text-sm">
                <span className="font-semibold text-white">{entry.title}</span>
                <span className="text-xs text-white/55">
                  {entry.saison ? `Saison ${entry.saison} · ` : ""}
                  {entry.language === "vf" ? "VF" : "VOSTFR"}
                  {entry.episode ? ` · épisode ${entry.episode}` : ""}
                  {" · "}
                  {new Date(entry.airsAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
