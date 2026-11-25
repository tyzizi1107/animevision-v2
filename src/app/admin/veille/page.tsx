import type { Metadata } from "next";
import { WatchPanel } from "@/components/admin/watch-panel";

export const metadata: Metadata = { title: "Veille des nouveautés — Administration" };
export const dynamic = "force-dynamic";

export default function AdminVeillePage() {
  return <WatchPanel />;
}
