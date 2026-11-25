"use client";

import { useAuth } from "@/components/auth/auth-provider";

export function EpisodeTitle({ number, title }: { number: number; title?: string | null }) {
  const { user } = useAuth();
  const showDetails = user?.preferences.showEpisodeDetails ?? true;
  return <>{showDetails && title ? title : `Épisode ${number}`}</>;
}

export function EpisodeMetadata({
  number,
  total,
  runtime,
  airDate,
}: {
  number: number;
  total: number;
  runtime?: number | null;
  airDate?: string | null;
}) {
  const { user } = useAuth();
  const showDetails = user?.preferences.showEpisodeDetails ?? true;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
      <span>Épisode {number} sur {total}</span>
      {showDetails && runtime && <><span aria-hidden="true">·</span><span>{runtime} min</span></>}
      {showDetails && airDate && <><span aria-hidden="true">·</span><span>{airDate}</span></>}
    </div>
  );
}
