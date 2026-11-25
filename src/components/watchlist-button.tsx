"use client";

import { CheckIcon } from "@/components/icons";
import { FigListPlusIcon } from "@/components/figma-icons";
import { useLibrary } from "@/lib/library";
import { cn } from "@/lib/utils";

type Props = {
  animeId: string;
  variant?: "primary" | "ghost" | "soft";
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
};

const VARIANTS: Record<NonNullable<Props["variant"]>, string> = {
  primary:
    "bg-brand text-white shadow-[0_14px_40px_-20px_rgba(65,0,154,0.8)] hover:brightness-105",
  ghost:
    "border border-white/15 bg-white/[0.07] text-white backdrop-blur-md hover:border-white/30 hover:bg-white/[0.12]",
  soft: "border border-line bg-white/[0.04] text-ink hover:border-white/20 hover:bg-white/[0.08]",
};

export function WatchlistButton({
  animeId,
  variant = "ghost",
  size = "md",
  showLabel = true,
  className,
}: Props) {
  const { isSaved, toggle } = useLibrary();
  const saved = isSaved(animeId);

  return (
    <button
      type="button"
      onClick={() => toggle(animeId)}
      aria-pressed={saved}
      aria-label={saved ? "Retirer de ma liste" : "Ajouter à ma liste"}
      title={saved ? "Retirer de ma liste" : "Ajouter à ma liste"}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 active:scale-[0.97]",
        size === "md" ? "h-11 px-5 text-sm" : "h-9 px-4 text-xs",
        saved && variant !== "primary"
          ? "border-brand/50 bg-brand/15 text-white hover:bg-brand/20"
          : VARIANTS[variant],
        !showLabel && (size === "md" ? "w-11 px-0" : "w-9 px-0"),
        className,
      )}
    >
      {saved ? <CheckIcon className="h-5 w-5 shrink-0" /> : <FigListPlusIcon className="h-6 w-6 shrink-0" />}
      {showLabel && <span>{saved ? "Dans ma liste" : "Ma liste"}</span>}
    </button>
  );
}
