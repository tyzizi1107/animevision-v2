"use client";

import Link from "next/link";
import { LegalLink } from "@/components/legal/legal-dialog";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Field, inputClass } from "@/components/auth/login-form";
import { useAuth } from "@/components/auth/auth-provider";
import { CheckIcon, EyeIcon, EyeOffIcon } from "@/components/icons";
import { utilisateurDepuisApi } from "@/lib/api-localization";
import { cn } from "@/lib/utils";
import { passwordStrength, validatePassword } from "@/lib/validation";

type FieldErrors = Record<string, string>;

export function RegisterForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const { refresh, setUser } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);
  const passwordHint = password.length > 0 ? validatePassword(password) : null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    const localErrors: FieldErrors = {};
    if (name.trim().length < 2) localErrors.name = "Indiquez au moins 2 caractères.";
    if (!accepted) localErrors.accepted = "Vous devez accepter les conditions d'utilisation.";
    if (password !== confirm) localErrors.confirm = "Les mots de passe ne correspondent pas.";
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      return;
    }

    setBusy(true);
    setErrors({});
    try {
      const response = await fetch("/api/authentification/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, acceptTerms: accepted }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: FieldErrors | null;
        utilisateur?: unknown;
      };

      if (!response.ok) {
        setMessage(payload.error ?? "Inscription impossible.");
        if (payload.details) setErrors(payload.details);
        return;
      }

      const user = utilisateurDepuisApi(payload.utilisateur);
      if (user) setUser(user);
      else void refresh();
      router.replace("/compte");
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

      <Field label="Nom d'utilisateur" htmlFor="name" error={errors.name}>
        <input
          id="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Kaito"
          className={inputClass(Boolean(errors.name))}
          maxLength={40}
          required
        />
      </Field>

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
          password.length > 0 ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className={cn("h-1.5 w-1.5 rounded-full", strength.color)} />
              {strength.label}
            </span>
          ) : undefined
        }
      >
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="8 caractères, une lettre, un chiffre"
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
        <div className="mt-2 flex gap-1" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((step) => (
            <span
              key={step}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                step <= strength.score ? strength.color : "bg-white/10",
              )}
            />
          ))}
        </div>
        {passwordHint && password.length > 0 && (
          <p className="mt-1.5 text-[11px] text-muted/80">{passwordHint}</p>
        )}
      </Field>

      <Field label="Confirmer le mot de passe" htmlFor="confirm" error={errors.confirm}>
        <div className="relative">
          <input
            id="confirm"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="••••••••"
            className={cn(inputClass(Boolean(errors.confirm)), "pr-9")}
            required
          />
          {confirm.length > 0 && password === confirm && (
            <CheckIcon className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-400" />
          )}
        </div>
      </Field>

      <label className="flex cursor-pointer select-none items-start gap-2.5 rounded-xl border border-line bg-white/[0.02] px-3.5 py-3">
        <input
          id="accept-terms"
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          aria-invalid={Boolean(errors.accepted)}
          aria-describedby={errors.accepted ? "accept-terms-error" : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#7c5cff]"
        />
        <span className="text-xs leading-relaxed text-muted">
          J'accepte les{" "}
          <LegalLink document="terms" className="text-white underline underline-offset-2">
            conditions d'utilisation
          </LegalLink>{" "}
          (obligatoire).
        </span>
      </label>
      {errors.accepted && <p id="accept-terms-error" className="text-[11px] text-red-300">{errors.accepted}</p>}
      <p className="-mt-2 px-1 text-xs text-muted">
        Consultez aussi notre{" "}
        <LegalLink document="privacy" className="text-white underline underline-offset-2">
          politique de confidentialité
        </LegalLink>.
      </p>

      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand text-sm font-bold text-white shadow-[0_18px_45px_-24px_rgba(65,0,154,0.9)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Création…" : "Créer mon compte"}
      </button>

      <p className="pt-1 text-center text-xs text-muted">
        Déjà un compte ?{" "}
        <Link
          href={`/connexion?next=${encodeURIComponent(nextPath)}`}
          className="font-semibold text-white underline underline-offset-2 hover:text-brand-2"
        >
          Se connecter
        </Link>
      </p>
    </form>
  );
}
