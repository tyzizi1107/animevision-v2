"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EditIcon } from "@/components/icons";
import { LEVEL_META } from "@/components/announcements/level";
import { useAnnouncements } from "@/components/announcements/announcements-provider";
import {
  AccountInput,
  Alert,
  FieldLabel,
  type StatusMessage,
} from "@/components/account/ui";
import { MegaphoneIcon, PlusIcon, TrashIcon } from "@/components/icons";
import type { Announcement, AnnouncementLevel } from "@/lib/db-types";
import { cn, formatDate } from "@/lib/utils";

type FormState = {
  titre: string;
  body: string;
  level: AnnouncementLevel;
  active: boolean;
  pinned: boolean;
  linkLabel: string;
  linkHref: string;
  startsAt: string;
  endsAt: string;
};

const EMPTY_FORM: FormState = {
  titre: "",
  body: "",
  level: "info",
  active: true,
  pinned: false,
  linkLabel: "",
  linkHref: "",
  startsAt: "",
  endsAt: "",
};

const LEVELS: AnnouncementLevel[] = ["info", "success", "warning", "critical"];

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sortAnnouncements(items: Announcement[]): Announcement[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function AnnouncementManager({ initial }: { initial: Announcement[] }) {
  const router = useRouter();
  const { refresh: refreshAnnouncements } = useAnnouncements();

  const [items, setItems] = useState<Announcement[]>(sortAnnouncements(initial));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<StatusMessage>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setStatus(null);
    setFormOpen(true);
  };

  const openEdit = (announcement: Announcement) => {
    setEditingId(announcement.id);
    setForm({
      titre: announcement.titre,
      body: announcement.body,
      level: announcement.level,
      active: announcement.active,
      pinned: announcement.pinned,
      linkLabel: announcement.linkLabel ?? "",
      linkHref: announcement.linkHref ?? "",
      startsAt: toLocalInput(announcement.startsAt),
      endsAt: toLocalInput(announcement.endsAt),
    });
    setErrors({});
    setStatus(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
  };

  const buildPayload = (state: FormState) => ({
    titre: state.titre,
    body: state.body,
    level: state.level,
    active: state.active,
    pinned: state.pinned,
    linkLabel: state.linkLabel,
    linkHref: state.linkHref,
    startsAt: state.startsAt ? new Date(state.startsAt).toISOString() : null,
    endsAt: state.endsAt ? new Date(state.endsAt).toISOString() : null,
  });

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setErrors({});

    try {
      const endpoint = editingId ? `/api/annonces/${editingId}` : "/api/annonces";
      const response = await fetch(endpoint, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(form)),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        announcement?: Announcement;
        error?: string;
        details?: Record<string, string> | null;
      };

      if (!response.ok || !payload.announcement) {
        setStatus({ type: "error", message: payload.error ?? "Enregistrement impossible." });
        if (payload.details) setErrors(payload.details);
        return;
      }

      setItems((current) =>
        sortAnnouncements(
          editingId
            ? current.map((item) => (item.id === editingId ? payload.announcement! : item))
            : [payload.announcement!, ...current],
        ),
      );
      setStatus({
        type: "success",
        message: editingId ? "Annonce mise à jour." : "Annonce publiée.",
      });
      closeForm();
      void refreshAnnouncements();
      router.refresh();
    } catch {
      setStatus({ type: "error", message: "Impossible de joindre le serveur." });
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (announcement: Announcement) => {
    setBusyId(announcement.id);
    setStatus(null);
    try {
      const response = await fetch(`/api/annonces/${announcement.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildPayload({
            titre: announcement.titre,
            body: announcement.body,
            level: announcement.level,
            active: !announcement.active,
            pinned: announcement.pinned,
            linkLabel: announcement.linkLabel ?? "",
            linkHref: announcement.linkHref ?? "",
            startsAt: toLocalInput(announcement.startsAt),
            endsAt: toLocalInput(announcement.endsAt),
          }),
        ),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        announcement?: Announcement;
        error?: string;
      };
      if (!response.ok || !payload.announcement) {
        setStatus({ type: "error", message: payload.error ?? "Action impossible." });
        return;
      }
      setItems((current) =>
        current.map((item) => (item.id === announcement.id ? payload.announcement! : item)),
      );
      void refreshAnnouncements();
      router.refresh();
    } catch {
      setStatus({ type: "error", message: "Impossible de joindre le serveur." });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (announcement: Announcement) => {
    if (!window.confirm(`Supprimer définitivement « ${announcement.titre} » ?`)) return;
    setBusyId(announcement.id);
    setStatus(null);
    try {
      const response = await fetch(`/api/annonces/${announcement.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setStatus({ type: "error", message: payload.error ?? "Suppression impossible." });
        return;
      }
      setItems((current) => current.filter((item) => item.id !== announcement.id));
      setStatus({ type: "success", message: "Annonce supprimée." });
      void refreshAnnouncements();
      router.refresh();
    } catch {
      setStatus({ type: "error", message: "Impossible de joindre le serveur." });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {items.filter((item) => item.active).length} active(s) · {items.length} au total
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-xs font-bold text-white transition hover:brightness-105"
        >
          <PlusIcon className="h-4 w-4" />
          Nouvelle annonce
        </button>
      </div>

      <Alert status={status} />

      {formOpen && (
        <form
          onSubmit={submit}
          className="rounded-2xl border border-brand/25 bg-panel/70 p-5 shadow-[0_30px_80px_-40px_rgba(124,92,255,0.6)] sm:p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">
              {editingId ? "Modifier l'annonce" : "Publier une annonce"}
            </h2>
            <button
              type="button"
              onClick={closeForm}
              className="text-xs text-muted transition hover:text-white"
            >
              Annuler
            </button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="announcement-title">
                <FieldLabel>Titre</FieldLabel>
              </label>
              <AccountInput
                id="announcement-title"
                value={form.titre}
                onChange={(event) => setField("titre", event.target.value)}
                placeholder="Nouvelle saison disponible"
                hasError={Boolean(errors.titre)}
                maxLength={120}
                required
              />
              {errors.titre && <p className="mt-1 text-[11px] text-red-300">{errors.titre}</p>}
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="announcement-body">
                <FieldLabel>Message</FieldLabel>
              </label>
              <textarea
                id="announcement-body"
                value={form.body}
                onChange={(event) => setField("body", event.target.value)}
                rows={4}
                placeholder="Décrivez brièvement l'information…"
                className={cn(
                  "w-full rounded-xl border bg-white/[0.04] px-4 py-3 text-sm text-ink placeholder:text-muted/50 transition focus:bg-white/[0.07] focus:outline-none",
                  errors.body ? "border-red-400/60" : "border-line focus:border-brand/60",
                )}
                required
              />
              <div className="mt-1 flex justify-between gap-3">
                {errors.body ? (
                  <p className="text-[11px] text-red-300">{errors.body}</p>
                ) : (
                  <span />
                )}
                <span className="text-[11px] text-muted/70">{form.body.length} / 2000</span>
              </div>
            </div>

            <div>
              <label htmlFor="announcement-level">
                <FieldLabel>Niveau</FieldLabel>
              </label>
              <select
                id="announcement-level"
                value={form.level}
                onChange={(event) => setField("level", event.target.value as AnnouncementLevel)}
                className="av-select h-11 w-full rounded-xl border border-line bg-white/[0.04] px-4 text-sm text-ink transition focus:border-brand/60 focus:outline-none"
              >
                {LEVELS.map((level) => (
                  <option key={level} value={level} className="bg-panel">
                    {LEVEL_META[level].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-5 pb-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => setField("active", event.target.checked)}
                  className="h-4 w-4 accent-[#7c5cff]"
                />
                Active
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(event) => setField("pinned", event.target.checked)}
                  className="h-4 w-4 accent-[#7c5cff]"
                />
                Épinglée
              </label>
            </div>

            <div>
              <label htmlFor="announcement-link-label">
                <FieldLabel>Libellé du lien (optionnel)</FieldLabel>
              </label>
              <AccountInput
                id="announcement-link-label"
                value={form.linkLabel}
                onChange={(event) => setField("linkLabel", event.target.value)}
                placeholder="Voir le catalogue"
                hasError={Boolean(errors.linkLabel)}
                maxLength={40}
              />
              {errors.linkLabel && (
                <p className="mt-1 text-[11px] text-red-300">{errors.linkLabel}</p>
              )}
            </div>

            <div>
              <label htmlFor="announcement-link-href">
                <FieldLabel>Lien (optionnel)</FieldLabel>
              </label>
              <AccountInput
                id="announcement-link-href"
                value={form.linkHref}
                onChange={(event) => setField("linkHref", event.target.value)}
                placeholder="/catalogue"
                hasError={Boolean(errors.linkHref)}
              />
              {errors.linkHref && (
                <p className="mt-1 text-[11px] text-red-300">{errors.linkHref}</p>
              )}
            </div>

            <div>
              <label htmlFor="announcement-start">
                <FieldLabel>Début de diffusion (optionnel)</FieldLabel>
              </label>
              <AccountInput
                id="announcement-start"
                type="datetime-local"
                value={form.startsAt}
                onChange={(event) => setField("startsAt", event.target.value)}
                hasError={Boolean(errors.startsAt)}
              />
              {errors.startsAt && <p className="mt-1 text-[11px] text-red-300">{errors.startsAt}</p>}
            </div>

            <div>
              <label htmlFor="announcement-end">
                <FieldLabel>Fin de diffusion (optionnel)</FieldLabel>
              </label>
              <AccountInput
                id="announcement-end"
                type="datetime-local"
                value={form.endsAt}
                onChange={(event) => setField("endsAt", event.target.value)}
                hasError={Boolean(errors.endsAt)}
              />
              {errors.endsAt && <p className="mt-1 text-[11px] text-red-300">{errors.endsAt}</p>}
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={closeForm}
              className="h-10 rounded-full border border-line px-4 text-sm text-muted transition hover:text-white"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-10 items-center rounded-full bg-brand px-5 text-sm font-bold text-white transition hover:brightness-105 disabled:opacity-50"
            >
              {busy ? "Enregistrement…" : editingId ? "Mettre à jour" : "Publier"}
            </button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.04] text-muted">
            <MegaphoneIcon className="h-5 w-5" />
          </span>
          <p className="mt-4 text-sm font-semibold text-white">Aucune annonce</p>
          <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-muted">
            Publiez votre première annonce : elle s'affichera dans le centre d'annonces et en
            notification sur le site.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((announcement) => {
            const meta = LEVEL_META[announcement.level] ?? LEVEL_META.info;
            return (
              <li
                key={announcement.id}
                className={cn(
                  "rounded-2xl border bg-panel/50 p-4 sm:p-5",
                  announcement.active ? meta.border : "border-line opacity-70",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          meta.badge,
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                        {meta.label}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          announcement.active
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-white/5 text-muted",
                        )}
                      >
                        {announcement.active ? "Active" : "Inactive"}
                      </span>
                      {announcement.pinned && (
                        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/60">
                          Épinglée
                        </span>
                      )}
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-white">{announcement.titre}</h3>
                    <p className="mt-1 line-clamp-2 max-w-2xl text-xs leading-relaxed text-muted">
                      {announcement.body}
                    </p>
                    <p className="mt-2 text-[11px] text-muted/60">
                      {formatDate(announcement.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                      {announcement.startsAt
                        ? ` · début ${formatDate(announcement.startsAt, { dateStyle: "short", timeStyle: "short" })}`
                        : ""}
                      {announcement.endsAt
                        ? ` · fin ${formatDate(announcement.endsAt, { dateStyle: "short", timeStyle: "short" })}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(announcement)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[11px] font-medium text-white/80 transition hover:border-white/25 hover:text-white"
                    >
                      <EditIcon className="h-3.5 w-3.5" />
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleActive(announcement)}
                      disabled={busyId === announcement.id}
                      className="h-8 rounded-full border border-line px-3 text-[11px] font-medium text-white/80 transition hover:border-white/25 hover:text-white disabled:opacity-50"
                    >
                      {announcement.active ? "Désactiver" : "Activer"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(announcement)}
                      disabled={busyId === announcement.id}
                      aria-label={`Supprimer ${announcement.titre}`}
                      className="grid h-8 w-8 place-items-center rounded-full border border-red-400/25 text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
