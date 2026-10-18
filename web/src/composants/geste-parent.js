// web/src/composants/geste-parent.js
//
// Rôle    : le geste qui ouvre le mode parent du tableau des enfants (décision de Thomas du 14/10 au soir) : un APPUI LONG
//           DE 3 S SUR LE VISAGE d'un enfant (visages ronds en haut à droite du mode enfant, visage dessiné de sa carte sur
//           l'écran d'entrée) ouvre le mode parent de CET enfant. Un toucher court garde l'action du visage.
// Entrées : surGesteParent(noeud, { court, parent }) : le visage, l'action du toucher court, l'ouverture du mode parent.
// Sorties : rien (parent() est appelé une fois par appui long réussi ; court() pour un toucher court, au lever).
// Pièges  :
//   - C'est l'appui long d'appui.js (surAppuiLong) avec ses réglages à lui : 3 s, 40 px de tolérance, aucun retour. Raté :
//     doigt qui bouge de plus de 40 px, levé ou annulé (pointercancel, page cachée) avant 3 s. Après un appui réussi, le
//     lever ne fait rien (ni changement d'enfant, ni ouverture de la carte).
//   - Le visage ne peut donc pas réagir au poser (règle de Wes) : il faut attendre le lever ou les 3 s pour savoir si
//     c'est un toucher court. Le reste de l'écran Enfants (maison, onglets, carte autour du visage) reste au poser.
//   - AUCUN retour pendant les 3 s (ni anneau, ni classe, ni son) : rien à regarder, rien à apprendre en regardant. Le
//     bandeau « Mode parent » apparaît à l'ouverture.
//   - Pourquoi pas « trois doigts tenus 3 s » (commit 85ee9ab) : le contrôleur tactile du cadre (gsl3673) ne suit que DEUX
//     doigts à la fois (relevé brut du 14/10), et deux doigts immobiles 1,5 s sont le geste de sortie du kiosque
//     (Réglages d'Android, MainActivity.surveillerSortie). Un seul doigt ici : aucun risque de le déclencher.
//   - Barrière contre les doigts d'enfants, pas une sécurité : Timo peut le découvrir (Thomas le sait ; le mode parent
//     sert surtout à corriger, au −1 et aux échanges de la boutique ; serveur/enfants/mode-parent.js).

import { surAppuiLong } from './appui.js';

const TENIR_MS = 3000;
const TOLERANCE_PX = 40;

export function surGesteParent(noeud, { court, parent }) {
  surAppuiLong(noeud, {
    court, long: parent, dureeMs: TENIR_MS, tolerancePx: TOLERANCE_PX, retour: false,
  });
}
