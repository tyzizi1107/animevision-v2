"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  AccountInput,
  Alert,
  FieldLabel,
  Panel,
  PanelHeader,
  SaveButton,
  type StatusMessage,
} from "@/components/account/ui";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { AVATAR_OPTIONS, avatarImageSrc, normalizeAvatar } from "@/lib/avatar";
import { cn } from "@/lib/utils";

export function ProfilePanel() {
  const { user, setUser } = useAuth();
  const avatarCarousel = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const ignoreNextAvatarClick = useRef(false);
  const [name, setName] = useState(user?.name ?? "");
  const [avatar, setAvatar] = useState(normalizeAvatar(user?.avatar));
  const [avatarStart, setAvatarStart] = useState(0);
  const [visibleAvatarCount, setVisibleAvatarCount] = useState(4);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [busy, setBusy] = useState(false);

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const form = new FormData();
      form.append("avatar", file);
      const response = await fetch("/api/compte/profile/avatar", { method: "POST", body: form });
      const payload = (await response.json().catch(() => ({}))) as { user?: typeof user; error?: string };
      if (!response.ok || !payload.user) {
        setStatus({ type: "error", message: payload.error ?? "Téléversement impossible." });
        return;
      }
      setUser(payload.user);
      setAvatar(payload.user.avatar);
      setStatus({ type: "success", message: "Image de profil mise à jour." });
    } catch {
      setStatus({ type: "error", message: "Impossible de joindre le serveur." });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const container = avatarCarousel.current;
    if (!container) return;
    const updateVisibleCount = () => {
      const count = Math.min(10, AVATAR_OPTIONS.length, Math.max(1, Math.floor((container.clientWidth + 12) / 68)));
      setVisibleAvatarCount(count);
      setAvatarStart((start) => Math.min(start, Math.max(0, AVATAR_OPTIONS.length - count)));
    };
    updateVisibleCount();
    const observer = new ResizeObserver(updateVisibleCount);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  if (!user) return null;

  const dirty = name.trim() !== user.name || avatar !== normalizeAvatar(user.avatar);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    try {
      const response = await fetch("/api/compte/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, avatar }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        user?: typeof user;
        error?: string;
        details?: Record<string, string> | null;
      };

      if (!response.ok || !payload.user) {
        setStatus({
          type: "error",
          message: payload.details?.name ?? payload.error ?? "Enregistrement impossible.",
        });
        return;
      }

      setUser(payload.user);
      setStatus({ type: "success", message: "Profil mis à jour." });
    } catch {
      setStatus({ type: "error", message: "Impossible de joindre le serveur." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Panel>
        <PanelHeader
          title="Identité"
          description="Choisissez l’image qui apparaîtra dans la barre de navigation et sur votre compte."
        />

        <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
          <img
            src={avatarImageSrc(avatar)}
            alt="Aperçu de l’avatar"
            className="h-20 w-20 shrink-0 rounded-2xl object-cover shadow-[0_20px_45px_-20px_rgba(0,0,0,0.9)]"
          />

          <div className="grid min-w-0 flex-1 gap-4">
            <div>
              <label htmlFor="display-name">
                <FieldLabel>Nom d'affichage</FieldLabel>
              </label>
              <AccountInput
                id="display-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={40}
                placeholder="Votre nom"
                autoComplete="nickname"
              />
            </div>
            <div>
              <FieldLabel>Adresse e-mail</FieldLabel>
              <div className="flex h-11 items-center justify-between gap-3 rounded-xl border border-line bg-white/[0.02] px-4">
                <span className="truncate text-sm text-white/70">{user.email}</span>
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                  Vérifiée
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-muted/80">
                L'adresse e-mail ne peut pas être modifiée pour le moment.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <FieldLabel>Avatar du compte</FieldLabel>
          {user.role === "admin" && (
            <div className="mb-4 mt-2">
              <FieldLabel>Importer une image ou un GIF (administrateur)</FieldLabel>
              <div className="mt-2 flex items-center gap-3">
                <input
                  id="custom-avatar-file"
                  type="file"
                  accept="image/gif,image/png,image/jpeg,image/webp,.gif,.png,.jpg,.jpeg,.webp"
                  disabled={busy}
                  onChange={(event) => {
                    void uploadAvatar(event.currentTarget.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                  className="peer sr-only"
                />
                <label htmlFor="custom-avatar-file" aria-label="Choisir un fichier avatar" title="Choisir un fichier avatar" className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-brand/45 bg-brand/15 text-brand-2 transition hover:bg-brand/30 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-panel peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                  <PlusIcon className="h-5 w-5" />
                </label>
                <span className="text-xs font-medium text-white/75">Ajouter une image ou un GIF</span>
              </div>
              <p className="mt-1.5 text-[11px] text-muted/80">
                Réservé aux administrateurs. GIF, PNG, JPEG ou WebP, jusqu’à 5 Mo. Le fichier porte votre nom de compte ; l’ancien est supprimé au remplacement.
              </p>
            </div>
          )}
          <div className="flex w-full min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setAvatarStart((start) => Math.max(0, start - visibleAvatarCount))}
              disabled={avatarStart === 0}
              aria-label="Avatars précédents"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-white/[0.03] text-xl text-white/75 transition hover:border-brand/60 hover:bg-brand/20 hover:text-white disabled:cursor-default disabled:opacity-30"
            >
              ‹
            </button>
            <div
              ref={avatarCarousel}
              aria-label="Carrousel des avatars"
              onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
              onTouchEnd={(event) => {
                const start = touchStartX.current;
                const end = event.changedTouches[0]?.clientX;
                touchStartX.current = null;
                if (start === null || end === undefined || Math.abs(end - start) < 35) return;
                ignoreNextAvatarClick.current = true;
                window.setTimeout(() => { ignoreNextAvatarClick.current = false; }, 300);
                setAvatarStart((index) => end < start
                  ? Math.min(AVATAR_OPTIONS.length - visibleAvatarCount, index + visibleAvatarCount)
                  : Math.max(0, index - visibleAvatarCount));
              }}
              className="min-w-0 flex-1 overflow-hidden px-1 py-2"
            >
              <div className="flex gap-3">
              {AVATAR_OPTIONS.slice(avatarStart, avatarStart + visibleAvatarCount).map((option) => {
                const selected = avatar === option;
                const label = option === "default.jpg" ? "Avatar par défaut" : `Avatar ${option.replace(".jpg", "")}`;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      if (ignoreNextAvatarClick.current) return;
                      setAvatar(option);
                    }}
                    aria-label={label}
                    aria-pressed={selected}
                    className={cn(
                      "relative h-14 w-14 shrink-0 snap-start overflow-hidden rounded-xl ring-offset-2 ring-offset-panel transition",
                      selected ? "ring-2 ring-brand" : "ring-1 ring-white/10 hover:ring-white/40",
                    )}
                  >
                    <img src={avatarImageSrc(option)} alt="" className="h-full w-full object-cover" />
                    {selected && (
                      <span className="absolute inset-0 grid place-items-center bg-black/25">
                        <CheckIcon className="h-4 w-4 text-white drop-shadow" />
                      </span>
                    )}
                  </button>
                );
              })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAvatarStart((start) => Math.min(AVATAR_OPTIONS.length - visibleAvatarCount, start + visibleAvatarCount))}
              disabled={avatarStart + visibleAvatarCount >= AVATAR_OPTIONS.length}
              aria-label="Avatars suivants"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-white/[0.03] text-xl text-white/75 transition hover:border-brand/60 hover:bg-brand/20 hover:text-white disabled:cursor-default disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>

      </Panel>

      <Alert status={status} />

      <div className="flex justify-end">
        <SaveButton busy={busy} disabled={!dirty}>
          Enregistrer le profil
        </SaveButton>
      </div>
    </form>
  );
}
