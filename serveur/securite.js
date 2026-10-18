// serveur/securite.js
//
// Rôle    : protéger /api : deux clés d'appareil (cookie cadre_cle OU en-tête X-Cadre-Cle), routes réservées au
//           Clevo, limites de débit par IP, et masquage des secrets dans les journaux.
// Entrées : les clés attendues { cadre, clevo } (config.js), les requêtes Fastify.
// Sorties : optionsJournal({ flux }) -> options du journal pino à passer à Fastify (flux : sortie de
//           remplacement, pour les tests) ;
//           enregistrerLimite(api, horsLimite) -> 300 requêtes par minute et par IP dans le contexte /api, sauf les
//           requêtes que horsLimite.concerne(requete) désigne (touches de télécommande) : celles-là ont leur propre
//           compteur de contexte, horsLimite.max par horsLimite.fenetreMs (10 par seconde) ;
//           limiteDediee(app, max) -> hook onRequest : max requêtes par minute et par IP pour les routes qui le
//           portent (actions, drive, draps, enfants), compté à part de la limite globale ;
//           exigerCle(cles) -> hook onRequest qui répond 401 si aucune clé valide n'est présentée, et pose
//           requete.appareil ('cadre' ou 'clevo') ;
//           reserverAuClevo -> hook onRequest de route : 403 si la clé présentée n'est pas celle du Clevo ;
//           comparateurConstant(secret) -> fonction (texte fourni -> booléen) en temps constant, partagée
//           avec le code d'appairage de développement (routes/dev.js).
// Pièges  :
//   - Comparaison en temps constant : on compare les empreintes SHA-256 (toujours 32 octets) avec
//     timingSafeEqual, qui lève une erreur sur deux tampons de longueurs différentes. Les quatre comparaisons
//     (deux clés, cookie et en-tête) sont toujours faites, pour une durée qui ne dépend pas du chemin suivi.
//   - Une clé vaut pour son appareil, qu'elle arrive en cookie ou en en-tête ; si les deux portent des clés
//     valides d'appareils différents, l'en-tête (explicite) l'emporte.
//   - /api/sante reste public parce qu'il est enregistré HORS du contexte qui porte exigerCle
//     (voir app.js) : aucune liste d'URL publiques à tenir à jour ici.
//   - La limite de débit est un hook de CONTEXTE posé sur /api, et non le mode « global » de
//     @fastify/rate-limit : celui-ci ajoute un hook de route, qui passe APRÈS les hooks de contexte, si
//     bien que les requêtes sans clé (refusées par exigerCle) échappaient à la limite.
//   - Pour la même raison, une limite de route (config.rateLimit) ne marcherait pas : la bibliothèque
//     saute tout second contrôle d'une requête déjà comptée par la limite globale. limiteDediee passe
//     donc par createRateLimit, qui tient son propre compteur.
//   - Hors limite globale (télécommandes, conception §2.5) : exemptées du compteur global par son allowList, mais
//     comptées AU MÊME NIVEAU (hook de contexte, avant exigerCle) par leur propre compteur : une requête sans clé
//     vers une touche est donc plafonnée elle aussi, jamais illimitée. Chaque requête de /api passe par
//     exactement un compteur de contexte.
//   - Un hook de contexte ne s'applique qu'aux routes du contexte et à SON gestionnaire 404 : app.js
//     déclare donc un 404 propre à /api, et sert web/dist sans route joker (sinon une URL inconnue sous
//     /api tomberait dans le 404 racine ou dans la route joker de la page statique, hors limite).
//   - pino applique « redact » APRÈS les sérialiseurs : le sérialiseur de requête garde donc les
//     en-têtes, pour que le masquage de cookie, x-cadre-cle, authorization et x-cadre-parent (jeton du mode parent du
//     tableau des enfants, serveur/enfants/mode-parent.js) s'applique bien.
//   - Les clés ne sont jamais lues dans l'URL : elles finiraient dans les journaux et l'historique.

