import { AnimeCard } from "@/components/anime-card";
import { CalendarTeaser } from "@/components/calendar/calendar-teaser";
import { ContinueWatching } from "@/components/continue-watching";
import { HeroCarousel, type HeroItem } from "@/components/hero";
import { HomePromo } from "@/components/home-promo";
import { HomeSections } from "@/components/home-sections";
import { RecentEpisodes } from "@/components/recent-episodes";
import { SectionRow } from "@/components/section-row";
import { firstPlayable, watchHref } from "@/lib/anime-types";
import { getAnimeDetail, getHomeData } from "@/lib/animes";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const home = await getHomeData();

  const heroItems: HeroItem[] = await Promise.all(
    home.featured.map(async (anime) => {
      const detail = await getAnimeDetail(anime.id);
      const playable = detail ? firstPlayable(detail) : null;
      return {
        anime,
        // Les saisons voyagent avec l'élément : le hero retrouve ainsi
        // l'épisode déjà commencé pour proposer « Reprendre ».
        seasons: detail?.index ?? [],
        playHref:
          playable && detail
            ? watchHref(
                detail.id,
                playable.season.slug,
                playable.episode.number,
                playable.language,
              )
            : undefined,
      };
    }),
  );

  return (
    <main className="overflow-hidden pb-16">
      <HeroCarousel items={heroItems} />

 

      <HomeSections sections={{
        trending: home.trending.length > 0 ? (
          <SectionRow
            title="Tendances du moment"
            subtitle="Le meilleur du moment, à découvrir maintenant."
            href="/catalogue"
          >
            {home.trending.map((anime) => (
              <AnimeCard key={anime.id} anime={anime} />
            ))}
          </SectionRow>
        ) : null,
        promo: <HomePromo animes={home.recent} />,
        calendar: <CalendarTeaser />,
        recentEpisodes: <RecentEpisodes />,
        recentAnime: home.recent.length > 0 ? (
          <SectionRow
            title="Derniers ajouts"
            subtitle="Récemment ajoutés sur AnimeVision."
            href="/catalogue"
          >
            {home.recent.map((anime) => (
              <AnimeCard key={anime.id} anime={anime} />
            ))}
          </SectionRow>
        ) : null,
        continueWatching: <ContinueWatching />,
      }} />
    </main>
  );
}
