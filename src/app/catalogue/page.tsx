import type { Metadata } from "next";
import Link from "next/link";
import { AnimeCard } from "@/components/anime-card";
import { CatalogueFilters } from "@/components/catalogue-filters";
import { SearchIcon, StarIcon } from "@/components/icons";
import { searchCatalog } from "@/lib/animes";
import { getSessionUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Catalogue",
  description: "Parcourez les séries et films d'animation japonais référencés dans le catalogue AnimeVision.",
};

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  genre?: string;
  sort?: string;
  page?: string;
};

function pageHref(page: number, params: SearchParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.genre) search.set("genre", params.genre);
  if (params.sort && params.sort !== "note") search.set("sort", params.sort);
  if (page > 1) search.set("page", String(page));
  return `/catalogue${search.toString() ? `?${search.toString()}` : ""}`;
}

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await getSessionUser();
  const initialSort = params.sort ?? user?.preferences.defaultCatalogSort ?? "note";
  const result = await searchCatalog({
    q: params.q,
    genre: params.genre,
    sort: initialSort,
    page: Number.parseInt(params.page ?? "1", 10) || 1,
  });

  const windowStart = Math.max(1, result.page - 2);
  const windowEnd = Math.min(result.pages, result.page + 2);
  const pageNumbers = Array.from(
    { length: windowEnd - windowStart + 1 },
    (_, index) => windowStart + index,
  );

  return (
    <main className="relative isolate mx-auto min-h-screen max-w-[1440px] px-4 pb-24 pt-24 sm:px-6 lg:px-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(ellipse_at_20%_-10%,rgba(65,0,154,0.45),transparent_55%)]"
      />

      <header className="flex flex-col gap-8 border-b border-line pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="eyebrow">Catalogue</p>
          <h1 className="page-title mt-3 text-4xl text-ink sm:text-5xl">
            Trouve ton prochain animé
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
            Séries et films d&apos;animation japonaise, doublés ou sous-titrés en français.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="rounded-2xl border border-line bg-panel/70 px-4 py-3">
            <p className="eyebrow">Au catalogue</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {result.totalCatalog.toLocaleString("fr-FR")}
            </p>
          </div>
          <div className="rounded-2xl border border-brand/35 bg-brand/15 px-4 py-3">
            <p className="eyebrow text-brand-2/80">Sélection</p>
            <p className="mt-1 flex items-center gap-1.5 text-2xl font-semibold tabular-nums text-brand-2">
              <StarIcon className="h-4 w-4" /> {result.total.toLocaleString("fr-FR")}
            </p>
          </div>
        </div>
      </header>

      <div className="mt-6 rounded-[var(--radius-card)] border border-line bg-panel/60 p-4 sm:p-5">
        <CatalogueFilters
          initialQuery={params.q ?? ""}
          initialGenre={params.genre ?? ""}
          initialSort={initialSort}
          genres={result.genres}
          total={result.total}
          totalCatalog={result.totalCatalog}
        />
      </div>

      {result.total === 0 ? (
        <div className="mt-8 flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line bg-panel/40 px-6 py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-brand/25 bg-brand/15 text-brand-2">
            <SearchIcon className="h-6 w-6" />
          </div>
          <h2 className="mt-5 text-lg font-bold">
            {result.totalCatalog === 0 ? "Le catalogue est vide" : "Aucun résultat"}
          </h2>
          <p className="mt-1.5 max-w-sm text-sm text-muted">
            {result.totalCatalog === 0
              ? "Aucune fiche n'est disponible pour le moment. Revenez un peu plus tard."
              : "Aucun animé ne correspond à cette recherche. Essayez un autre titre ou retirez les filtres."}
          </p>
          <Link
            href={result.totalCatalog === 0 ? "/" : "/catalogue"}
            className="mt-6 inline-flex h-10 items-center rounded-full bg-brand px-5 text-sm font-bold text-white shadow-[0_8px_28px_-12px_rgba(65,0,154,0.8)] transition hover:brightness-110"
          >
            {result.totalCatalog === 0 ? "Retour à l'accueil" : "Voir tout le catalogue"}
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-5 mt-10 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-[17px] font-semibold tracking-tight text-ink sm:text-xl">Tous les animés</h2>
            <p className="rounded-full border border-line px-3.5 py-1.5 text-[11px] font-medium text-muted">
              <span className="font-semibold text-brand-2">{result.total.toLocaleString("fr-FR")}</span> résultat{result.total > 1 ? "s" : ""}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {result.items.map((anime) => (
              <AnimeCard
                key={anime.id}
                anime={anime}
                fluid
                showYear
                showScore={!params.sort || params.sort === "note"}
              />
            ))}
          </div>

          {result.pages > 1 && (
            <nav
              aria-label="Pagination du catalogue"
              className="mt-12 flex flex-wrap items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-line bg-panel/50 p-3"
            >
              <Link
                href={pageHref(result.page - 1, params)}
                aria-disabled={result.page === 1}
                className={cn(
                  "inline-flex h-9 items-center rounded-lg border border-line px-3 text-xs font-medium transition",
                  result.page === 1
                    ? "pointer-events-none opacity-40"
                    : "text-white/80 hover:border-white/25 hover:text-white",
                )}
              >
                Précédent
              </Link>

              {pageNumbers.map((page) => (
                <Link
                  key={page}
                  href={pageHref(page, params)}
                  aria-current={page === result.page ? "page" : undefined}
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-lg border text-xs font-semibold transition",
                    page === result.page
                    ? "border-brand bg-brand text-white shadow-[0_10px_30px_-14px_rgba(65,0,154,0.95)]"
                      : "border-line text-muted hover:border-brand/50 hover:text-brand-2",
                  )}
                >
                  {page}
                </Link>
              ))}

              <Link
                href={pageHref(result.page + 1, params)}
                aria-disabled={result.page === result.pages}
                className={cn(
                  "inline-flex h-9 items-center rounded-lg border border-line px-3 text-xs font-medium transition",
                  result.page === result.pages
                    ? "pointer-events-none opacity-40"
                    : "text-white/80 hover:border-white/25 hover:text-white",
                )}
              >
                Suivant
              </Link>
            </nav>
          )}
        </>
      )}
    </main>
  );
}