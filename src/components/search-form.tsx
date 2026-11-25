"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CloseIcon, SearchIcon } from "@/components/icons";

export function SearchForm({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const didMount = useRef(false);

  useEffect(() => setQuery(initialQuery), [initialQuery]);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      const value = query.trim();
      const current = new URL(window.location.href);
      if (current.pathname === "/recherche" && (current.searchParams.get("q") ?? "") === value) return;
      router.replace(value ? `/recherche?q=${encodeURIComponent(value)}` : "/recherche", { scroll: false });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, router]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    router.push(value ? `/recherche?q=${encodeURIComponent(value)}` : "/recherche");
  };

  return (
    <form onSubmit={submit} className="relative" role="search">
      <SearchIcon className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
      <input
        type="text"
        inputMode="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Titre, titre alternatif…"
        aria-label="Rechercher un animé"
        autoFocus
        className="h-14 w-full rounded-full border border-line bg-panel pl-14 pr-32 text-base text-ink placeholder:text-muted/60 transition focus:border-brand/50 focus:bg-panel-2 focus:outline-none"
      />
      {query && (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            router.replace("/recherche", { scroll: false });
          }}
          aria-label="Effacer la recherche"
          className="absolute right-[56px] top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted transition hover:bg-white/10 hover:text-white"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      )}
      <button
        type="submit"
        aria-label="Lancer la recherche"
        title="Rechercher"
        className="absolute right-1.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-brand text-white transition hover:brightness-105"
      >
        <SearchIcon className="h-6 w-6" />
      </button>
    </form>
  );
}
