import type { Metadata } from "next";
import Link from "next/link";
import { AnimeCard } from "@/components/anime-card";
import { SearchForm } from "@/components/search-form";
import { SearchIcon } from "@/components/icons";
import { searchCatalog, getGenreStats } from "@/lib/animes";

export const metadata: Metadata = {
  title: "Recherche",
  description: "Recherchez un animé ou un film dans le catalogue AnimeVision.",
};

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const genres = await getGenreStats();
  const result = query ? await searchCatalog({ q: query }) : null;

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-16 pt-28 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <p className="eyebrow">
          Recherche
        </p>
        <h1 className="page-title mt-3 text-[2rem] text-ink sm:text-[2.75rem]">
          Que voulez-vous regarder ?
        </h1>

        <div className="mt-7">
          <SearchForm initialQuery={query} />
        </div>

        {genres.length > 0 && (
          <div className="no-scrollbar mt-5 flex gap-2 overflow-x-auto pb-1">
            {genres.slice(0, 10).map((genre) => (
              <Link
                key={genre.name}
                href={`/catalogue?genre=${encodeURIComponent(genre.name)}`}
                className="shrink-0 rounded-full border border-line bg-panel/60 px-3.5 py-1.5 text-[11px] font-medium text-muted transition hover:border-brand/60 hover:text-brand-2"
              >
                {genre.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {result && (
        <div className="mt-12">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">
              {result.total > 0
                ? `${result.total} résultat${result.total > 1 ? "s" : ""}`
                : "Aucun résultat"}
            </h2>
            {query && <span className="truncate text-xs text-muted">pour « {query} »</span>}
          </div>

          {result.items.length > 0 ? (
            <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 xl:grid-cols-6">
              {result.items.map((anime) => (
                <AnimeCard key={anime.id} anime={anime} fluid />
              ))}
            </div>
          ) : (
            <div className="mt-8 flex flex-col items-center justify-center rounded-3xl border border-dashed border-line bg-panel/40 px-6 py-16 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-muted">
                <SearchIcon className="h-6 w-6" />
              </div>
              <h3 className="mt-5 text-lg font-bold">Rien trouvé</h3>
              <p className="mt-1.5 max-w-sm text-sm text-muted">
                Aucun animé ne correspond à « {query} ». Essayez un autre titre ou parcourez le
                catalogue.
              </p>
              <Link
                href="/catalogue"
                className="mt-6 inline-flex h-10 items-center rounded-full bg-brand px-5 text-sm font-semibold text-white transition hover:brightness-105"
              >
                Ouvrir le catalogue
              </Link>
            </div>
          )}

          {result.total > result.items.length && (
            <div className="mt-8 text-center">
              <Link
                href={`/catalogue?q=${encodeURIComponent(query)}`}
                className="text-xs font-medium text-brand-2 underline underline-offset-4 hover:text-white"
              >
                Voir tous les résultats dans le catalogue
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
