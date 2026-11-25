import type { Metadata, Viewport } from "next";
import { AnnouncementToast } from "@/components/announcements/announcement-toast";
import { AnnouncementsProvider } from "@/components/announcements/announcements-provider";
import { AuthProvider } from "@/components/auth/auth-provider";
import { InitialLoadingScreen } from "@/components/initial-loading-screen";
import { LegalDialog } from "@/components/legal/legal-dialog";
import { SPLASH_BOOT_SCRIPT } from "@/components/splash-boot";
import { SiteChrome } from "@/components/site-chrome";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: {
    default: "AnimeVision — Animés en streaming",
    template: "%s · AnimeVision",
  },
  description:
    "Catalogue d'animés, lecteur HD, reprise de lecture et liste personnelle. Projet de démonstration AnimeVision.",
  applicationName: "AnimeVision",
  keywords: ["anime", "streaming", "animés", "catalogue", "lecteur vidéo"],
  icons: {
    icon: [{ url: "/images/animevision.png", type: "image/png" }],
    apple: [{ url: "/images/animevision.png" }],
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "AnimeVision",
    title: "AnimeVision — Animés en streaming",
    description: "Catalogue d'animés, lecteur HD et reprise de lecture.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#08080a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body suppressHydrationWarning className="min-h-dvh bg-bg text-ink antialiased">
        {/* Décide avant le premier affichage si l'écran d'arrivée apparaît. */}
        <script dangerouslySetInnerHTML={{ __html: SPLASH_BOOT_SCRIPT }} />
        <AuthProvider>
          <InitialLoadingScreen />
          <AnnouncementsProvider>
            {/* En-tête, pied de page et navigation : masqués sur la page de
                lecture, où le lecteur occupe tout l'écran. */}
            <SiteChrome>{children}</SiteChrome>
            <AnnouncementToast />
            <LegalDialog />
          </AnnouncementsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
