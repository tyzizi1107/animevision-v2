"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/administration/animes", label: "Animés", mark: "◈" },
  { href: "/administration/annonces", label: "Annonces", mark: "◉" },
  { href: "/administration/comptes", label: "Comptes", mark: "◎" },
  { href: "/administration/veille", label: "Veille", mark: "◷" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Outils d’administration" className="flex gap-2 overflow-x-auto rounded-2xl border border-line bg-[#0c0b10] p-2 shadow-xl shadow-black/20">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-11 shrink-0 items-center gap-2.5 rounded-xl px-4 text-sm font-semibold transition",
              active ? "bg-brand text-white shadow-[0_8px_24px_-12px_rgba(169,120,245,0.85)]" : "text-white/55 hover:bg-white/[0.05] hover:text-white",
            )}
          >
            <span aria-hidden="true" className="text-lg leading-none">{link.mark}</span>
            {link.label}
          </Link>
        );
      })}
      <Link href="/annonces" className="ml-auto inline-flex h-11 shrink-0 items-center rounded-xl px-4 text-xs font-medium text-white/45 transition hover:bg-white/[0.05] hover:text-white">
        Centre public ↗
      </Link>
    </nav>
  );
}
