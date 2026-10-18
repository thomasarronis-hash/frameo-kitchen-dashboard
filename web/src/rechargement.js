// web/src/rechargement.js
//
// Rôle    : décider des rechargements de la page, sans jamais couper quelqu'un qui cuisine : le rechargement quotidien
//           de 4h (heure de Paris), qui limite les fuites de mémoire de la WebView (conception §2.7), et celui qui suit
//           un déploiement (le serveur annonce une autre empreinte du contenu servi à la reconnexion).
// Entrées : heure corrigée (ms, heure.js) ; l'état de la page au moment de la décision ; l'empreinte de chaque
//           instantané du flux (serveur/empreinte.js).
// Sorties : journeeDeRechargement(ms) -> « 2026-10-11 », la journée qui a commencé au dernier 4h passé ;
//           doitRecharger({ reference, ms, bloque, inactifMs }) -> booléen ;
//           creerSuiviVersion() -> { observer(empreinte), nouvelle() } : la première empreinte reçue est retenue, une
//           autre reçue plus tard rend nouvelle() vrai ; doitRechargerVersion({ nouvelle, bloque, inactifMs }) -> booléen.
// Pièges  :
//   - reference est la journée de rechargement relevée au chargement, MAIS une fois l'horloge réglée sur le
//     serveur (main.js) : relevée sur une horloge de cadre fausse, elle différerait de la vraie dès le premier
//     instantané et la page se rechargerait en boucle.
//   - Report : tant qu'un minuteur tourne ou sonne, qu'une recette est ouverte (bloque), ou que quelqu'un a
//     touché l'écran depuis moins de 60 s, on attend ; le rechargement se fait ensuite, même après 4h.
//   - 4h existe tous les jours à Paris (les changements d'heure se font entre 2h et 3h) ; la journée se calcule
//     sur les parties de l'heure de Paris, pas en retranchant 4 h (faux les nuits de changement d'heure).
//   - Après un déploiement : l'empreinte retenue est celle du PREMIER instantané reçu par cette page (celle du code
//     qu'elle exécute) ; null (serveur plus ancien, page non servie) n'est jamais retenu ni comparé. Le rechargement
//     attend ce qui le bloque (minuteur qui tourne ou sonne, recette ouverte, écran Enfants, bandeau sonnette :
//     rechargementVersionBloque de pilotage.js) et 60 s sans toucher, comme celui de 4h. La nouvelle page retient à
//     son tour l'empreinte qu'elle reçoit : pas de boucle.

import { partiesParis } from './heure.js';

const HEURE_RECHARGEMENT = 4;
const INACTIVITE_AVANT_RECHARGEMENT_MS = 60000;

const deuxChiffres = (n) => (n < 10 ? '0' : '') + n;

export function journeeDeRechargement(ms) {
  const p = partiesParis(ms);
  const decalage = p.heure < HEURE_RECHARGEMENT ? 1 : 0;
  const jour = new Date(Date.UTC(p.annee, p.mois - 1, p.jour - decalage));
  return `${jour.getUTCFullYear()}-${deuxChiffres(jour.getUTCMonth() + 1)}-${deuxChiffres(jour.getUTCDate())}`;
}

export function doitRecharger({ reference, ms, bloque, inactifMs }) {
  if (reference === null || bloque || inactifMs < INACTIVITE_AVANT_RECHARGEMENT_MS) return false;
  return journeeDeRechargement(ms) !== reference;
}

export function creerSuiviVersion() {
  let retenue = null;
  let nouvelle = false;
  return {
    observer(empreinte) {
      if (typeof empreinte !== 'string') return;
      if (retenue === null) retenue = empreinte;
      else if (empreinte !== retenue) nouvelle = true;
    },
    nouvelle: () => nouvelle,
  };
}

export function doitRechargerVersion({ nouvelle, bloque, inactifMs }) {
  return nouvelle && !bloque && inactifMs >= INACTIVITE_AVANT_RECHARGEMENT_MS;
}
