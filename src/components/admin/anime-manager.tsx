"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/icons";
import type { AnimeDetail, AnimeEpisode, AnimeSeason, AnimeSummary, AnimeSource } from "@/lib/anime-types";
import { cn } from "@/lib/utils";

type SourceDraft = { lecteur: string; lien: string };
type EpisodeDraft = {
  number: number;
  titre: string;
  airDate: string;
  overview: string;
  still: string;
  runtime: string;
  vo: SourceDraft[];
  vf: SourceDraft[];
};
type SeasonDraft = { slug: string; name: string; affiche: string; episodes: EpisodeDraft[] };
type AnimeDraft = {
  id: string;
  titre: string;
  synopsis: string;
  affiche: string;
  banniere: string;
  logo: string;
  genres: string;
  autresNoms: string;
  date: string;
  seasons: SeasonDraft[];
};

function sourceDrafts(sources: AnimeSource[]): SourceDraft[] {
  return sources.map(({ lecteur, lien }) => ({ lecteur, lien }));
}

function episodeDraft(episode: AnimeEpisode): EpisodeDraft {
  return {
    number: episode.number,
    titre: episode.titre ?? "",
    airDate: episode.airDate ?? "",
    overview: episode.overview ?? "",
    still: episode.still ?? "",
    runtime: episode.runtime ? String(episode.runtime) : "",
    vo: sourceDrafts(episode.vo),
    vf: sourceDrafts(episode.vf),
  };
}

function draftFromAnime(anime: AnimeDetail): AnimeDraft {
  return {
    id: anime.id,
    titre: anime.titre,
    synopsis: anime.synopsis,
    affiche: anime.affiche ?? "",
    banniere: anime.banniere ?? "",
    logo: anime.logo ?? "",
    genres: anime.genres.join(", "),
    autresNoms: anime.autresNoms.join(", "),
    date: anime.date.slice(0, 10),
    seasons: anime.seasons.map((season: AnimeSeason) => ({
      slug: season.slug,
      name: season.name,
      affiche: season.affiche ?? "",
      episodes: season.episodes.map(episodeDraft),
    })),
  };
}

function emptyEpisode(number: number): EpisodeDraft {
  return { number, titre: "", airDate: "", overview: "", still: "", runtime: "", vo: [], vf: [] };
}

