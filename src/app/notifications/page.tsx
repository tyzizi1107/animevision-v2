"use client";

import { NotificationsPanelContent } from "@/components/announcements/notifications-panel-content";

/** Page complète (adresse /notifications) : le volet, lui, vit dans l'en-tête. */
export default function NotificationsPage() {
  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-10">
      <h1 className="page-title text-[1.75rem] text-ink sm:text-[2.1rem]">Notifications</h1>
      <div className="mt-6">
        <NotificationsPanelContent />
      </div>
    </main>
  );
}
