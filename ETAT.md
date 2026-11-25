# État des sources — récupération des animes et des flux

Mis à jour après refonte du parcours (TMDB + Anime-Sama + Franime + Purstream).

## Principe

Aucune fiche n'est lue depuis MongoDB pour construire la page ou les flux :
TMDB donne le découpage (saisons, épisodes, titres, images, langue), et les
providers cherchent l'épisode chez eux à chaque lecture.

    fiche  → TMDB /{tv|movie}/{id}        titres FR + alternatifs (recherche)
    flux   → Anime-Sama  (scraping + signature CSRF)
             Franime     (catalogue → saga → lecteur)
             Purstream   (API JSON, flux HLS directs)
    lecture d'un embed → resolvers.ts (hls/mp4/iframe jouable)

## Ce qui fonctionne (vérifié en direct)

| Saison testée (One Piece) | Flux rendus |
|---|---|
| S1 E1 | Purstream (pulse 1080p MULTI) + Anime-Sama ansembed |
| S6 E1 | 2 × Anime-Sama ansembed |
| S12 E1 (Elbaf) | Anime-Sama ansembed |
| S11 E1 (Egg Head) | Anime-Sama ansembed |

Les 11 sagas de One Piece résolvent le bon index chez Franime :
`East Blue → index 1`, …, `Elbaf 12 → index 12`.

## Ce qui bloque

1. **Franime ne renvoie plus de liens signés `watch2`.** Toutes les routes
   `api/anime/…` répondent désormais une URL Sibnet *aléatoire* qui ne
   correspond pas à l'épisode demandé (vérifié : trois appels de suite sur le
   même épisode donnent trois vidéoid différents). Réponse cohérente avec le
   catalogue (lecteurs `filemoon, sibnet, uqload, vidmoly`) absente.
2. **Sibnet répond 403** à tout accès qui n'est pas un vrai navigateur, y
   compris avec une empreinte Chrome (`curl_cffi`) et tous les Referer. Les
   autres lecteurs (filemoon, uqload, vidmoly) ne sont pas exposés par l'API.
3. L'application propose donc les liens Franime au lecteur quand ils
   apparaissent (la liste de lecteurs n'est plus filtrée par `isDeadHost`),
   mais le site ne peut pas garantir qu'ils soient jouables.

## Piste suivante

Le site Franime charge son API dans des chunks Webpack ; la route exacte
utilisée par son lecteur n'est pas exposée en clair. Pour aller plus loin, il
faut lire ce chunk et reproduire l'appel, ou passer par un navigateur réel.

## Historique

- 2026-06 : la numérotation absolue TMDB ↔ Franime est résolue (Elbaf = 1156…1180).
- Les fiches Franime sans équivalent TMDB retombent sur le catalogue local.

## 2026-06 — fiches sans `tmdbId`, Berserk et HxH

- **760 fiches sans `tmdbId` (films Franime) ouvrent de nouveau.** `parseCatalogId`
  renvoie maintenant `{ tmdbId: 0, documentId: "franime-…" }` au lieu de `null`,
  et `getAnimeDetail` lit directement le document du catalogue sans appeler TMDB.
  Vérifié : 1874 (Jin-Roh), 1727 (DBZ Movie 04), 1758 (Fate HF I),
  1845 (HxH Movie 1) et 10 numéros au hasard → tous en 200 avec leur titre.
- **Berserk 1997 (fiche 160)** : la table `EDITION_PAGES` de Franime pointait sur
  `11655` (la fiche 2016). Corrigée sur `157594765910`. Anime-Sama sert la
  saison 1 (25 ép.) ; Franime la fiche 1997. → **8 flux** sur ep1 et ep5.
- **Berserk 2016 (fiche 159)** : Anime-Sama `saison2` (24 ép.) + Franime 11655.
  → **4 flux**.
- **Hunter x Hunter** : Franime publie 1999 (kitsu 115, 62 ép.) et 2011
  (kitsu 6448, 148 ép.) → `EDITION_PAGES`. Anime-Sama ne publie que 2011
  (`anime-sama.to`, saison1, 148 ép.) : `UNAVAILABLE_ON_SITE` y marque 1999.
  Aucune fiche HxH série n'existe dans le catalogue (seuls les films 1845/1846).
- Non-régression : 953 → 8 flux, 954 → 1-4 selon l'hôte, 563 → 3, 915 → 11,
  159 → 4, 160 → 8.

## 2026-06 — les films renvoyaient 0 source

Trois causes distinctes, toutes corrigées :

1. **`getTitlesForProviders` renvoyait `null` pour les fiches sans `tmdbId`**
   (760 documents `franime-…`) → l'API répondait « Contenu introuvable ».
   Un détour par `localTitlesForProviders()` lit le titre dans le document
   catalogue avant tout appel TMDB.
2. **`isTmdbNotFound("2069")` était vrai** pour ces fiches (`tv-0`), et la
   requête sortait avant d'interroger les sources. Le test est ignoré quand
   `documentId` est présent.
3. **Franime ne publiait que du sibnet** pour beaucoup de films : le résolveur
   le jetait (`DEAD_HOSTS`) et la fiche restait vide. Le provider passe
   maintenant au lecteur suivant (`isDeadHost` + 4 lecteurs vivants/langue).

Côté Anime-Sama, deux bugs d'indexation empêchaient de servir les pages
`…/film/vostfr/` (les pages film existent : `one-piece/film` = 17 liens) :
`parseSeasonPage` ne reconnaissait que `"lien:123"` alors que le site publie
des listes **avec trous** (`""` pour un film absent), et `lien.php` attend
l'identifiant **nu**. Les positions sont désormais conservées.

Vérifié : 2069 (Red) → 5, 2035 (Naruto 1) → 11, 1631 (MHA 1) → 6,
1641 (Boruto) → 6, 1727 (DBZ Movie 04) → 6, 1874 (Jin-Roh) → 2.
Séries inchangées : 953 → 9, 954 → 1-4, 563 → 3, 915 → 13, 159 → 4, 160 → 8.

**Restant** : les films que Franime ne publie qu'en sibnet (Stampede, Film Z,
Strong World, HxH Movie 1) restent à 0 — Anime-Sama les liste sans nom sur sa
page film, on ne peut pas faire correspondre le bon index sans les titres.

