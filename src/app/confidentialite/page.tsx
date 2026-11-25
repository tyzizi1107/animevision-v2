import type { Metadata } from "next";
import { PRIVACY_SECTIONS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Informations sur les données utilisées par AnimeVision.",
};

const sections = PRIVACY_SECTIONS;

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 pb-24 pt-32 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Politique de confidentialité</h1>
      <p className="mt-8 text-base leading-7 text-white/80">
        Cette page décrit les données que le site traite actuellement et leur usage. L’acceptation
        des conditions d’utilisation n’est pas un consentement à des traitements facultatifs.
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
