import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70svh] max-w-lg flex-col items-center justify-center px-4 py-28 text-center">
      <BrandLogo size="large" />
      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.3em] text-brand-2">
        Erreur 404
      </p>
      <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
        Cet page n'existe pas
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        La page que vous cherchez a peut-être changé. Retournez a l'accueil pour
        retrouver votre animé.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-full bg-brand px-6 text-sm font-bold text-white transition hover:brightness-105"
        >
          Retour à l'accueil
        </Link>
        <Link
          href="/catalogue"
          className="inline-flex h-11 items-center rounded-full border border-line px-6 text-sm font-medium text-white/85 transition hover:border-white/25 hover:text-white"
        >
          Voir le catalogue
        </Link>
      </div>
    </div>
  );
}
