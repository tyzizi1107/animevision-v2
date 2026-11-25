/** Clés et script d'amorçage de l'écran d'arrivée (fichier serveur-compatible). */
export const LAST_ACTIVE_KEY = "animevision.last-active-at";
export const SESSION_KEY = "animevision.splash-seen";
export const RETURN_AFTER_MS = 4 * 60 * 60 * 1000;

/** Exécuté avant le premier affichage : demande l'écran à la 1re visite de la
 *  session, ou après 4 h d'absence. */
export const SPLASH_BOOT_SCRIPT = `try{var n=Date.now(),l=Number(localStorage.getItem("${LAST_ACTIVE_KEY}"))||0,s=sessionStorage.getItem("${SESSION_KEY}");if(!s||n-l>=${RETURN_AFTER_MS}){document.documentElement.setAttribute("data-splash","1")}}catch(e){document.documentElement.setAttribute("data-splash","1")}`;
