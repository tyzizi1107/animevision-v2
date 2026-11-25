import Link from "next/link";
import { PosterArt } from "@/components/art";
import { BrandLogo } from "@/components/brand-logo";
import { getAllAnimesSnapshot } from "@/lib/animes";

const COLLAGE = [
  { slug: "astral-swordsman", palette: ["#41009a", "#a978f5"] },
  { slug: "moonlit-academy", palette: ["#18265e", "#7654c8"] },
  { slug: "crimson-ronin", palette: ["#721344", "#ee7d6a"] },
  { slug: "neon-tokyo", palette: ["#183e62", "#20a9b7"] },
  { slug: "spirit-garden", palette: ["#315a49", "#a7b85d"] },
  { slug: "starlight-journey", palette: ["#493174", "#e27c9f"] },
] as const;

export async function AuthShell({
  title,
  subtitle,
  children,
  footnote,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footnote?: React.ReactNode;
}) {
  const catalog = (await getAllAnimesSnapshot()).filter((anime) => anime.banniere || anime.affiche).slice(0, COLLAGE.length);

  return (
    <div className="auth-experience relative min-h-dvh overflow-hidden bg-[#09080c]">
      <div className="grid min-h-dvh lg:grid-cols-[minmax(480px,0.92fr)_1.08fr]">
        <section className="relative z-10 flex min-h-dvh items-center justify-center px-5 py-8 sm:px-10 lg:px-14 xl:px-20">
          <div className="w-full max-w-[440px]">
            <Link href="/" className="mb-9 inline-flex" aria-label="AnimeVision, accueil">
              <BrandLogo size="header" priority />
            </Link>

            <div className="mb-7">
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h1>
              <p className="mt-2 text-sm leading-relaxed text-white/55">{subtitle}</p>
            </div>

            {children}

            {footnote && <div className="mt-5 text-center text-xs text-white/40">{footnote}</div>}
          </div>
        </section>

        <aside className="relative min-h-[300px] overflow-hidden border-t border-white/10 lg:min-h-dvh lg:border-l lg:border-t-0">
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-1.5 bg-[#0d0b12] p-1.5 sm:gap-2 sm:p-2">
            {COLLAGE.map((art, index) => {
              const anime = catalog[index % Math.max(1, catalog.length)];
              // Utilise l’affiche verticale de l’anime dans le collage du compte.
              const image = anime?.affiche || anime?.banniere;
              return (
              <div
                key={art.slug}
                className={`relative overflow-hidden rounded-xl ${index === 0 ? "col-span-2 row-span-2" : ""}`}
              >
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="h-full w-full scale-105 object-cover" />
                ) : (
                  <PosterArt slug={art.slug} palette={[...art.palette]} className="h-full w-full scale-110 object-cover" />
                )}
              </div>
            );})}
          </div>
          <div className="absolute inset-0 bg-black/35" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#09080c]/75 via-black/15 to-black/15 lg:bg-gradient-to-r lg:from-black/10 lg:via-black/20 lg:to-[#09080c]/55" />
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center sm:p-10 lg:px-12 xl:px-16">
            <p className="mt-4 max-w-xl text-2xl font-black leading-tight text-white drop-shadow-lg sm:text-3xl lg:text-4xl xl:text-5xl">
              Une nouvelle aventure vous attend.
            </p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/80 sm:text-base">
              Retrouvez votre catalogue, votre liste et votre progression sur tous vos appareils.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
