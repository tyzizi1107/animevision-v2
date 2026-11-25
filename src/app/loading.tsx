"use client";

import { useEffect, useState } from "react";

/**
 * Transition entre deux pages : rien au départ (les pages sont préchargées, la
 * navigation est immédiate). Si le chargement dépasse 700 ms, la roue apparaît
 * pour dire que quelque chose se passe ; elle n'apparaît jamais pour un
 * changement instantané.
 */
export default function Loading() {
  const [late, setLate] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setLate(true), 700);
    return () => window.clearTimeout(timer);
  }, []);

  if (!late) return null;

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-bg/55 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-label="Chargement"
    >
      <span className="h-10 w-10 animate-spin rounded-full border-[4px] border-white/15 border-t-[#41009a] sm:h-12 sm:w-12 sm:border-[5px]" />
    </div>
  );
}
