import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimeCard } from "@/components/anime-card";
import { InlineAnimeEditor } from "@/components/admin/inline-anime-editor";
import { AnimeDetailHero } from "@/components/anime-detail-hero";
import { EpisodeCarousel } from "@/components/episode-carousel";
import { SectionRow } from "@/components/section-row";
import { firstPlayable, typeLabel, watchHref } from "@/lib/anime-types";
import { getAnimeDetail, getSimilar } from "@/lib/animes";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const anime = await getAnimeDetail(id);
  if (!anime) return { title: "Animé introuvable" };
  return {
    title: anime.titre,
    description: anime.synopsis.slice(0, 180) || undefined,
    openGraph: { title: anime.titre, description: anime.synopsis.slice(0, 180) || undefined },
  };
}

export const dynamic = "force-dynamic";

export default async function AnimeDetailPage({ params }: PageProps) {
  const { id } = await params;
  const anime = await getAnimeDetail(id);
  if (!anime) notFound();

  const playable = firstPlayable(anime);
  const similar = await getSimilar(anime, 12);
  const releaseYear = anime.date ? new Date(anime.date).getFullYear() : null;
  const heroImage = anime.banniere ?? anime.affiche;
  // Le type peut arriver en "movie", "film" ou "Film" : un film n'affiche ni
  // saison, ni liste d'épisodes, ni pastille de langue cliquable.
  const isMovie = /^(movie|film)$/i.test(String(anime.type ?? "").trim());
  const hasVf = anime.languages.includes("vf");
  const hasVostfr = anime.languages.includes("vostfr");
  const playHref = playable ? watchHref(anime.id, playable.season.slug, playable.episode.number, playable.language) : null;

  return (
    <article className="pb-16">
      <AnimeDetailHero
        animeId={anime.id}
        titre={anime.titre}
        logo={anime.logo}
        synopsis={anime.synopsis}
        image={heroImage}
        year={releaseYear}
        typeLabel={typeLabel(anime.type)}
        genres={anime.genres}
        playHref={playHref}
        isMovie={isMovie}
        hasVostfr={hasVostfr}
        hasVf={hasVf}
        seasons={anime.index}
      />

      {/* Même gouttière que les rubriques de l'accueil (`mt-0 space-y-10
          px-4 sm:px-6 lg:px-16`) : la première rubrique tombe à la même
          hauteur que « Tendances du moment », juste sous le hero. */}
      <div className="mx-auto max-w-[1440px] space-y-10 px-4 pt-10 sm:px-6 lg:px-16">
        {!isMovie && (
          <EpisodeCarousel animeId={anime.id} seasons={anime.index} fallbackPoster={anime.affiche} />
        )}

        <InlineAnimeEditor animeId={anime.id} />

        {similar.length > 0 && (
          <SectionRow
            title="Titres similaires"
            subtitle="D'autres animés qui pourraient vous plaire."
            href={`/catalogue?genre=${encodeURIComponent(anime.genres[0] ?? "")}`}
          >
            {similar.map((item) => (
              <AnimeCard key={item.id} anime={item} />
            ))}
          </SectionRow>
        )}
      </div>
    </article>
  );
}
