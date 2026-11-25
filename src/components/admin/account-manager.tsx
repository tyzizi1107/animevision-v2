"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { avatarImageSrc } from "@/lib/avatar";
import { cn } from "@/lib/utils";

type ManagedAccount = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  avatar: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  blocked: boolean;
  lastIp: string | null;
  ipBlocked: boolean;
};

function formatAccountDate(value: string | null) {
  if (!value) return "Jamais";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

export function AccountManager() {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadAccounts = useCallback(async (search: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/administration/users?q=${encodeURIComponent(search)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Impossible de charger les comptes.");
      setAccounts(result.users ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAccounts(query.trim()); }, 250);
    return () => window.clearTimeout(timer);
  }, [query, loadAccounts]);

  const blockedCount = useMemo(() => accounts.filter((account) => account.blocked).length, [accounts]);
  const memberCount = useMemo(() => accounts.filter((account) => account.role === "user").length, [accounts]);
  const ipBlockedCount = useMemo(() => accounts.filter((account) => account.ipBlocked).length, [accounts]);

  const toggleBlocked = async (account: ManagedAccount) => {
    const nextBlocked = !account.blocked;
    setBusyId(`${account.id}:account`);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/administration/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: account.id, blocked: nextBlocked }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Modification impossible.");
      setAccounts((current) => current.map((item) => item.id === account.id ? { ...item, blocked: nextBlocked } : item));
      setNotice(nextBlocked ? `Le compte de ${account.name} est bloqué et ses sessions ont été fermées.` : `Le compte de ${account.name} est débloqué.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de modifier ce compte.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleIpBlock = async (account: ManagedAccount) => {
    if (!account.lastIp) return;
    const nextBlocked = !account.ipBlocked;
    if (nextBlocked && !window.confirm(`Bloquer l’adresse IP ${account.lastIp} ? Toutes les personnes qui partagent cette adresse ne pourront plus se connecter ni créer de compte.`)) return;
    setBusyId(`${account.id}:ip`);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/administration/ip-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: account.lastIp, blocked: nextBlocked, userId: account.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Modification impossible.");
      setAccounts((current) => current.map((item) => item.id === account.id ? { ...item, ipBlocked: nextBlocked } : item));
      setNotice(nextBlocked ? `L’adresse IP ${account.lastIp} est bloquée et ses sessions ont été fermées.` : `Le blocage de l’adresse IP ${account.lastIp} a été levé.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de modifier ce blocage IP.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Comptes affichés" value={accounts.length} detail="Les 200 plus récents maximum" />
        <Stat label="Membres" value={memberCount} detail="Comptes utilisateurs standards" />
        <Stat label="Bloqués" value={blockedCount} detail="Dans les résultats affichés" highlight={blockedCount > 0} />
        <Stat label="IPs bloquées" value={ipBlockedCount} detail="Associées aux comptes affichés" highlight={ipBlockedCount > 0} />
      </section>

      <section className="overflow-hidden rounded-3xl border border-line bg-panel/55 shadow-[0_25px_80px_-55px_rgba(0,0,0,0.9)]">
        <div className="flex flex-col gap-4 border-b border-line p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-2">Utilisateurs</p>
            <h2 className="mt-1 text-xl font-black text-white">Gestion des comptes</h2>
            <p className="mt-1 text-xs text-muted">Bloquez l’accès d’un membre ou réactivez son compte.</p>
          </div>
          <label className="block w-full sm:max-w-sm">
            <span className="sr-only">Rechercher par nom ou e-mail</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nom ou adresse e-mail…"
              className="h-11 w-full rounded-xl border border-line bg-black/25 px-4 text-sm text-white outline-none transition placeholder:text-muted/50 focus:border-brand/60"
            />
          </label>
        </div>

        {(error || notice) && <p role={error ? "alert" : "status"} className={cn("mx-5 mt-4 rounded-xl border px-4 py-3 text-sm sm:mx-6", error ? "border-red-400/25 bg-red-500/10 text-red-200" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-200")}>{error || notice}</p>}

        <div className="hidden grid-cols-[minmax(220px,1.5fr)_minmax(130px,1fr)_130px_130px_130px] gap-4 border-b border-line bg-black/15 px-6 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted lg:grid">
          <span>Compte</span><span>Statut</span><span>Créé le</span><span>Dernière connexion</span><span className="text-right">Action</span>
        </div>

        <div className="divide-y divide-white/[0.06]">
          {loading && !accounts.length ? (
            <div className="p-8 text-center text-sm text-muted">Chargement des comptes…</div>
          ) : accounts.length === 0 ? (
            <div className="p-10 text-center"><p className="font-semibold text-white">Aucun compte trouvé</p><p className="mt-1 text-xs text-muted">Essaie avec un autre nom ou e-mail.</p></div>
          ) : accounts.map((account) => (
            <article key={account.id} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(220px,1.5fr)_minmax(130px,1fr)_130px_130px_130px] lg:items-center lg:gap-4 lg:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <img src={avatarImageSrc(account.avatar)} alt="" className="h-11 w-11 shrink-0 rounded-xl border border-white/10 object-cover" />
                <div className="min-w-0"><p className="truncate text-sm font-bold text-white">{account.name}</p><p className="truncate text-xs text-muted">{account.email}</p></div>
              </div>
              <div>
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide", account.role === "admin" ? "border-brand-2/25 bg-brand/15 text-brand-2" : account.blocked ? "border-red-400/25 bg-red-500/10 text-red-200" : "border-emerald-400/20 bg-emerald-500/[0.07] text-emerald-200")}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", account.role === "admin" ? "bg-brand-2" : account.blocked ? "bg-red-300" : "bg-emerald-300")} />
                  {account.role === "admin" ? "Administrateur" : account.blocked ? "Bloqué" : "Actif"}
                </span>
              </div>
              <div className="flex justify-between text-xs lg:block"><span className="text-muted lg:hidden">Créé le</span><span className="text-white/75">{formatAccountDate(account.createdAt)}</span></div>
              <div className="flex justify-between gap-3 text-xs lg:block"><span className="text-muted lg:hidden">Dernière connexion · IP</span><span className="text-right text-white/75 lg:text-left">{formatAccountDate(account.lastLoginAt)}{account.lastIp && <span className="mt-1 block max-w-40 truncate font-mono text-[10px] text-muted" title={account.lastIp}>IP {account.lastIp}</span>}</span></div>
              <div className="flex justify-end">
                {account.role === "user" ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={busyId === `${account.id}:account` || busyId === `${account.id}:ip`}
                      onClick={() => void toggleBlocked(account)}
                      className={cn("inline-flex h-9 min-w-24 items-center justify-center rounded-xl border px-3 text-xs font-bold transition disabled:cursor-wait disabled:opacity-50", account.blocked ? "border-emerald-400/25 text-emerald-200 hover:bg-emerald-500/10" : "border-red-400/25 text-red-200 hover:bg-red-500/10")}
                    >
                      {busyId === `${account.id}:account` ? "Patiente…" : account.blocked ? "Débloquer" : "Bloquer"}
                    </button>
                    <button
                      type="button"
                      disabled={!account.lastIp || busyId === `${account.id}:ip` || busyId === `${account.id}:account`}
                      onClick={() => void toggleIpBlock(account)}
                      title={account.lastIp ? `Adresse IP connue : ${account.lastIp}` : "Aucune adresse IP de session disponible"}
                      className={cn("inline-flex h-9 min-w-28 items-center justify-center rounded-xl border px-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-35", account.ipBlocked ? "border-amber-300/25 text-amber-200 hover:bg-amber-500/10" : "border-brand-2/25 text-brand-2 hover:bg-brand/15")}
                    >
                      {busyId === `${account.id}:ip` ? "Patiente…" : account.ipBlocked ? "Lever blocage IP" : "Bloquer IP"}
                    </button>
                  </div>
                ) : <span className="text-xs text-muted">Protégé</span>}
              </div>
            </article>
          ))}
        </div>
        {accounts.length >= 200 && <p className="border-t border-line px-5 py-3 text-center text-[11px] text-muted">Limite de 200 comptes atteinte. Utilise la recherche pour trouver un compte plus ancien.</p>}
      </section>
    </div>
  );
}

function Stat({ label, value, detail, highlight = false }: { label: string; value: number; detail: string; highlight?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-gradient-to-br from-panel to-[#0d0c11] p-4 sm:p-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-muted">{label}</p>
      <p className={cn("mt-2 text-3xl font-black tracking-tight", highlight ? "text-red-200" : "text-white")}>{value}</p>
      <p className="mt-1 text-[11px] text-muted/75">{detail}</p>
    </div>
  );
}
