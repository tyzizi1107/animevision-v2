"use client";

import Link from "next/link";
import { useState } from "react";
import { ProfilePanel } from "@/components/account/profile-panel";
import { PreferencesPanel } from "@/components/account/preferences-panel";
import { SecurityPanel } from "@/components/account/security-panel";
import { useAuth } from "@/components/auth/auth-provider";
import { BookmarkIcon, SettingsIcon, ShieldIcon, UserIcon } from "@/components/icons";
import { avatarImageSrc } from "@/lib/avatar";
import { cn, formatDate } from "@/lib/utils";

type Tab = "profil" | "preferences" | "securite";

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: "profil", label: "Profil", icon: <UserIcon className="h-4 w-4" /> },
  { id: "preferences", label: "Préférences", icon: <SettingsIcon className="h-4 w-4" /> },
  { id: "securite", label: "Sécurité", icon: <ShieldIcon className="h-4 w-4" /> },
];

export function AccountView({ initialTab = "profil" }: { initialTab?: Tab }) {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab);

  if (loading && !user) {
    return (
      <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="h-64 animate-pulse rounded-2xl border border-line bg-panel/40" />
        <div className="h-96 animate-pulse rounded-2xl border border-line bg-panel/40" />
      </div>
    );
  }

  if (!user) return null;

  const activeTab = TABS.find((item) => item.id === tab)!;

  return (
    <div className="space-y-6">
      <section className="relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-3xl border border-brand/20 bg-gradient-to-r from-[#1a1026] via-[#120e19] to-[#0d0c11] p-5 shadow-[0_24px_70px_-45px_rgba(65,0,154,0.8)] sm:p-6">
        <div className="relative flex min-w-0 items-center gap-4">
          <img src={avatarImageSrc(user.avatar)} alt="" className="h-14 w-14 shrink-0 rounded-2xl border border-brand-2/30 object-cover " />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-2">Mon espace AnimeVision</p>
            <h2 className="mt-1 truncate text-xl font-black text-white sm:text-2xl">Bienvenue, {user.name}</h2>
            <p className="mt-1 text-xs text-white/55">Gérez votre profil, vos préférences et vos appareils connectés.</p>
          </div>
        </div>
        <Link href="/ma-liste" className="relative inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 text-xs font-bold text-white/80 transition hover:border-brand-2/40 hover:bg-brand/15 hover:text-white">
          <BookmarkIcon className="h-4 w-4 text-brand-2" />
          Ma liste
        </Link>
      </section>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-3xl border border-line bg-gradient-to-b from-[#141319] to-[#0e0d12] p-5 shadow-[0_24px_70px_-55px_rgba(0,0,0,0.9)]">
          <div className="flex items-center gap-3.5">
            <img
              src={avatarImageSrc(user.avatar)}
              alt=""
              className="h-14 w-14 shrink-0 rounded-2xl object-cover shadow-[0_18px_40px_-20px_rgba(0,0,0,0.9)]"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{user.name}</p>
              <p className="truncate text-[11px] text-muted">{user.email}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-line px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted">
              {user.role === "admin" ? "Administrateur" : "Membre"}
            </span>
            <span className="rounded-full border border-line px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted">
              Depuis {formatDate(user.createdAt, { month: "short", year: "numeric" })}
            </span>
          </div>

          <div className="my-4 h-px bg-line" />

          <nav className="space-y-1" aria-label="Sections du compte">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition",
              tab === item.id
                    ? "bg-brand/15 text-white ring-1 ring-inset ring-brand/25"
                    : "text-muted hover:bg-white/[0.04] hover:text-white",
                )}
              >
                <span className={tab === item.id ? "text-brand-2" : "text-muted"}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="my-4 h-px bg-line" />

          <Link
            href="/ma-liste"
            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] text-muted transition hover:bg-white/[0.04] hover:text-white"
          >
            <BookmarkIcon className="h-4 w-4" />
            Ma liste
          </Link>
        </div>
      </aside>

      <section className="min-w-0">
        <div className="mb-5 flex gap-2 overflow-x-auto lg:hidden">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition",
                tab === item.id
                  ? "border-transparent bg-brand text-white"
                  : "border-line text-muted",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mb-4 border-b border-line pb-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-2">Réglages · {activeTab.label}</p>
          <h2 className="mt-1 text-xl font-black text-white">{activeTab.label}</h2>
          <p className="mt-1 text-xs text-muted">{tab === "profil" ? "Personnalisez les informations visibles sur votre compte." : tab === "preferences" ? "Personnalisez l’accueil, le catalogue, le calendrier, la lecture et l’apparence." : "Protégez votre compte et gérez les appareils connectés."}</p>
        </div>
        {tab === "profil" && <ProfilePanel />}
        {tab === "preferences" && <PreferencesPanel />}
        {tab === "securite" && <SecurityPanel />}
      </section>
      </div>
    </div>
  );
}
