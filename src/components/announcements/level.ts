import type { AnnouncementLevel } from "@/lib/db-types";

export const LEVEL_META: Record<
  AnnouncementLevel,
  { label: string; badge: string; border: string; dot: string }
> = {
  info: {
    label: "Information",
    badge: "border-sky-400/30 bg-sky-500/15 text-sky-200",
    border: "border-sky-400/25",
    dot: "bg-sky-400",
  },
  success: {
    label: "Nouveauté",
    badge: "border-emerald-400/30 bg-emerald-500/15 text-emerald-200",
    border: "border-emerald-400/25",
    dot: "bg-emerald-400",
  },
  warning: {
    label: "Maintenance",
    badge: "border-amber-400/30 bg-amber-500/15 text-amber-200",
    border: "border-amber-400/25",
    dot: "bg-amber-400",
  },
  critical: {
    label: "Important",
    badge: "border-red-400/30 bg-red-500/15 text-red-200",
    border: "border-red-400/25",
    dot: "bg-red-400",
  },
};
