import type { Metadata } from "next";
import { AnnouncementManager } from "@/components/admin/announcement-manager";
import { getAllAnnouncements } from "@/lib/announcements";

export const metadata: Metadata = { title: "Annonces — Administration" };

export const dynamic = "force-dynamic";

export default async function AdminAnnouncementsPage() {
  const announcements = await getAllAnnouncements();
  return <AnnouncementManager initial={announcements} />;
}
