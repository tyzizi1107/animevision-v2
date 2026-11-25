"use client";

import { useState } from "react";
import { FigBellIcon } from "@/components/figma-icons";
import { useAnnouncements } from "@/components/announcements/announcements-provider";
import { NotificationsPopup } from "@/components/announcements/notifications-popup";

/** La cloche ouvre le centre des notifications en fenêtre, sans changer de page. */
export function AnnouncementBell() {
  const { notices } = useAnnouncements();
  const [open, setOpen] = useState(false);
  const count = notices.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={count > 0 ? `${count} notification${count > 1 ? "s" : ""}` : "Notifications"}
        aria-haspopup="dialog"
        title="Notifications"
        className="relative grid h-[25px] w-[25px] place-items-center text-[#bdb6cb] transition hover:text-white"
      >
        <FigBellIcon className="h-[25px] w-[25px]" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#41009a] px-1 text-[9px] font-bold text-white">
            {count}
          </span>
        )}
      </button>
      <NotificationsPopup open={open} onClose={() => setOpen(false)} />
    </>
  );
}