export function AnimeManager({ initialAnimeId }: { initialAnimeId?: string } = {}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AnimeSummary[]>([]);
  const [draft, setDraft] = useState<AnimeDraft | null>(null);
  const [expandedSeasons, setExpandedSeasons] = useState<Record<number, boolean>>({});
  const [episodePages, setEpisodePages] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");

  const loadList = async (search = "") => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/administration/animes?q=${encodeURIComponent(search)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Impossible de charger le catalogue.");
      setItems(payload.animes ?? []);
      if (payload.notice) setNotice(String(payload.notice));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialAnimeId) void selectAnime({ id: initialAnimeId });
    else void loadList();
    // The selected anime is loaded once when this editor is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAnimeId]);

  const selectAnime = async (anime: Pick<AnimeSummary, "id">) => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/administration/animes?id=${anime.id}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.anime) throw new Error(payload.error || "Impossible d'ouvrir cette fiche.");
      setDraft(draftFromAnime(payload.anime));
      if (payload.notice) setNotice(String(payload.notice));
      setExpandedSeasons({ 0: true });
      setEpisodePages({});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    setMessage("");
    const payload = {
      ...draft,
      genres: draft.genres.split(",").map((item) => item.trim()).filter(Boolean),
      autresNoms: draft.autresNoms.split(",").map((item) => item.trim()).filter(Boolean),
      seasons: draft.seasons.map((season) => ({
        ...season,
        episodes: season.episodes.map((episode) => ({
          ...episode,
          vo: episode.vo.filter((source) => source.lien.trim()),
          vf: episode.vf.filter((source) => source.lien.trim()),
        })),
      })),
    };
    try {
      const response = await fetch("/api/administration/animes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.anime) throw new Error(result.error || "La fiche n'a pas pu être enregistrée.");
      setDraft(draftFromAnime(result.anime));
      setItems((current) => current.map((item) => item.id === result.anime.id ? result.anime : item));
      setMessage("Fiche enregistrée.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur pendant l'enregistrement.");
    } finally {
    }
  };

  const resetOverride = async () => {
    if (!draft || !window.confirm("Annuler toutes les modifications de cette fiche et revenir aux données TMDB ?")) return;
    setMessage("");
    try {
      const response = await fetch(`/api/administration/animes?id=${encodeURIComponent(draft.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok || !result.anime) throw new Error(result.error || "Impossible d'annuler les modifications.");
      setDraft(draftFromAnime(result.anime));
      setMessage("Fiche remise aux données TMDB.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur.");
    }
  };

  const updateDraft = (change: Partial<AnimeDraft>) => setDraft((current) => current ? { ...current, ...change } : current);
  const updateSeason = (seasonIndex: number, change: Partial<SeasonDraft>) => {
    if (!draft) return;
    updateDraft({ seasons: draft.seasons.map((season, index) => index === seasonIndex ? { ...season, ...change } : season) });
  };
  const updateEpisode = (seasonIndex: number, episodeIndex: number, change: Partial<EpisodeDraft>) => {
    if (!draft) return;
    const seasons = draft.seasons.map((season, index) => index === seasonIndex
      ? { ...season, episodes: season.episodes.map((episode, eIndex) => eIndex === episodeIndex ? { ...episode, ...change } : episode) }
      : season);
    updateDraft({ seasons });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-brand/30 bg-brand/[0.07] px-4 py-3 text-xs leading-5 text-white/80">
        <p className="font-bold text-white">Catalogue TMDB — modifications locales</p>
        <p className="mt-1">{notice || "Les données viennent de TMDB ; tes modifications sont enregistrées à part et remplacent l'affichage du site. Tu peux les annuler à tout moment."}</p>
      </section>
      {!initialAnimeId && <section className="rounded-3xl border border-line bg-panel/50 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void loadList(query); } }}
            placeholder="Rechercher un animé…"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-black/20 px-4 text-sm text-white outline-none focus:border-brand/60"
          />
          <button type="button" onClick={() => void loadList(query)} aria-label="Rechercher un animé" title="Rechercher" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-white transition hover:brightness-110">
            <SearchIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {items.map((anime) => (
            <button
              type="button"
              key={anime.id}
              onClick={() => void selectAnime(anime)}
              className={cn("max-w-52 shrink-0 rounded-xl border px-3 py-2 text-left text-xs transition", draft?.id === anime.id ? "border-brand bg-brand/15 text-white" : "border-line text-muted hover:border-white/25 hover:text-white")}
            >
              <span className="block truncate font-semibold">{anime.titre}</span>
              <span className="mt-1 block text-[10px] text-muted">{anime.type}</span>
            </button>
          ))}
          {!items.length && <p className="py-2 text-xs text-muted">{loading ? "Chargement…" : "Aucun animé trouvé."}</p>}
        </div>
        <p className="mt-2 text-[10px] text-muted">{items.length === 100 ? "100 résultats maximum : précise ta recherche pour affiner." : `${items.length} résultat${items.length === 1 ? "" : "s"}`}</p>
      </section>}

      {message && <p role="status" className="rounded-xl border border-brand/30 bg-brand/10 px-4 py-3 text-sm text-white">{message}</p>}
      {initialAnimeId && loading && !draft && <p role="status" className="rounded-xl border border-line bg-black/15 px-4 py-5 text-sm text-muted">Chargement de la fiche anime…</p>}

      {draft && (
        <form onSubmit={save} className="space-y-6">
          <section className="rounded-3xl border border-line bg-panel/50 p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-lg font-bold text-white">Fiche de l’animé</h2><p className="text-xs text-muted">Les champs modifiés remplacent TMDB sur le site.</p></div>
              <button type="button" onClick={() => void resetOverride()} className="h-10 rounded-full border border-red-400/30 px-5 text-xs font-semibold text-red-200 hover:bg-red-500/10">Revenir aux données TMDB</button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Titre"><input value={draft.titre} onChange={(e) => updateDraft({ titre: e.target.value })} required className={inputClass} /></Field>
              <Field label="Date"><input value={draft.date} onChange={(e) => updateDraft({ date: e.target.value })} placeholder="AAAA-MM-JJ" className={inputClass} /></Field>
              <Field label="Affiche TMDB (URL)" wide><input value={draft.affiche} onChange={(e) => updateDraft({ affiche: e.target.value })} className={inputClass} /></Field>
              {draft.affiche && <div className="sm:col-span-2 rounded-xl border border-line bg-black/25 p-4"><p className="mb-2 text-[11px] font-semibold text-muted">Aperçu de l’affiche</p><img src={draft.affiche} alt={`Affiche de ${draft.titre}`} className="h-44 w-32 rounded-lg object-cover" /></div>}
              <Field label="Bannière TMDB (URL)" wide><input value={draft.banniere} onChange={(e) => updateDraft({ banniere: e.target.value })} className={inputClass} /></Field>
              {draft.banniere && <div className="sm:col-span-2 rounded-xl border border-line bg-black/25 p-4"><p className="mb-2 text-[11px] font-semibold text-muted">Aperçu de la bannière</p><img src={draft.banniere} alt={`Bannière de ${draft.titre}`} className="aspect-[16/6] w-full max-w-3xl rounded-lg object-cover" /></div>}
              <Field label="Logo de l’animé (URL)" wide><input value={draft.logo} onChange={(e) => updateDraft({ logo: e.target.value })} placeholder="https://… (laisser vide pour le titre texte)" className={inputClass} /></Field>
              {draft.logo && <div className="sm:col-span-2 rounded-xl border border-line bg-black/25 p-4"><p className="mb-2 text-[11px] font-semibold text-muted">Aperçu du logo</p><img src={draft.logo} alt={`Logo de ${draft.titre}`} className="max-h-20 max-w-full object-contain object-left" /></div>}
              <Field label="Genres (séparés par des virgules)"><input value={draft.genres} onChange={(e) => updateDraft({ genres: e.target.value })} className={inputClass} /></Field>
              <Field label="Autres titres (séparés par des virgules)"><input value={draft.autresNoms} onChange={(e) => updateDraft({ autresNoms: e.target.value })} className={inputClass} /></Field>
              <Field label="Synopsis" wide><textarea value={draft.synopsis} onChange={(e) => updateDraft({ synopsis: e.target.value })} rows={4} className={inputClass} /></Field>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-black text-white">Saisons et épisodes <span className="text-sm font-medium text-muted">({draft.seasons.length})</span></h2>
            <div className="flex flex-wrap items-center gap-2">
              {/* Une fiche peut venir de TMDB comme série alors que c'est un
                  film : sans ce réglage, ses « saisons » ne pouvaient pas être
                  retirées, elles revenaient à chaque enregistrement. */}
              <button type="button" onClick={() => {
                if (!window.confirm("Vider toutes les saisons et épisodes de cette fiche ? (les corrections de saisons sont mémorisées)")) return;
                updateDraft({ seasons: [] });
                setExpandedSeasons({});
                setEpisodePages({});
              }} className="h-10 rounded-xl border border-red-400/30 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/10">Vider toutes les saisons</button>
              <button type="button" onClick={() => {
                const nextIndex = draft.seasons.length;
                updateDraft({ seasons: [...draft.seasons, { slug: `saison-${nextIndex + 1}`, name: `Saison ${nextIndex + 1}`, affiche: "", episodes: [] }] });
                setExpandedSeasons((current) => ({ ...current, [nextIndex]: true }));
              }} className={secondaryButton}>＋ Ajouter une saison</button>
            </div>
          </div>

          {draft.seasons.map((season, seasonIndex) => {
            const isExpanded = expandedSeasons[seasonIndex] ?? seasonIndex === 0;
            const pageSize = 20;
            const pageCount = Math.max(1, Math.ceil(season.episodes.length / pageSize));
            const page = Math.min(episodePages[seasonIndex] ?? 0, pageCount - 1);
            const visibleEpisodes = season.episodes
              .map((episode, episodeIndex) => ({ episode, episodeIndex }))
              .slice(page * pageSize, (page + 1) * pageSize);
            return (
            <section key={`${seasonIndex}-${season.name}`} className="rounded-3xl border border-line bg-panel/40 p-4 sm:p-6">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Nom de la saison"><input value={season.name} onChange={(e) => updateSeason(seasonIndex, { name: e.target.value })} className={inputClass} /></Field>
                <Field label="Affiche de saison (URL)" wide><input value={season.affiche} onChange={(e) => updateSeason(seasonIndex, { affiche: e.target.value })} className={inputClass} /></Field>
                <button type="button" onClick={() => updateDraft({ seasons: draft.seasons.filter((_, index) => index !== seasonIndex) })} className="h-10 rounded-xl border border-red-400/30 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/10">Supprimer la saison</button>
              </div>
              {season.affiche && <div className="mt-3 rounded-xl border border-line bg-black/25 p-3"><p className="mb-2 text-[11px] font-semibold text-muted">Aperçu de l’affiche de saison</p><img src={season.affiche} alt={`Affiche de ${season.name}`} className="h-40 w-28 rounded-lg object-cover" /></div>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-black/15 px-3 py-2">
                <p className="text-xs font-semibold text-white">{season.episodes.length} épisode{season.episodes.length === 1 ? "" : "s"}</p>
                <button type="button" aria-expanded={isExpanded} onClick={() => setExpandedSeasons((current) => ({ ...current, [seasonIndex]: !isExpanded }))} className="text-xs font-semibold text-brand-2 hover:text-white">
                  {isExpanded ? "Replier les épisodes" : "Afficher les épisodes"}
                </button>
              </div>
              {isExpanded && <>
              <div className="mt-4 space-y-4">
                {visibleEpisodes.map(({ episode, episodeIndex }) => (
                  <article key={`${episodeIndex}-${episode.number}`} className="rounded-2xl border border-line bg-black/20 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-white">Épisode {episode.number}</h3><button type="button" onClick={() => updateSeason(seasonIndex, { episodes: season.episodes.filter((_, index) => index !== episodeIndex) })} className="text-xs text-red-200 hover:text-red-100">Supprimer</button></div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Numéro"><input type="number" min="1" value={episode.number} onChange={(e) => updateEpisode(seasonIndex, episodeIndex, { number: Number(e.target.value) })} className={inputClass} /></Field>
                      <Field label="Titre de l’épisode"><input value={episode.titre} onChange={(e) => updateEpisode(seasonIndex, episodeIndex, { titre: e.target.value })} className={inputClass} /></Field>
                      <Field label="Image de l’épisode (URL)" wide><input value={episode.still} onChange={(e) => updateEpisode(seasonIndex, episodeIndex, { still: e.target.value })} className={inputClass} /></Field>
                      <Field label="Date de diffusion"><input value={episode.airDate} onChange={(e) => updateEpisode(seasonIndex, episodeIndex, { airDate: e.target.value })} placeholder="AAAA-MM-JJ" className={inputClass} /></Field>
                      <Field label="Durée (minutes)"><input type="number" min="1" value={episode.runtime} onChange={(e) => updateEpisode(seasonIndex, episodeIndex, { runtime: e.target.value })} className={inputClass} /></Field>
                      <Field label="Synopsis de l’épisode" wide><textarea rows={2} value={episode.overview} onChange={(e) => updateEpisode(seasonIndex, episodeIndex, { overview: e.target.value })} className={inputClass} /></Field>
                    </div>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      {(["vf", "vo"] as const).map((language) => (
                        <div key={language} className="rounded-xl border border-line p-3">
                          <div className="mb-3 flex items-center justify-between"><h4 className="text-xs font-bold uppercase tracking-wide text-brand-2">Liens {language === "vo" ? "VOSTFR" : "VF"}</h4><button type="button" onClick={() => updateEpisode(seasonIndex, episodeIndex, { [language]: [...episode[language], { lecteur: "", lien: "" }] })} className="text-[11px] font-semibold text-white/80 hover:text-white">＋ Ajouter un lien</button></div>
                          {episode[language].map((source, sourceIndex) => (
                            <div key={sourceIndex} className="mb-2 grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)_auto]">
                              <input aria-label="Nom du lecteur" placeholder="Lecteur" value={source.lecteur} onChange={(e) => {
                                const values = [...episode[language]]; values[sourceIndex] = { ...source, lecteur: e.target.value };
                                updateEpisode(seasonIndex, episodeIndex, { [language]: values });
                              }} className={inputClass} />
                              <input aria-label="Lien de lecture" placeholder="https://…" value={source.lien} onChange={(e) => {
                                const values = [...episode[language]]; values[sourceIndex] = { ...source, lien: e.target.value };
                                updateEpisode(seasonIndex, episodeIndex, { [language]: values });
                              }} className={inputClass} />
                              <button type="button" aria-label="Supprimer le lien" onClick={() => updateEpisode(seasonIndex, episodeIndex, { [language]: episode[language].filter((_, index) => index !== sourceIndex) })} className="h-10 px-2 text-xs text-red-200">Retirer</button>
                            </div>
                          ))}
                          {!episode[language].length && <p className="text-[11px] text-muted">Aucun lien pour le moment.</p>}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              {season.episodes.length > pageSize && (
                <div className="mt-4 flex items-center justify-between rounded-xl border border-line px-3 py-2 text-xs">
                  <button type="button" disabled={page === 0} onClick={() => setEpisodePages((current) => ({ ...current, [seasonIndex]: page - 1 }))} className="font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35">← Précédents</button>
                  <span className="text-muted">Page {page + 1} / {pageCount} · épisodes {page * pageSize + 1}–{Math.min((page + 1) * pageSize, season.episodes.length)}</span>
                  <button type="button" disabled={page >= pageCount - 1} onClick={() => setEpisodePages((current) => ({ ...current, [seasonIndex]: page + 1 }))} className="font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35">Suivants →</button>
                </div>
              )}
              <button type="button" onClick={() => {
                const nextEpisode = emptyEpisode((season.episodes.at(-1)?.number ?? 0) + 1);
                updateSeason(seasonIndex, { episodes: [...season.episodes, nextEpisode] });
                setEpisodePages((current) => ({ ...current, [seasonIndex]: Math.floor(season.episodes.length / pageSize) }));
              }} className={`${secondaryButton} mt-4`}>＋ Ajouter un épisode</button>
              </>}
            </section>
          );})}
          <div className="sticky bottom-4 flex justify-end"><button type="submit" className="h-11 rounded-full bg-brand px-6 text-sm font-bold text-white shadow-lg transition hover:brightness-110">Enregistrer la fiche</button></div>
        </form>
      )}
    </div>
  );
}

const inputClass = "h-10 w-full rounded-xl border border-line bg-black/20 px-3 text-sm text-white outline-none placeholder:text-muted/60 focus:border-brand/60";
const secondaryButton = "inline-flex h-10 items-center justify-center rounded-xl border border-brand/40 bg-brand/10 px-4 text-xs font-bold text-white transition hover:bg-brand/20";

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={cn("block min-w-0 flex-1 space-y-1.5", wide && "sm:col-span-2")}><span className="block text-[11px] font-semibold text-muted">{label}</span>{children}</label>;
}
