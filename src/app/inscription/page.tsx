import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Inscription",
  description: "Créez votre compte AnimeVision en quelques secondes.",
};

export default async function RegisterPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <AuthShell
      title="Créez votre compte."
      subtitle="Une liste, une progression, des préférences — synchronisées et conservées 60 jours."
    >
      <RegisterForm nextPath="/compte" />
    </AuthShell>
  );
}
