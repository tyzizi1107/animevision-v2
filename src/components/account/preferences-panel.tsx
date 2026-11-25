"use client";

import { useEffect, useState } from "react";
import { Alert, Panel, PanelHeader, SaveButton, Toggle, type StatusMessage } from "@/components/account/ui";
import { useAuth } from "@/components/auth/auth-provider";
import { DEFAULT_PREFERENCES, HOME_SECTION_OPTIONS, type HomeSectionId, type Preferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { useAnnouncements } from "@/components/announcements/announcements-provider";

export function PreferencesPanel() {
  const { user, setUser } = useAuth();
  const { testNotifications } = useAnnouncements();
  const [preferences, setPreferences] = useState<Preferences>(user?.preferences ?? DEFAULT_PREFERENCES);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = preferences.appearance;
    root.dataset.textSize = preferences.textSize;
    root.dataset.contrast = preferences.highContrast ? "high" : "normal";
    root.classList.toggle("reduce-motion", preferences.reduceMotion);
  }, [preferences.appearance, preferences.textSize, preferences.highContrast, preferences.reduceMotion]);

  if (!user) return null;

  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value }));
    setStatus(null);
  };

  const updateNotification = (key: keyof Preferences["notifications"], value: boolean) => {
    setPreferences((current) => ({ ...current, notifications: { ...current.notifications, [key]: value } }));
    setStatus(null);
  };

  const updateSection = (id: HomeSectionId, enabled: boolean) => {
    update("homeSections", preferences.homeSections.map((section) => section.id === id ? { ...section, enabled } : section));
  };

  const moveSection = (id: HomeSectionId, direction: -1 | 1) => {
    const index = preferences.homeSections.findIndex((section) => section.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= preferences.homeSections.length) return;
    const reordered = [...preferences.homeSections];
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    update("homeSections", reordered);
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/compte/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences }),
      });
      const payload = (await response.json().catch(() => ({}))) as { user?: typeof user; error?: string };
      if (!response.ok || !payload.user) {
        setStatus({ type: "error", message: payload.error ?? "Enregistrement impossible." });
        return;
      }
      setUser(payload.user);
      setPreferences(payload.user.preferences);
      setStatus({ type: "success", message: "Tes préférences ont été enregistrées." });
    } catch {
      setStatus({ type: "error", message: "Impossible de joindre le serveur." });
    } finally {
      setBusy(false);
    }
  };

  const orderedSections = preferences.homeSections;

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Langue et épisodes" description="Choisis la version qui sera sélectionnée en premier." />
          <div className="mt-4 grid grid-cols-3 gap-2">
            {([
              { id: "auto", label: "Automatique", detail: "VOSTFR puis VF" },
              { id: "vostfr", label: "VOSTFR", detail: "Version sous-titrée" },
              { id: "vf", label: "VF", detail: "Version française" },
            ] as const).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => update("preferredLanguage", option.id)}
                aria-pressed={preferences.preferredLanguage === option.id}
                className={cn("rounded-xl border p-3 text-left transition", preferences.preferredLanguage === option.id ? "border-brand bg-brand text-white shadow-[0_8px_28px_-20px_rgba(65,0,154,0.9)]" : "border-line bg-black/15 text-white/75 hover:border-white/20")}
              >
                <span className="block text-xs font-bold sm:text-sm">{option.label}</span>
                <span className="mt-1 block text-[10px] text-muted">{option.detail}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Sous-titres</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {([
                { id: null, label: "Automatiques", detail: "VOSTFR sous-titré, VF sans" },
                { id: true, label: "Toujours", detail: "Actifs dans les deux versions" },
                { id: false, label: "Jamais", detail: "Désactivés par défaut" },
              ] as const).map((option) => (
                <button
                  key={String(option.id)}
                  type="button"
                  onClick={() => update("subtitlesAuto", option.id)}
                  aria-pressed={preferences.subtitlesAuto === option.id}
                  className={cn("rounded-xl border p-3 text-left transition", preferences.subtitlesAuto === option.id ? "border-brand bg-brand text-white shadow-[0_8px_28px_-20px_rgba(65,0,154,0.9)]" : "border-line bg-black/15 text-white/75 hover:border-white/20")}
                >
                  <span className="block text-xs font-bold sm:text-sm">{option.label}</span>
                  <span className="mt-1 block text-[10px] text-muted">{option.detail}</span>
                </button>
              ))}
            </div>
            <div className="mt-3">
              <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-muted" htmlFor="subtitle-language">
                Langue des sous-titres
              </label>
              <select
                id="subtitle-language"
                value={preferences.subtitleLanguage}
                onChange={(event) => update("subtitleLanguage", event.target.value)}
                className="mt-2 h-10 w-full rounded-lg border border-line bg-black/30 px-3 text-sm text-white outline-none focus:border-brand"
              >
                <option value="auto">Celle du flux (français en priorité)</option>
                <option value="fre">Français</option>
                <option value="eng">Anglais</option>
                <option value="spa">Espagnol</option>
                <option value="por">Portugais</option>
                <option value="ita">Italien</option>
                <option value="ger">Allemand</option>
              </select>
            </div>
          </div>
          <div className="mt-4 border-t border-line pt-1">
            <Toggle
              checked={preferences.showEpisodeDetails}
              onChange={(value) => update("showEpisodeDetails", value)}
              label="Détails des épisodes"
              description="Afficher les titres, dates et durées à la place des informations par défaut dans les listes d’épisodes."
            />
            <Toggle
              checked={preferences.hideEpisodeImages}
              onChange={(value) => update("hideEpisodeImages", value)}
              label="Flouter les images des épisodes"
              description="Flouter les images d’épisodes pour éviter les spoilers visuels."
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Confort d’affichage" description="Adapte les couleurs, la taille du texte et la lisibilité à tes préférences." />
          <div className="mt-4 grid grid-cols-2 gap-2">
            {([
              { id: "dark", label: "Sombre" },
              { id: "light", label: "Clair · fond blanc" },
            ] as const).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => update("appearance", option.id)}
                aria-pressed={preferences.appearance === option.id}
                className={cn("rounded-xl border p-3 text-left text-xs font-bold transition", preferences.appearance === option.id ? "border-brand bg-brand text-white" : "border-line bg-black/15 text-white/75 hover:border-white/20")}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-sm font-medium text-white/90">Taille du texte</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">Agrandis les textes et les éléments dimensionnés en rem.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([
                { id: "normal", label: "Standard", sample: "Aa" },
                { id: "large", label: "Plus grand", sample: "Aa" },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => update("textSize", option.id)}
                  aria-pressed={preferences.textSize === option.id}
                  className={cn("flex items-center justify-between rounded-xl border p-3 text-left transition", preferences.textSize === option.id ? "border-brand bg-brand text-white" : "border-line bg-black/15 text-white/75 hover:border-white/20")}
                >
                  <span className="text-xs font-bold">{option.label}</span>
                  <span className={option.id === "large" ? "text-xl font-black" : "text-base font-black"}>{option.sample}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1 divide-y divide-line">
            <Toggle
              checked={preferences.highContrast}
              onChange={(value) => update("highContrast", value)}
              label="Contraste renforcé"
              description="Rend les textes secondaires, les contours et le focus clavier plus visibles."
            />
            <Toggle
              checked={preferences.reduceMotion}
              onChange={(value) => update("reduceMotion", value)}
              label="Réduire les animations"
              description="Désactiver les transitions et les effets de mouvement."
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Personnaliser l’accueil" description="Active les rubriques que tu veux voir et organise leur ordre d’affichage." />
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {orderedSections.map((section, index) => {
            const option = HOME_SECTION_OPTIONS.find((item) => item.id === section.id)!;
            return (
              <div key={section.id} className={cn("flex min-w-0 items-center gap-2 rounded-2xl border p-3 transition", section.enabled ? "border-line bg-black/15" : "border-line/60 bg-black/[0.08] opacity-65")}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand/15 text-xs font-black text-brand-2">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-white">{option.label}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted">{option.description}</p>
                </div>
                <button type="button" onClick={() => moveSection(section.id, -1)} disabled={index === 0} aria-label={`Monter ${option.label}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:border-brand/40 hover:text-white disabled:opacity-25">↑</button>
                <button type="button" onClick={() => moveSection(section.id, 1)} disabled={index === orderedSections.length - 1} aria-label={`Descendre ${option.label}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:border-brand/40 hover:text-white disabled:opacity-25">↓</button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={section.enabled}
                  aria-label={`${section.enabled ? "Masquer" : "Afficher"} ${option.label}`}
                  onClick={() => updateSection(section.id, !section.enabled)}
                  className={cn("relative h-6 w-11 shrink-0 rounded-full border transition", section.enabled ? "border-transparent bg-brand" : "border-line bg-white/10")}
                ><span className={cn("absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all", section.enabled ? "left-[22px]" : "left-0.5")} /></button>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Catalogue et calendrier" description="Choisis comment les animés sont triés et comment le planning s’ouvre." />
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-white/90">Tri par défaut du catalogue</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">Utilisé quand tu ouvres le catalogue sans choisir de tri.</p>
            <div className="mt-2 grid gap-2">
              {([
                { id: "note", label: "Les mieux notés" },
                { id: "recent", label: "Les plus récents" },
                { id: "az", label: "De A à Z" },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => update("defaultCatalogSort", option.id)}
                  aria-pressed={preferences.defaultCatalogSort === option.id}
                  className={cn("flex min-h-10 items-center justify-between rounded-xl border px-3 text-left text-xs font-semibold transition", preferences.defaultCatalogSort === option.id ? "border-brand bg-brand text-white" : "border-line bg-black/15 text-white/75 hover:border-white/20")}
                >
                  {option.label}
                  {preferences.defaultCatalogSort === option.id && <span aria-hidden="true" className="text-white">✓</span>}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-white/90">Vue d’ouverture du calendrier</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">Tu peux toujours changer de vue directement sur le calendrier.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([
                { id: "timeline", label: "Fil chronologique" },
                { id: "grid", label: "Grille calendrier" },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => update("calendarView", option.id)}
                  aria-pressed={preferences.calendarView === option.id}
                  className={cn("min-h-10 rounded-xl border px-3 text-left text-xs font-semibold transition", preferences.calendarView === option.id ? "border-brand bg-brand text-white" : "border-line bg-black/15 text-white/75 hover:border-white/20")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Lecteur" description="Personnalise le comportement de la lecture." />
          <div className="mt-1 divide-y divide-line">
            <Toggle checked={preferences.playerAutoplay} onChange={(value) => update("playerAutoplay", value)} label="Démarrer la vidéo à l’ouverture" description="La lecture se lance dès que le lecteur est prêt, sans clic sur ▶. Réglable aussi dans le menu du lecteur." />
            <Toggle checked={preferences.playerResume} onChange={(value) => update("playerResume", value)} label="Reprendre où j’en étais" description="Rouvrir l’épisode là où tu l’as arrêté, à la seconde près." />
            <Toggle checked={preferences.playerAutoNext} onChange={(value) => update("playerAutoNext", value)} label="Passer à l’épisode suivant" description="À la fin de l’épisode, lancer le suivant tout seul. Réglable aussi dans le menu du lecteur." />
            <Toggle checked={preferences.playerStartMuted} onChange={(value) => update("playerStartMuted", value)} label="Démarrer sans son" description="Le son revient d’un clic sur l’icône, ou par la jauge de volume." />
            <Toggle checked={preferences.playerAutoHide} onChange={(value) => update("playerAutoHide", value)} label="Masquer les commandes" description="Les commandes disparaissent pendant la lecture." />
            <Toggle checked={preferences.playerAutoSkipIntro} onChange={(value) => update("playerAutoSkipIntro", value)} label="Passer le générique" description="Sauter les 90 premières secondes quand c’est possible." />
          </div>
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Vitesse de lecture</p>
            <div className="grid grid-cols-3 gap-2">
              {([0.75, 1, 1.25, 1.5, 1.75, 2] as const).map((speed) => (
                <button
                  key={speed}
                  type="button"
                  onClick={() => update("playerSpeed", speed)}
                  aria-pressed={preferences.playerSpeed === speed}
                  className={cn("rounded-xl border px-3 py-2 text-xs font-bold transition", preferences.playerSpeed === speed ? "border-brand bg-brand text-white" : "border-line bg-black/15 text-white/75 hover:border-white/20")}
                >
                  {speed === 1 ? "Normale" : `${String(speed).replace(".", ",")}×`}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Taille des commandes</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "compact", label: "Compacte" },
                { id: "normal", label: "Normale" },
                { id: "grand", label: "Grande" },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => update("playerControlsSize", option.id)}
                  aria-pressed={preferences.playerControlsSize === option.id}
                  className={cn("rounded-xl border px-3 py-2 text-xs font-bold transition", preferences.playerControlsSize === option.id ? "border-brand bg-brand text-white" : "border-line bg-black/15 text-white/75 hover:border-white/20")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Notifications" description="Choisis les nouveautés à afficher dans ton espace." />
          <div className="mt-1 divide-y divide-line">
            <Toggle checked={preferences.notifications.announcements} onChange={(value) => updateNotification("announcements", value)} label="Annonces du site" description="Nouveautés, maintenances et informations importantes." />
            <Toggle checked={preferences.notifications.newEpisodes} onChange={(value) => updateNotification("newEpisodes", value)} label="Nouveaux épisodes" description="Les sorties des animés de ta liste." />
            <Toggle checked={preferences.notifications.newsletter} onChange={(value) => updateNotification("newsletter", value)} label="Sélection mensuelle" description="Afficher chaque mois les nouveautés anime à découvrir sur le site." />
          </div>
          <button type="button" onClick={testNotifications} className="mt-4 w-full rounded-xl border border-brand/35 bg-brand/10 px-4 py-3 text-left text-xs font-bold text-white transition hover:border-brand-2/50 hover:bg-brand/20">
            Tester les notifications sur ce site
            <span className="mt-1 block text-[10px] font-normal text-muted">Affiche trois aperçus temporaires. Aucun message n’est envoyé et rien n’est publié.</span>
          </button>
        </Panel>
      </div>

      <Alert status={status} />
      <div className="flex justify-end"><SaveButton busy={busy}>Enregistrer mes préférences</SaveButton></div>
    </form>
  );
}
