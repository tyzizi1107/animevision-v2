"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AccountInput,
  Alert,
  FieldLabel,
  Panel,
  PanelHeader,
  type StatusMessage,
} from "@/components/account/ui";
import { useAuth } from "@/components/auth/auth-provider";
import { AlertTriangleIcon, MonitorIcon, ShieldIcon } from "@/components/icons";
import { formatDate } from "@/lib/utils";

type SessionInfo = {
  id: string;
  device: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

export function SecurityPanel() {
  const { user, refresh } = useAuth();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [sessionMessage, setSessionMessage] = useState<StatusMessage>(null);
  const [busySession, setBusySession] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/compte/sessions", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { sessions: SessionInfo[] };
      setSessions(payload.sessions);
    } catch {
      setSessionMessage({ type: "error", message: "Impossible de charger les sessions." });
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  if (!user) return null;

  const revoke = async (id: string) => {
    setBusySession(id);
    setSessionMessage(null);
    try {
      const response = await fetch(`/api/compte/sessions/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setSessionMessage({ type: "error", message: payload.error ?? "Suppression impossible." });
        return;
      }
      setSessions((current) => current?.filter((item) => item.id !== id) ?? null);
      setSessionMessage({ type: "success", message: "Session déconnectée." });
    } catch {
      setSessionMessage({ type: "error", message: "Impossible de joindre le serveur." });
    } finally {
      setBusySession(null);
    }
  };

  const revokeOthers = async () => {
    setBusySession("others");
    setSessionMessage(null);
    try {
      const response = await fetch("/api/compte/sessions", { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { revoked?: number; error?: string };
      if (!response.ok) {
        setSessionMessage({ type: "error", message: payload.error ?? "Action impossible." });
        return;
      }
      await loadSessions();
      setSessionMessage({
        type: "success",
        message:
          payload.revoked && payload.revoked > 0
            ? `${payload.revoked} session(s) déconnectée(s).`
            : "Aucune autre session active.",
      });
    } catch {
      setSessionMessage({ type: "error", message: "Impossible de joindre le serveur." });
    } finally {
      setBusySession(null);
    }
  };

  return (
    <div className="space-y-4">
      <PasswordPanel onChanged={refresh} />

      <Panel>
        <PanelHeader
          title="Sessions actives"
          description="Votre session persiste 60 jours. Révoquez tout appareil que vous ne reconnaissez pas."
          action={
            <button
              type="button"
              onClick={() => void revokeOthers()}
              disabled={busySession === "others"}
              className="h-9 rounded-full border border-line px-3.5 text-xs font-medium text-white/80 transition hover:border-white/25 hover:text-white disabled:opacity-50"
            >
              Déconnecter les autres appareils
            </button>
          }
        />

        <div className="mt-4">
          <Alert status={sessionMessage} />
        </div>

        <div className="mt-2 divide-y divide-line">
          {sessions === null && (
            <p className="py-6 text-center text-xs text-muted">Chargement des sessions…</p>
          )}
          {sessions?.length === 0 && (
            <p className="py-6 text-center text-xs text-muted">Aucune session active.</p>
          )}
          {sessions?.map((session) => (
            <div key={session.id} className="flex flex-wrap items-center gap-3 py-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.03] text-muted">
                <MonitorIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-white/90">
                  <span className="truncate">{session.device}</span>
                  {session.current && (
                    <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      Cet appareil
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  Dernière activité : {formatDate(session.lastSeenAt, { dateStyle: "medium", timeStyle: "short" })}
                  {session.ip ? ` · ${session.ip}` : ""}
                </p>
              </div>
              {!session.current && (
                <button
                  type="button"
                  onClick={() => void revoke(session.id)}
                  disabled={busySession === session.id}
                  className="h-8 rounded-full border border-red-400/25 px-3 text-[11px] font-medium text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
                >
                  {busySession === session.id ? "…" : "Déconnecter"}
                </button>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <DeleteAccountPanel />
    </div>
  );
}

function PasswordPanel({ onChanged }: { onChanged: () => Promise<unknown> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<StatusMessage>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    if (newPassword !== confirm) {
      setStatus({ type: "error", message: "Les nouveaux mots de passe ne correspondent pas." });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/compte/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: Record<string, string> | null;
        revoked?: number;
      };

      if (!response.ok) {
        setStatus({
          type: "error",
          message: payload.details?.newPassword ?? payload.details?.currentPassword ?? payload.error ?? "Modification impossible.",
        });
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setStatus({
        type: "success",
        message:
          payload.revoked && payload.revoked > 0
            ? `Mot de passe modifié. ${payload.revoked} autre(s) session(s) ont été déconnectées.`
            : "Mot de passe modifié.",
      });
      await onChanged();
    } catch {
      setStatus({ type: "error", message: "Impossible de joindre le serveur." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelHeader
        title="Mot de passe"
        description="Après modification, toutes vos autres sessions sont automatiquement déconnectées."
        action={
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-white/[0.03] text-muted">
            <ShieldIcon className="h-4 w-4" />
          </span>
        }
      />

      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="current-password">
            <FieldLabel>Mot de passe actuel</FieldLabel>
          </label>
          <AccountInput
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="new-password">
            <FieldLabel>Nouveau mot de passe</FieldLabel>
          </label>
          <AccountInput
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="confirm-password">
            <FieldLabel>Confirmation</FieldLabel>
          </label>
          <AccountInput
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
          />
        </div>

        <div className="sm:col-span-3">
          <Alert status={status} />
        </div>

        <div className="sm:col-span-3 flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-10 items-center rounded-full bg-brand px-5 text-sm font-bold text-white transition hover:brightness-105 disabled:opacity-50"
          >
            {busy ? "Modification…" : "Modifier le mot de passe"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function DeleteAccountPanel() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<StatusMessage>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    setBusy(true);

    try {
      const response = await fetch("/api/compte", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: Record<string, string> | null;
      };

      if (!response.ok) {
        setStatus({
          type: "error",
          message: payload.details?.password ?? payload.details?.confirmation ?? payload.error ?? "Suppression impossible.",
        });
        return;
      }

      window.location.assign("/");
    } catch {
      setStatus({ type: "error", message: "Impossible de joindre le serveur." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="border-red-400/20 bg-red-500/[0.04]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-red-200">
            <AlertTriangleIcon className="h-4 w-4" />
            Supprimer mon compte
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Cette action est définitive : votre compte, vos préférences et toutes vos sessions
            seront supprimés. Votre liste locale sur cet appareil restera intacte.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="h-9 rounded-full border border-red-400/30 px-3.5 text-xs font-medium text-red-200 transition hover:bg-red-500/10"
        >
          {open ? "Annuler" : "Supprimer…"}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="mt-5 space-y-4 border-t border-red-400/15 pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="delete-password">
                <FieldLabel>Mot de passe</FieldLabel>
              </label>
              <AccountInput
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="delete-confirmation">
                <FieldLabel>
                  Tapez <span className="font-mono text-white">SUPPRIMER</span>
                </FieldLabel>
              </label>
              <AccountInput
                id="delete-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="SUPPRIMER"
                required
              />
            </div>
          </div>

          <Alert status={status} />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy || confirmation !== "SUPPRIMER"}
              className="inline-flex h-10 items-center rounded-full bg-red-500 px-5 text-sm font-bold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Suppression…" : "Supprimer définitivement"}
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}
