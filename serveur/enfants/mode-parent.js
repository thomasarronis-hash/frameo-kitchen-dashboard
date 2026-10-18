// serveur/enfants/mode-parent.js
//
// Rôle    : le « mode parent » du tableau des enfants : après le geste parent dans la page (appui long de 3 s sur le
//           visage d'un enfant), le serveur délivre un jeton court, exigé par les routes réservées aux parents (valider une étape,
//           donner ou retirer un point, valider un échange, historique).
// Entrées : creerModeParent({ maintenant, dureeMs }) : horloge en millisecondes (remplacée dans les tests), durée de vie du
//           jeton (60 s).
// Sorties : { emettre() -> { jeton, expire_le } (ISO), valide(fourni) -> booléen } (jeton de 60 s par défaut, dureeMs).
// Pièges  :
//   - C'est une barrière contre les doigts d'enfants, PAS une sécurité forte : tout appareil qui porte une clé (le cadre,
//     le Clevo) obtient un jeton sans autre preuve, et le geste est connu de quiconque l'a vu faire. La vraie barrière
//     reste la clé d'appareil (securite.js). Rien de dangereux ne passe par ce mode : il n'ouvre ni la maison ni HA.
//   - Un seul jeton à la fois, en mémoire : en demander un autre remplace le précédent ; un redémarrage les oublie tous.
//   - Durée fixe de 60 s depuis l'émission (pas prolongée par l'usage) : après, la page doit refaire le geste.
//   - Comparaison en temps constant (comparateurConstant de securite.js), et le jeton n'est jamais journalisé (l'en-tête
//     X-Cadre-Parent est masqué par optionsJournal).

import { randomBytes } from 'node:crypto';
import { comparateurConstant } from '../securite.js';

const DUREE_MODE_PARENT_MS = 60_000;

export function creerModeParent({ maintenant = Date.now, dureeMs = DUREE_MODE_PARENT_MS } = {}) {
  let estLeJeton = () => false;
  let expire = 0;
  return {
    emettre() {
      const jeton = randomBytes(16).toString('hex');
      estLeJeton = comparateurConstant(jeton);
      expire = maintenant() + dureeMs;
      return { jeton, expire_le: new Date(expire).toISOString() };
    },
    valide(fourni) {
      return estLeJeton(fourni) && maintenant() < expire;
    },
  };
}
