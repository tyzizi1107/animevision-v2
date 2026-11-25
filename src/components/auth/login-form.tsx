"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { EyeIcon, EyeOffIcon } from "@/components/icons";
import { utilisateurDepuisApi } from "@/lib/api-localization";
import { cn } from "@/lib/utils";

type FieldErrors = Record<string, string>;

export function LoginForm({ nextPath, initialEmail = "" }: { nextPath: string; initialEmail?: string }) {
  const router = useRouter();
  const { refresh, setUser } = useAuth();

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);

    try {
      const response = await fetch("/api/authentification/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: FieldErrors | null;
        utilisateur?: unknown;
      };

      if (!response.ok) {
        setMessage(payload.error ?? "Connexion impossible.");
        if (payload.details) setErrors(payload.details);
        return;
      }

      const user = utilisateurDepuisApi(payload.utilisateur);
      if (user) setUser(user);
      else void refresh();
      router.replace("/");
    } catch {
      setMessage("Impossible de joindre le serveur. Vérifiez votre connexion.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {message && (
        <div
          role="alert"
          className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {message}
        </div>
      )}

      <Field label="Adresse e-mail" htmlFor="email" error={errors.email}>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="moi@animevision.fr"
          className={inputClass(Boolean(errors.email))}
          required
        />
      </Field>

      <Field
        label="Mot de passe"
        htmlFor="password"
        error={errors.password}
        aside={
          <span className="text-[11px] text-muted/70">8 caractères minimum</span>
        }
      >
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            className={cn(inputClass(Boolean(errors.password)), "pr-11")}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted transition hover:bg-white/10 hover:text-white"
          >
            {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
          </button>
        </div>
      </Field>

      <label className="flex cursor-pointer select-none items-start gap-2.5 rounded-xl border border-line bg-white/[0.02] px-3.5 py-3">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#7c5cff]"
        />
        <span className="text-xs leading-relaxed text-muted">
          <span className="font-medium text-white/85">Rester connecté 60 jours</span> — vous ne
          serez pas déconnecté en fermant le navigateur.
        </span>
      </label>

      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand text-sm font-bold text-white shadow-[0_18px_45px_-24px_rgba(65,0,154,0.9)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Connexion…" : "Se connecter"}
      </button>

      <p className="pt-1 text-center text-xs text-muted">
        Pas encore de compte ?{" "}
        <Link href={`/inscription?next=${encodeURIComponent(nextPath)}`} className="font-semibold text-white underline underline-offset-2 hover:text-brand-2">
          Créer un compte
        </Link>
      </p>
    </form>
  );
}

export function inputClass(hasError: boolean): string {
  return cn(
    "h-11 w-full rounded-xl border bg-white/[0.04] px-4 text-sm text-ink placeholder:text-muted/50 transition focus:bg-white/[0.07] focus:outline-none",
    hasError
      ? "border-red-400/60 focus:border-red-400"
      : "border-line focus:border-brand/60",
  );
}

export function Field({
  label,
  htmlFor,
  error,
  aside,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-xs font-medium text-white/75">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
