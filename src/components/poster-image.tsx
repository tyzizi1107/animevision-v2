"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function PosterImage({
  src,
  alt,
  className,
  fallbackClassName,
}: {
  src: string | null;
  alt: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-gradient-to-br from-brand/30 via-panel-2 to-brand-2/20",
          fallbackClassName,
        )}
        aria-hidden="true"
      >
        <span className="text-3xl font-black text-white/20">{alt.slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("h-full w-full object-cover", className)}
    />
  );
}
