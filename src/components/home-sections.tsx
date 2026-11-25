"use client";

import type { ReactNode } from "react";
import { useOptionalAuth } from "@/components/auth/auth-provider";
import { DEFAULT_PREFERENCES, type HomeSectionId } from "@/lib/preferences";

export function HomeSections({ sections }: { sections: Record<HomeSectionId, ReactNode> }) {
  const auth = useOptionalAuth();
  const preferences = auth && !auth.loading && auth.user ? auth.user.preferences : DEFAULT_PREFERENCES;
  return (
    <div id="accueil-sections" className="mx-auto mt-0 max-w-[1440px] space-y-10 px-4 sm:px-6 lg:px-16">
      {preferences.homeSections.map((section) => section.enabled ? <div key={section.id}>{sections[section.id]}</div> : null)}
    </div>
  );
}
