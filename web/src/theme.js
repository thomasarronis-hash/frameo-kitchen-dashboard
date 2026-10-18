// web/src/theme.js
//
// Rôle    : choisir le thème horaire (jour « Chêne clair », soir « Ardoise », nuit) d'après l'heure de Paris
//           et l'élévation du soleil, et en déduire l'apparence de la page (classe CSS et luminosité).
// Entrées : instant corrigé par le serveur (ms), attribut elevation de sun.sun (degrés, ou null), thème
//           précédent ; « éveillé » quand on a touché l'écran pendant la nuit.
// Sorties : themePour(ms, elevation, precedent) -> 'jour' | 'soir' | 'nuit' ;
//           apparence(theme, eveille) -> { classe: 'jour' | 'soir' | 'nuit', luminosite: 0.6 | 0.3 | 0.05 } ;
//           themeDemande(recherche) -> le thème de ?theme=jour|soir|nuit, ou null ;
//           demanderThemeForce(recherche, lireReglages) -> promesse du thème à forcer, ou null : le thème de
//           l'URL seulement si lireReglages('/dev/reglages') répond 200 avec { theme_force: true }.
// Pièges  :
//   - Nuit de 20 h 30 à 6 h, heure de Paris (choix de Thomas du 14/10 ; 23 h à 5 h avant), changements d'heure
//     compris : l'heure vient de heure.js (Intl), jamais d'un décalage fixe.
//   - Hystérésis de 1° centrée sur -6° : de jour, on passe en soir sous -6,5° ; de soir, on revient en jour
//     au-dessus de -5,5°. Au sortir de la nuit (5h), ou sans thème précédent, seuil simple de -6°.
//   - Élévation inconnue (HA pas encore lu, attribut absent) : on garde le jour ou le soir déjà affiché,
//     sinon soir, moins éblouissant au petit matin qu'un faux jour.
//   - Pendant la nuit, un toucher montre l'Accueil en Ardoise (classe soir, luminosité 0,3) jusqu'au retour
//     d'inactivité ; sinon seule l'horloge atténuée reste (classe nuit, luminosité 0,05).
//   - ?theme= n'est appliqué que si le serveur est en développement : en production, /dev/reglages
//     n'existe pas (404) et demanderThemeForce rend null, comme pour une erreur réseau ou une réponse
//     sans theme_force. C'est la seule garde côté page : elle est testée ici, main.js ne fait que brancher
//     fetch (lireReglages) et appliquer le résultat.

import { partiesParis } from './heure.js';

const SEUIL = -6;
const DEMI_HYSTERESIS = 0.5;
// Nuit de 20 h 30 à 6 h (choix de Thomas du 14/10 ; 23 h à 5 h avant), en minutes depuis minuit, heure de Paris.
const DEBUT_NUIT = 20 * 60 + 30;
const FIN_NUIT = 6 * 60;
// Choix de Thomas du 14/10 (cadre au mur) : 1 et 0,4 étaient trop lumineux et usaient l'écran pour rien ; les
// alertes (minuteur, sonnette) repassent à 1 (main.js).
const LUMINOSITES = { jour: 0.6, soir: 0.3, nuit: 0.05 };
const THEMES = ['jour', 'soir', 'nuit'];

export function themePour(ms, elevation, precedent) {
  const parties = partiesParis(ms);
  const minutes = parties.heure * 60 + parties.minute;
  if (minutes >= DEBUT_NUIT || minutes < FIN_NUIT) return 'nuit';
  if (typeof elevation !== 'number' || !isFinite(elevation)) {
    return precedent === 'jour' || precedent === 'soir' ? precedent : 'soir';
  }
  if (precedent === 'jour') return elevation < SEUIL - DEMI_HYSTERESIS ? 'soir' : 'jour';
  if (precedent === 'soir') return elevation > SEUIL + DEMI_HYSTERESIS ? 'jour' : 'soir';
  return elevation > SEUIL ? 'jour' : 'soir';
}

export function apparence(theme, eveille) {
  const classe = theme === 'nuit' && eveille ? 'soir' : theme;
  return { classe, luminosite: LUMINOSITES[classe] };
}

export function themeDemande(recherche) {
  const theme = new URLSearchParams(recherche).get('theme');
  return THEMES.indexOf(theme) === -1 ? null : theme;
}

export function demanderThemeForce(recherche, lireReglages) {
  const demande = themeDemande(recherche);
  if (!demande) return Promise.resolve(null);
  return Promise.resolve()
    .then(() => lireReglages('/dev/reglages'))
    .then((reponse) => (reponse.status === 200 ? reponse.json() : null))
    .then((reglages) => (reglages && reglages.theme_force === true ? demande : null))
    .catch(() => null);
}
