import { detailHref } from "@/lib/anime-types";
import Link from "next/link";
import type { AnimeSummary } from "@/lib/anime-types";

/** Bannière « Accédez au catalogue AnimeVision » en bas de l'accueil. */
export function HomePromo({ animes }: { animes: AnimeSummary[] }) {
  const posters = animes.filter((a) => a.affiche).slice(0, 3);
  return (
    <section>
      <div className="relative flex min-h-[350px] flex-col justify-between gap-8 overflow-hidden rounded-xl bg-gradient-to-r from-brand to-[#180c31] p-10 lg:flex-row lg:items-stretch">
        <div className="relative z-10 flex max-w-[500px] flex-col justify-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ded1f1]">
            Accédez au catalogue AnimeVision
          </p>
          <h2 className="mt-5 text-4xl font-bold leading-[1.1] text-white lg:text-[43px]">
            Découvrez un nouveau monde
          </h2>
          <p className="mt-5 text-[15px] leading-[23px] text-[#e1d4f3]">
            Des créations singulières. Des émotions intenses.
            <br />À découvrir exclusivement sur AnimeVision.
          </p>
          <Link
            href="/catalogue"
            className="mt-8 inline-flex h-[46px] w-fit items-center rounded-[5px] bg-white px-5 text-[13px] font-semibold text-brand transition hover:brightness-95"
          >
            Explorer le catalogue&nbsp; →
          </Link>
        </div>
        <div className="relative hidden items-center justify-center gap-6 lg:flex lg:flex-1">
          {posters.map((anime, i) => (
            <Link
              key={anime.id}
              href={detailHref(anime.id)}
              className={`relative h-[278px] w-[194px] overflow-hidden rounded-[7px] ${i === 1 ? "-mt-8" : "mt-6"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={anime.affiche!} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-bg/95 via-transparent to-transparent" />
              <span className="absolute inset-x-3 bottom-3 truncate text-base font-semibold text-white">{anime.titre}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
