import type { Metadata } from "next";

/**
 * La page de lecture n'affiche que le lecteur : pas d'habillage du site
 * (l'en-tête et la navigation sont retirés par `SiteChrome`).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh overflow-hidden bg-black">{children}</div>;
}
