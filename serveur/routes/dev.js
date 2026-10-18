// serveur/routes/dev.js
//
// Rôle    : routes de DÉVELOPPEMENT, pour ouvrir la page dans un navigateur ordinaire du Clevo :
//           GET /dev/appairer?code=<code> pose le cookie cadre_cle (ce que le kiosque fera sur le cadre) puis
//           renvoie vers la page ; GET /dev/reglages autorise la page à forcer son thème par ?theme=jour|soir|nuit.
// Entrées : { cle, port, codeAppairage } : clé d'appareil (config.js), port d'écoute, code d'appairage tiré au
//           hasard à chaque démarrage par index.js et écrit dans son journal ; requêtes HTTP.
// Sorties : /dev/appairer -> 302 vers / (ou /?theme=<thème> si demandé), avec Set-Cookie, si le code est bon ;
//           /dev/reglages -> 200 { theme_force: true } ;
//           403 pour toute requête qui ne vient pas de la boucle locale, ou dont l'en-tête Host n'est pas
//           exactement 127.0.0.1:<port>, localhost:<port> ou [::1]:<port> ; 403 sur /dev/appairer sans le bon code.
// Pièges  :
//   - app.js n'enregistre ces routes QUE si NODE_ENV=development : en production, /dev/* n'existe pas (404).
//   - Boucle locale seulement (127.0.0.1, ::1, ::ffff:127.0.0.1), même avec HOTE=0.0.0.0 : requete.ip est
//     l'adresse de la socket, puisque Fastify n'est pas réglé pour croire un proxy (trustProxy absent).
//   - L'adresse de la socket ne suffit pas, d'où les deux verrous en plus :
//     . Host : un site ouvert dans un navigateur du Clevo peut faire pointer son propre nom sur 127.0.0.1
//       (DNS rebinding) ; sans ce contrôle, il recevait un cookie valable pour son domaine et lisait /api/flux.
//     . Code d'appairage : pendant un `adb reverse`, TOUTE appli du cadre (logiciel jugé non fiable,
//       conception §2.5) arrive aussi de 127.0.0.1 et choisit son Host ; elle ne connaît pas le code, qui
//       n'existe que dans le journal du serveur sur le Clevo.
//   - Le code n'est pas la clé : il change à chaque démarrage et ne sert qu'ici. La clé, elle, n'est jamais
//     dans une URL ni dans un corps de réponse : seulement dans l'en-tête Set-Cookie, HttpOnly (illisible par
//     le JavaScript de la page) et SameSite=Strict. Les en-têtes de réponse ne sont pas journalisés.
//   - Le paramètre theme n'est recopié dans la redirection que s'il vaut jour, soir ou nuit : pas de
//     redirection ouverte.
//   - Hors du contexte /api, donc hors limite de débit : acceptable seulement parce que ces routes sont
//     réservées à la boucle locale, en développement, et que le code fait 24 caractères hexadécimaux.

import { comparateurConstant } from '../securite.js';

const ADRESSES_LOCALES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const NOMS_LOCAUX = ['127.0.0.1', 'localhost', '[::1]'];
const THEMES = new Set(['jour', 'soir', 'nuit']);
// Plafond de Chromium pour un cookie (400 jours), comme le kiosque (conception §2.5).
const DUREE_COOKIE_S = 34_560_000;

export default async function routesDev(app, { cle, port, codeAppairage }) {
  if (typeof codeAppairage !== 'string' || codeAppairage.length < 16) throw new Error('routes /dev : code d\'appairage manquant ou trop court');
  const hotesAdmis = new Set(NOMS_LOCAUX.map((nom) => `${nom}:${port}`));
  const codeValide = comparateurConstant(codeAppairage);

  app.addHook('onRequest', async (requete, reponse) => {
    const hote = String(requete.headers.host || '').toLowerCase();
    if (ADRESSES_LOCALES.has(requete.ip) && hotesAdmis.has(hote)) return;
    requete.log.warn('route de développement refusée : hors de la boucle locale ou en-tête Host inattendu');
    return reponse.code(403).send({ erreur: 'interdit' });
  });

  app.get('/dev/appairer', async (requete, reponse) => {
    if (!codeValide(requete.query.code)) {
      requete.log.warn('appairage de développement refusé : code absent ou faux');
      return reponse.code(403).header('cache-control', 'no-store').send({ erreur: 'code_appairage' });
    }
    const theme = THEMES.has(requete.query.theme) ? requete.query.theme : null;
    reponse
      .header('set-cookie', `cadre_cle=${encodeURIComponent(cle)}; Path=/; Max-Age=${DUREE_COOKIE_S}; HttpOnly; SameSite=Strict`)
      .header('cache-control', 'no-store');
    return reponse.redirect(theme ? `/?theme=${theme}` : '/', 302);
  });

  app.get('/dev/reglages', async (_requete, reponse) => {
    reponse.header('cache-control', 'no-store');
    return { theme_force: true };
  });
}
