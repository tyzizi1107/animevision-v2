import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { ShieldIcon } from "@/components/icons";
import { getSessionUser } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/connexion?next=/admin/annonces");
  if (user.role !== "admin") redirect("/compte");

  return (
    <div className="relative mx-auto max-w-[1440px] px-4 pb-20 pt-28 sm:px-6 lg:px-10">
      <header className="relative mb-7 overflow-hidden rounded-[28px] border border-brand/20 bg-gradient-to-br from-[#191024] via-[#100d16] to-[#0b0a0e] p-6 shadow-[0_28px_80px_-55px_rgba(104,46,180,0.8)] sm:p-8">
        <div className="absolute -right-12 -top-28 h-72 w-72 rounded-full border border-white/[0.04]" />
        <div className="absolute -right-2 -top-20 h-56 w-56 rounded-full border border-white/[0.05]" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-brand-2/25 bg-brand/20 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-2">
              <ShieldIcon className="h-3 w-3" />
              Espace sécurisé · Administration
            </p>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Centre de contrôle</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">
              Gérez le catalogue, les annonces et les accès aux comptes depuis un seul endroit.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right backdrop-blur">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Connecté en tant que</p>
            <p className="mt-1 max-w-56 truncate text-sm font-bold text-white">{user.name}</p>
          </div>
        </div>
      </header>
      <div className="relative mb-7"><AdminNav /></div>
      {children}
    </div>
  );
}
