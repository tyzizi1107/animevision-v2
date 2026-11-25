export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function validateEmail(email: string): string | null {
  if (!email) return "L'adresse e-mail est requise.";
  if (email.length > 190) return "Cette adresse e-mail est trop longue.";
  if (!EMAIL_PATTERN.test(email)) return "Cette adresse e-mail n'est pas valide.";
  return null;
}

export function validateName(name: string): string | null {
  if (!name) return "Le nom est requis.";
  if (name.length < 2) return "Le nom doit contenir au moins 2 caractères.";
  if (name.length > 40) return "Le nom ne peut pas dépasser 40 caractères.";
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return "Le mot de passe est requis.";
  if (password.length < 8) return "Le mot de passe doit contenir au moins 8 caractères.";
  if (password.length > 128) return "Le mot de passe ne peut pas dépasser 128 caractères.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Le mot de passe doit contenir au moins une lettre et un chiffre.";
  }
  return null;
}

export function passwordStrength(password: string): { score: number; label: string; color: string } {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;

  if (password.length === 0) return { score: 0, label: "—", color: "bg-white/10" };
  if (score <= 2) return { score, label: "Faible", color: "bg-red-500" };
  if (score === 3) return { score, label: "Moyen", color: "bg-amber-500" };
  if (score === 4) return { score, label: "Bon", color: "bg-emerald-500" };
  return { score, label: "Excellent", color: "bg-emerald-400" };
}
