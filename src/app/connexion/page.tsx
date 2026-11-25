import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Connexion",
  description: "Connectez-vous à votre compte AnimeVision.",
};

export default async function LoginPage() {
  const nextPath = "/";
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <AuthShell
      title="Bon retour."
      subtitle="Connectez-vous pour retrouver votre liste, votre progression et vos préférences."
    >
      <LoginForm nextPath={nextPath} />
    </AuthShell>
  );
}
