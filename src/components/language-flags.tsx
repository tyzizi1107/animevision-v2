type Language = "vostfr" | "vf";

const details: Record<Language, { flag: string; label: string }> = {
  vf: { flag: "VF", label: "Version française" },
  vostfr: { flag: "VOSTFR", label: "Version originale sous-titrée en français" },
};

/**
 * Badges VOSTFR / VF posés sur les affiches.
 *
 * Désactivés : les précisions de langue ne doivent plus apparaître sur les
 * cartes-affiches, sur aucune page. Le composant reste en place (et accepte
 * `enabled` pour un éventuel retour ponctuel) afin de ne pas casser ses appels.
 */
export function LanguageFlags({
  languages,
  enabled = false,
}: {
  languages: Language[];
  enabled?: boolean;
}) {
  const uniqueLanguages = [...new Set(languages)];
  if (!enabled || uniqueLanguages.length === 0) return null;

  return (
    <span
      role="img"
      aria-label={uniqueLanguages.map((language) => details[language].label).join(" et ")}
      className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
    >
      {uniqueLanguages.map((language) => (
        <span key={language} title={details[language].label} className="grid h-7 min-w-7 place-items-center rounded-full border border-white/20 bg-black/65 px-1.5 text-[10px] font-extrabold tracking-wide text-white shadow-lg backdrop-blur-sm">
          {details[language].flag}
        </span>
      ))}
    </span>
  );
}
