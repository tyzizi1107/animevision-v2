import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `mongodb` est un paquet Node (net, crypto, os…) : il ne doit jamais être
   * embarqué par le bundler. Sans ça, `next dev` échoue au chargement de
   * l'instrumentation (veille) avec « Can't resolve 'net' ».
   */
  serverExternalPackages: ["mongodb"],
  async redirects() {
    return [
      { source: "/watch/:path*", destination: "/regarder/:path*", permanent: true },
      { source: "/admin/:path*", destination: "/administration/:path*", permanent: true },
      { source: "/api/announcements/:path*", destination: "/api/annonces/:path*", permanent: true },
      { source: "/api/calendar", destination: "/api/calendrier", permanent: true },
      { source: "/api/account/:path*", destination: "/api/compte/:path*", permanent: true },
      { source: "/api/admin/:path*", destination: "/api/administration/:path*", permanent: true },
      { source: "/api/auth/:path*", destination: "/api/authentification/:path*", permanent: true },
      { source: "/api/library/:path*", destination: "/api/bibliotheque/:path*", permanent: true },
      // Adresses historiques : une fiche s'ouvre désormais `/serie/<id>` ou
      // `/movie/<id>`, comme chez Vidzy.
      { source: "/anime/:id", destination: "/serie/:id", permanent: true },
    ];
  },
  async rewrites() {
    return [
      { source: "/regarder/:path*", destination: "/watch/:path*" },
      { source: "/administration/:path*", destination: "/admin/:path*" },
      { source: "/api/annonces/:path*", destination: "/api/announcements/:path*" },
      { source: "/api/calendrier", destination: "/api/calendar" },
      { source: "/api/compte/:path*", destination: "/api/account/:path*" },
      { source: "/api/administration/:path*", destination: "/api/admin/:path*" },
      { source: "/api/authentification/:path*", destination: "/api/auth/:path*" },
      { source: "/api/bibliotheque/:path*", destination: "/api/library/:path*" },
    ];
  },
};

export default nextConfig;