## Films : affichage et sources (session en cours)

- **Fiche d'un film** (`/anime/<id>`) : plus de compteur de saisons, plus de
  bloc « Saisons », plus de liste d'épisodes. Le titre reste celui du catalogue.
- **Lecteur d'un film** (`/regarder/…`) : le titre n'affiche plus « · Saison 1 »
  ni la ligne « Ép. 1 · Épisode 1 », le bouton « Liste des épisodes » et le
  raccourci clavier `e` sont désactivés, le panneau latéral est supprimé.
- Les streams d'un film n'ont plus de `seasonNumber` (le lecteur n'affiche
  donc aucun numéro de saison).
- **Matching Franime** : le filtre de titre acceptait mal un titre de catalogue
  plus long que celui du site (« Tamako Market : Love Story (Film) » vs
  « Tamako Love Story ») → accepté si même début + 2 mots communs.
- **Nouvelle table `FILM_POSITIONS`** (anime-sama.ts) : position d'un film sur
  la page « film » du site (Road to Ninja = 6 sur `naruto-shippuden/film`).
  Road to Ninja : 6 streams (au lieu de 0).
- **Limite connue** : Sibnet répond 403 à tout (testé hors app) ; les films dont
  Franime ne propose QUE Sibnet (One Piece Stampede, Strong World, Film Z,
  Tamako Love Story, Given) n'ont donc aucune source.

## Films sur Anime-Sama : les vrais noms (session)

- **Cause racine trouvée** : une fiche sans `tmdbId` (`franime-…`) était lue
  « série » par `parseCatalogId`, donc les providers cherchaient une SAISON de
  série pour un film → 0 source. Le type est maintenant lu dans la fiche
  (`format: "Film"`), dans `api/streams` ET dans la table des numéros.
- **Les pages « film » listent leurs films** : `newSPF("…")` donne les noms
  dans l'ordre, sur `/catalogue/<slug>/film/vostfr/`. On lit ces noms, on les
  compare au titre, et on ne sert QUE si le nom correspond (sinon un autre film
  de la franchise serait servi).
- **Table `FILM_POSITIONS`** : clés normalisées (sans « film/movie » ni
  ponctuation), positions officielles des pages One Piece / Naruto /
  Naruto Shippuden / HxH / MHA. Les titres FR des films One Piece sont mappés
  aussi (Le Mecha Géant, Épisode d'Alabasta, Épisode de Chopper, 3D…).
- **Résultat** : la quasi-totalité des films One Piece et Naruto Shippuden
  servent 1 à 2 sources (Anime-Sama). Reste à 0 : Hunter x Hunter Movie 1/2
  (`hunter-hunter` : le slug n'est pas encore mappé) et quelques films dont la
  position n'est pas dans la table.
