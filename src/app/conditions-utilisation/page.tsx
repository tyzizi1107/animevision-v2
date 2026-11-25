import type { Metadata } from "next";
import { TERMS_SECTIONS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Conditions d’utilisation",
  description: "Conditions d’utilisation du site AnimeVision.",
};

const sections = TERMS_SECTIONS;

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 pb-24 pt-32 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Conditions d’utilisation</h1>
      <p className="mt-8 text-base leading-7 text-white/80">
        En créant un compte ou en utilisant AnimeVision, vous acceptez les règles ci-dessous.
        Prenez le temps de les lire avant de vous inscrire.
      </p>
      <div className="mt-8 space-y-7">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-bold">{section.title}</h2>
            <p className="mt-2 text-sm leading-7 text-muted">{section.body}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
