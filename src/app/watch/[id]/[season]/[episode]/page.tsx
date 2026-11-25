import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmbedPlayer } from "@/components/embed-player";
import { isAnimeLanguage, type AnimeLanguage } from "@/lib/anime-types";
import { getAnimeDetail, parseCatalogId, seasonNumberFromSlug } from "@/lib/animes";

type PageProps = {
  params: Promise<{ id: string; season: string; episode: string }>;
  searchParams: Promise<{ lang?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id, season, episode } = await params;
  const anime = await getAnimeDetail(id);
  if (!anime) return { title: "Épisode introuvable" };
  return {
    title: `${anime.titre} — ${season.replace(/-/g, " ")} · épisode ${episode}`,
    description: anime.synopsis.slice(0, 160) || undefined,
  };
}

export const dynamic = "force-dynamic";

/**
 * Page de lecture : elle ne contient QUE le lecteur, qui occupe tout l'écran.
 * L'en-tête, le pied de page et la navigation du site sont masqués tant qu'on
 * est ici (voir `app/watch/layout.tsx`).
 */
export default async function WatchPage({ params, searchParams }: PageProps) {
  const [{ id, season: seasonSlug, episode: episodeParam }, query] = await Promise.all([params, searchParams]);
  const anime = await getAnimeDetail(id);
  if (!anime) notFound();

  const seasonNumber = seasonNumberFromSlug(seasonSlug, anime.seasons);
  const season = (seasonNumber !== null
    ? anime.seasons.find((item) => item.slug === `saison-${seasonNumber}`) ?? anime.seasons.find((item) => item.name === seasonSlug)
    : undefined) ?? anime.seasons.find((item) => item.slug === seasonSlug);
  if (!season) notFound();

  const episodeNumber = Number.parseInt(episodeParam, 10);
  const episode = season.episodes.find((item) => item.number === episodeNumber);
  if (!episode) notFound();

  // Langue du lecteur : celle de l'URL. Sans `lang`, le lecteur applique la
  // préférence du compte côté client et réécrit l'URL avec la langue
  // réellement jouée.
  const language: AnimeLanguage = isAnimeLanguage(query.lang) ? query.lang : "vostfr";
  const parsed = parseCatalogId(anime.id);
  // Un film n'a ni saison ni liste d'épisodes : le lecteur masque tout ce
  // vocabulaire (bouton « Liste des épisodes », sélecteur de saison).
  const isMovie = parsed?.mediaType === "movie" || anime.type === "movie";
  const seasonNumberValue = parsed?.mediaType === "movie"
    ? 1
    : Number(/(\d+)$/.exec(season.slug)?.[1] ?? 1);
  // Numérotation absolue de la fiche (One Piece : saison 23, épisode 1156) :
  // sans elle les sources récentes ne se trouvent pas chez Franime.
  const absoluteEpisodeValue = episode.absoluteNumber ?? episode.number;

  const position = season.episodes.findIndex((item) => item.number === episode.number);
  const previous = position > 0 ? season.episodes[position - 1] : undefined;
  const next = position >= 0 && position < season.episodes.length - 1 ? season.episodes[position + 1] : undefined;

  // Langue retirée de l'URL (elle vit dans les réglages du lecteur) : on garde
  // le paramètre pour la compatibilité mais sans l'écrire dans le lien.
  const hrefFor = (episodeNumberValue: number, lang: AnimeLanguage = language) =>
    `/regarder/${anime.id}/${season.slug}/${episodeNumberValue}`;

  return (
    <EmbedPlayer
      key={`${anime.id}-${season.slug}-${episode.number}-${language}`}
      animeId={anime.id}
      title={anime.titre}
      seasonSlug={season.slug}
      seasonName={isMovie ? "" : season.name}
      seasonNumber={seasonNumberValue}
      episodeNumber={absoluteEpisodeValue}
      episodeTitle={episode.titre ?? undefined}
      language={language}
      languageHrefs={{
        vostfr: episode.availableLanguages?.includes("vostfr") ? hrefFor(episode.number, "vostfr") : undefined,
        vf: episode.availableLanguages?.includes("vf") ? hrefFor(episode.number, "vf") : undefined,
      }}
      previousHref={previous ? hrefFor(previous.number) : undefined}
      nextHref={next ? hrefFor(next.number) : undefined}
      coverImage={episode.still || anime.banniere || anime.affiche}
      coverIsEpisodeStill={Boolean(episode.still)}
      poster={anime.banniere ?? anime.affiche}
      seasons={isMovie ? [] : anime.index.map((item) => ({
        slug: item.slug,
        name: item.name,
        number: Number(/(\d+)$/.exec(item.slug)?.[1] ?? 0),
        episodes: item.episodes.map((entry) => ({
          number: entry.number,
          title: entry.titre ?? null,
          href: `/regarder/${anime.id}/${item.slug}/${entry.number}?lang=${language}`,
          still: entry.still ?? null,
          runtime: entry.runtime ?? null,
          // Numéro absolu (saga) : c'est lui qui s'affiche dans la liste.
          absolute:
            item.episodes.length > 1
              ? (anime.absoluteEpisode(Number(/(\d+)$/.exec(item.slug)?.[1] ?? 0), entry.number) ?? null)
              : null,
        })),
      }))}
      activeSeasonSlug={season.slug}
      isMovie={isMovie}
      episodes={isMovie ? [] : season.episodes.map((item) => ({
        number: item.number,
        title: item.titre ?? null,
        href: hrefFor(item.number),
        still: item.still ?? null,
        runtime: item.runtime ?? null,
        absolute: item.absoluteNumber ?? null,
      }))}
    />
  );
}