import { createHash, timingSafeEqual } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';

const NOM_COOKIE = 'cadre_cle';
const EN_TETE_CLE = 'x-cadre-cle';
const EN_TETE_PARENT = 'x-cadre-parent';
export const MASQUE = '[masqué]';

const LIMITE_PAR_MINUTE = 300;

export function optionsJournal({ flux } = {}) {
  return {
    level: 'info',
    ...(flux ? { stream: flux } : {}),
    redact: {
      paths: ['req.headers.cookie', `req.headers["${EN_TETE_CLE}"]`, 'req.headers.authorization', `req.headers["${EN_TETE_PARENT}"]`],
      censor: MASQUE,
    },
    serializers: {
      req: (requete) => ({ method: requete.method, url: requete.url, ip: requete.ip, headers: requete.headers }),
    },
  };
}

// Hook onRequest qui compte à part (createRateLimit) : max requêtes par fenetreMs et par IP, 429 au-delà.
function compteur(app, max, fenetreMs) {
  const compter = app.createRateLimit({ max, timeWindow: fenetreMs });
  return async function verifierCompteur(requete, reponse) {
    const { isExceeded, ttlInSeconds } = await compter(requete);
    if (!isExceeded) return;
    reponse.header('retry-after', String(ttlInSeconds));
    const erreur = new Error(`Trop de requêtes, réessayer dans ${ttlInSeconds} s`);
    erreur.statusCode = 429;
    throw erreur;
  };
}

export async function enregistrerLimite(api, horsLimite = null) {
  const concerne = horsLimite ? horsLimite.concerne : () => false;
  await api.register(rateLimit, {
    global: false,
    max: LIMITE_PAR_MINUTE,
    timeWindow: 60_000,
    errorResponseBuilder: (_requete, contexte) => {
      const erreur = new Error(`Trop de requêtes, réessayer dans ${Math.ceil(contexte.ttl / 1000)} s`);
      erreur.statusCode = contexte.statusCode;
      return erreur;
    },
  });
  api.addHook('onRequest', api.rateLimit({ allowList: (requete) => concerne(requete) }));
  if (horsLimite) {
    const verifier = compteur(api, horsLimite.max, horsLimite.fenetreMs);
    api.addHook('onRequest', async (requete, reponse) => {
      if (concerne(requete)) await verifier(requete, reponse);
    });
  }
}

export function limiteDediee(app, max) {
  return compteur(app, max, 60_000);
}

const empreinte = (texte) => createHash('sha256').update(texte, 'utf8').digest();

export function comparateurConstant(secret) {
  const attendue = empreinte(secret);
  return (fourni) => typeof fourni === 'string' && fourni !== '' && timingSafeEqual(empreinte(fourni), attendue);
}

export function exigerCle(cles) {
  const comparateurs = Object.entries(cles).map(([appareil, cle]) => [appareil, comparateurConstant(cle)]);
  const reconnaitre = (fourni) => comparateurs
    .map(([appareil, estValide]) => (estValide(fourni) ? appareil : null))
    .reduce((trouve, appareil) => trouve || appareil, null);

  return async function verifierCle(requete, reponse) {
    const parEnTete = reconnaitre(requete.headers[EN_TETE_CLE]);
    const parCookie = reconnaitre(requete.cookies?.[NOM_COOKIE]);
    requete.appareil = parEnTete || parCookie;
    if (requete.appareil) return;
    requete.log.warn('clé d\'appareil absente ou invalide');
    return reponse.code(401).header('cache-control', 'no-store').send({ erreur: 'non_appaire', message: 'Cadre non appairé' });
  };
}

export async function reserverAuClevo(requete, reponse) {
  if (requete.appareil === 'clevo') return;
  requete.log.warn(`route réservée au Clevo demandée avec la clé « ${requete.appareil} »`);
  return reponse.code(403).header('cache-control', 'no-store').send({ erreur: 'reserve_clevo', message: 'Route réservée au Clevo' });
}
