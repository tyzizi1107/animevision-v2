import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Administration" };

export default function AdminPage() {
  redirect("/administration/animes");
}
