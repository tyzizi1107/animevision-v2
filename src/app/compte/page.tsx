import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountView } from "@/components/account/account-view";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Mon compte",
  description: "Gérez votre profil, vos préférences et la sécurité de votre compte AnimeVision.",
};

const TABS = ["profil", "preferences", "securite"] as const;
type Tab = (typeof TABS)[number];

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/connexion?next=/compte");

  const params = await searchParams;
  const tab: Tab = TABS.includes(params.tab as Tab) ? (params.tab as Tab) : "profil";

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-16 pt-28 sm:px-6 lg:px-8">
      <div className="max-w-2xl">
        <p className="eyebrow">Compte</p>
        <h1 className="page-title mt-3 text-[2rem] text-ink sm:text-[2.75rem]">Paramètres du compte</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
          Votre identité, vos préférences de lecture et la sécurité de votre session — au même
          endroit.
        </p>
      </div>

      <div className="mt-10">
        <AccountView initialTab={tab} />
      </div>
    </div>
  );
}
