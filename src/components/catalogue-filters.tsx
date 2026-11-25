"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, CloseIcon, SearchIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

type Props = {
  initialQuery: string;
  initialGenre: string;
  initialSort: string;
  genres: Array<{ name: string; count: number }>;
  total: number;
  totalCatalog: number;
};

export function CatalogueFilters({
  initialQuery,
  initialGenre,
  initialSort,
  genres,
  total,
  totalCatalog,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [genre, setGenre] = useState(initialGenre);
  const [sort, setSort] = useState(initialSort);
  const [sortOpen, setSortOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const didMount = useRef(false);

  useEffect(() => setQuery(initialQuery), [initialQuery]);
  useEffect(() => setGenre(initialGenre), [initialGenre]);
  useEffect(() => setSort(initialSort), [initialSort]);

  useEffect(() => {
    if (!sortOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!sortMenuRef.current?.contains(event.target as Node)) setSortOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSortOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [sortOpen]);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (genre) params.set("genre", genre);
      if (sort && sort !== "note") params.set("sort", sort);
      const target = `/catalogue${params.toString() ? `?${params.toString()}` : ""}`;
      if (`${window.location.pathname}${window.location.search}` !== target) {
        router.replace(target, { scroll: false });
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, genre, sort, router]);

  const push = (next: { q?: string; genre?: string; sort?: string }) => {
    const params = new URLSearchParams();
    const q = (next.q ?? query).trim();
    const g = next.genre ?? genre;
    const s = next.sort ?? sort;

    if (q) params.set("q", q);
    if (g) params.set("genre", g);
    if (s && s !== "note") params.set("sort", s);

    router.push(`/catalogue${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const reset = () => {
    setQuery("");
    setGenre("");
    setSort("note");
    router.push("/catalogue");
  };

  const hasFilters = Boolean(query || genre || sort !== "note");

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            push({ q: query });
          }}
          className="relative w-full lg:max-w-xl lg:flex-1"
        >
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            inputMode="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un animé, un film…"
            aria-label="Rechercher dans le catalogue"
            className="h-12 w-full rounded-2xl border border-line bg-bg-soft pl-11 pr-24 text-sm text-ink placeholder:text-muted/70 transition focus:border-brand/70 focus:bg-panel focus:outline-none focus:ring-4 focus:ring-brand/25"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                push({ q: "" });
              }}
              aria-label="Effacer la recherche"
              className="absolute right-[92px] top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted transition hover:bg-white/10 hover:text-white"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="submit"
            aria-label="Rechercher dans le catalogue"
            title="Rechercher"
            className="absolute right-2 top-1/2 grid h-8 w-9 -translate-y-1/2 place-items-center rounded-xl bg-brand text-white shadow-[0_5px_20px_-8px_rgba(65,0,154,1)] transition hover:brightness-110"
          >
            <SearchIcon className="h-4 w-4" />
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] uppercase tracking-[0.1em] text-muted">
            <span className="font-semibold text-brand-2">{total}</span> sur {totalCatalog}
          </span>
          <div ref={sortMenuRef} className="relative z-20">
            <button
              type="button"
              aria-label="Trier les résultats"
              aria-haspopup="listbox"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen((open) => !open)}
              className="flex h-11 min-w-[196px] items-center justify-between gap-4 rounded-xl border border-line bg-panel-2 px-4 text-left text-[13px] font-semibold text-ink transition hover:border-brand/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-2"
            >
              <span>{sort === "recent" ? "Les plus récents" : sort === "az" ? "De A à Z" : "Les mieux notés"}</span>
              <ChevronDownIcon className={cn("h-4 w-4 shrink-0 text-muted transition-transform", sortOpen && "rotate-180")} />
            </button>
            {sortOpen && (
              <div role="listbox" aria-label="Options de tri" className="absolute inset-x-0 top-full mt-2 rounded-xl border border-line bg-panel-2 p-1.5 shadow-[0_18px_45px_-15px_rgba(0,0,0,.9)]">
                {[
                  { value: "note", label: "Les mieux notés" },
                  { value: "recent", label: "Les plus récents" },
                  { value: "az", label: "De A à Z" },
                ].map((option) => {
                  const selected = sort === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setSort(option.value);
                        push({ sort: option.value });
                        setSortOpen(false);
                      }}
                      className={cn("flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm font-medium transition", selected ? "bg-brand text-white" : "text-white/80 hover:bg-white/[0.07] hover:text-white")}
                    >
                      {option.label}
                      {selected && <CheckIcon className="h-4 w-4" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="no-scrollbar mt-6 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
        <Pill active={!genre} onClick={() => push({ genre: "" })}>
          Tous les genres
        </Pill>
        {genres.map((item) => (
          <Pill
            key={item.name}
            active={genre.toLowerCase() === item.name.toLowerCase()}
            onClick={() => push({ genre: item.name })}
          >
            {item.name}
          </Pill>
        ))}
      </div>

      {hasFilters && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[11px] text-muted transition hover:border-brand/60 hover:text-brand-2"
          >
            <CloseIcon className="h-3 w-3" />
            Réinitialiser les filtres
          </button>
        </div>
      )}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition",
        active
          ? "border-brand bg-brand text-white shadow-[0_8px_24px_-14px_rgba(65,0,154,0.9)]"
          : "border-white/[0.09] bg-white/[0.025] text-slate-400 hover:border-brand/40 hover:bg-brand/10 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}
