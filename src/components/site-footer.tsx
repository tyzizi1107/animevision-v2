"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { LegalLink } from "@/components/legal/legal-dialog";

export function SiteFooter() {
  const pathname = usePathname();
  if (pathname.startsWith("/connexion") || pathname.startsWith("/inscription")) return null;

  return (
    <footer className="relative mt-8 overflow-hidden bg-bg pb-6">
      <div className="relative mx-auto max-w-[1312px] border-t border-[#2a203a] px-4 pb-6 pt-10 sm:px-0">
        <div>
          <Link href="/" className="inline-flex" aria-label="AnimeVision, accueil">
            <BrandLogo size="compact" />
          </Link>
          <p className="mt-5 text-[13px] leading-relaxed text-muted">
Le site AnimeVision.fr n'héberge aucun fichier vidéo, que ce soit pour du streaming ou du téléchargements. Celui-ci consiste en une indexation de liens vidéos sur différents hébergeurs publiques et connus.
          </p>

        </div>

      </div>

      <div>
        <div className="mx-auto flex max-w-[1312px] flex-col gap-2 px-4 pb-6 text-xs text-muted/80 sm:flex-row-reverse sm:items-end sm:justify-between sm:px-0">
          <p>© {new Date().getFullYear()} AnimeVision - Aucun droits réservés.</p>
          <nav aria-label="Informations légales" className="flex flex-wrap gap-x-5 gap-y-2">
            <LegalLink document="terms" className="transition hover:text-brand-2">Conditions d’utilisation</LegalLink>
            <LegalLink document="privacy" className="transition hover:text-brand-2">Confidentialité</LegalLink>
          </nav>
        </div>
      </div>
    </footer>
  );
}
