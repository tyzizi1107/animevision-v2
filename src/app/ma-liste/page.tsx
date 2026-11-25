import type { Metadata } from "next";
import { LibraryView } from "@/components/library-view";

export const metadata: Metadata = {
  title: "Ma liste",
  description: "Vos animés sauvegardés et votre progression de lecture.",
};

export default function MyListPage() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-28 sm:px-6 lg:px-8">
      <div className="max-w-2xl">
        <p className="eyebrow">
          Bibliothèque
        </p>
        <h1 className="page-title mt-3 text-[2rem] text-ink sm:text-[2.75rem]">Ma liste</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
          Retrouvez vos animés sauvegardés et reprenez la lecture là où vous l'avez laissée.
          Votre progression est enregistrée sur cet appareil.
        </p>
      </div>

      <div className="mt-10">
        <LibraryView />
      </div>
    </div>
  );
}
