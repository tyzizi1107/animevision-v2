import type { Metadata } from "next";
import { AnimeManager } from "@/components/admin/anime-manager";

export const metadata: Metadata = { title: "Catalogue anime — Administration" };
export const dynamic = "force-dynamic";

export default function AdminAnimesPage() {
  return <AnimeManager />;
}
