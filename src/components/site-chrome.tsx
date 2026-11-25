"use client";

import { usePathname } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/** Routes où le lecteur occupe tout l'écran : aucun habillage du site. */
const IMMERSIVE_PREFIXES = ["/regarder/", "/watch/"];

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const immersive = IMMERSIVE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (immersive) {
    return <main className="h-dvh overflow-hidden bg-black">{children}</main>;
  }

  return (
    <>
      <SiteHeader />
      <main className="min-h-dvh">{children}</main>
      <SiteFooter />
    </>
  );
}
