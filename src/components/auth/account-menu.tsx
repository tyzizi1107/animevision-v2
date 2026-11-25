"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  BookmarkIcon,
  GridIcon,
  LogoutIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
} from "@/components/icons";
import { FigChevronDownIcon, FigUserIcon } from "@/components/figma-icons";
import { avatarImageSrc } from "@/lib/avatar";
import { cn } from "@/lib/utils";

export function AccountMenu() {
  const { user, loading, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (loading) {
    return <div className="h-9 w-9 animate-pulse rounded-full bg-white/10" aria-hidden="true" />;
  }

  if (!user) {
    return (
      <Link
        href="/connexion"
        aria-label="Se connecter"
        title="Se connecter"
        className="flex items-center text-[#bdb6cb] transition hover:text-white"
      >
        <FigUserIcon className="h-[25px] w-[25px]" />
      </Link>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Ouvrir le menu du compte"
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center text-[#bdb6cb] transition hover:text-white"
      >
        <img
          src={avatarImageSrc(user.avatar)}
          alt=""
          className="h-8 w-8 rounded-full object-cover"
        />
        <FigChevronDownIcon className={cn("h-8 w-8 transition", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] w-64 animate-fade-in overflow-hidden rounded-2xl border border-line bg-panel/95 p-1.5 shadow-[0_30px_80px_-30px_rgba(0,0,0,1)] backdrop-blur-xl"
        >
          <div className="px-3 pb-2 pt-2.5">
            <p className="truncate text-sm font-semibold text-white">{user.name}</p>
            <p className="truncate text-[11px] text-muted">{user.email}</p>
            {user.role === "admin" && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand-2">
                <ShieldIcon className="h-3 w-3" />
                Administrateur
              </span>
            )}
          </div>

          <div className="my-1 h-px bg-line" />

          <MenuLink href="/compte" onSelect={() => setOpen(false)} icon={<UserIcon className="h-4 w-4" />}>
            Mon compte
          </MenuLink>
          <MenuLink
            href="/ma-liste"
            onSelect={() => setOpen(false)}
            icon={<BookmarkIcon className="h-4 w-4" />}
          >
            Ma liste
          </MenuLink>
          <MenuLink
            href="/compte?tab=preferences"
            onSelect={() => setOpen(false)}
            icon={<SettingsIcon className="h-4 w-4" />}
          >
            Préférences
          </MenuLink>
          {user.role === "admin" && (
            <MenuLink
              href="/administration/animes"
              onSelect={() => setOpen(false)}
              icon={<GridIcon className="h-4 w-4" />}
            >
              Gérer AnimeVision
            </MenuLink>
          )}

          <div className="my-1 h-px bg-line" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] text-red-300 transition hover:bg-red-500/10 hover:text-red-200"
          >
            <LogoutIcon className="h-4 w-4" />
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onSelect,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-white/80 transition hover:bg-white/[0.06] hover:text-white"
    >
      <span className="text-muted">{icon}</span>
      {children}
    </Link>
  );
}
