/**
 * Démarrage du serveur.
 *
 * ⚠ Ce fichier ne doit contenir AUCUN import vers `lib/` : Next compile son
 * contenu dans le bundle de l'instrumentation, y compris les `import()`
 * dynamiques, et embarquait donc `mongodb` (« Can't resolve 'net' », `crypto`,
 * `os` dans `next dev`).
 *
 * La veille des nouveautés (Franime / Anime-Sama) démarre à la place depuis
 * `src/lib/mongodb.ts`, au premier accès à la base : ce module-là est compilé
 * pour Node. Voir `ensureWatchLoop()` dans `src/lib/freshness.ts`.
 *
 * Désactivable avec `VEILLE_AUTO=0` ; l'intervalle se règle avec
 * `VEILLE_MINUTES` (10 par défaut).
 */
export async function register() {
  // Volontairement vide : la veille démarre avec la première requête serveur.
}
