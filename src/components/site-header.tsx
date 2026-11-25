"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnnouncementBell } from "@/components/announcements/announcement-bell";
import { AccountMenu } from "@/components/auth/account-menu";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (
    pathname.startsWith("/connexion") ||
    pathname.startsWith("/inscription")
  ) {
    return null;
  }

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-all duration-300",
        scrolled
          ? "bg-bg/85 backdrop-blur-xl"
          : "bg-bg/85",
      )}
    >
      <div className="relative mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:pl-6 lg:pr-3">
        <div className="flex items-center gap-8">
          <Link href="/" className="group flex items-center" aria-label="AnimeVision, accueil">
            <span className="transition duration-300 group-hover:scale-105">
              <BrandLogo size="compact" priority />
            </span>
          </Link>

          <nav aria-label="Navigation du site" className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-12 lg:flex">
            {NAV_ITEMS.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative py-2 text-sm transition",
                    active
                      ? "font-semibold text-white after:absolute after:inset-x-0 after:-bottom-1 after:h-[3px] after:rounded-sm after:bg-[#7b38d4]"
                      : "font-medium text-[#bdb6cb] hover:text-white",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1.5 -mr-1">
          <Link
            href="/ma-liste"
            className="mr-6 hidden text-sm font-medium text-[#bdb6cb] transition hover:text-white sm:block"
          >
            Ma liste
          </Link>
          <AnnouncementBell />
          <div className="translate-x-3"><AccountMenu /></div>
        </div>
      </div>
    </header>
  );
}

const NAV_ITEMS = [
  { href: "/", label: "Accueil" },
  { href: "/recherche", label: "Recherche" },
  { href: "/catalogue", label: "Catalogue" },
  { href: "/calendrier", label: "Calendrier" },
] as const;
