// web/src/composants/anneau.js
//
// Rôle    : l'anneau qui se remplit pendant l'appui long d'une seconde sur une case ronde de la quête de Timo : deux
//           moitiés qui tournent, en transform seulement (anneau.css).
// Entrées : creerAnneau() ; la cible porte la classe appui-long-en-cours pendant l'appui (composants/appui.js).
// Sorties : l'élément à poser dans la cible (position: relative), sans écouteur.
// Pièges  :
//   - Aucune @keyframes (tests/contraste.test.js n'admet que @font-face) : le remplissage est une transition de rotation
//     posée par la classe appui-long-en-cours, retirée d'un coup (transition: none) quand le doigt se lève.
//   - La durée de la transition est dans la feuille (1 s, une moitié par demi-seconde) ; elle doit rester celle du geste
//     (dureeMs de surAppuiLong). Le geste parent n'a volontairement aucun anneau (composants/geste-parent.js).

import { element } from '../dom.js';

export function creerAnneau() {
  const anneau = element('span', 'anneau');
  anneau.setAttribute('aria-hidden', 'true');
  ['anneau-droite', 'anneau-gauche'].forEach((cote) => {
    const moitie = element('span', `anneau-moitie ${cote}`);
    moitie.appendChild(element('span', 'anneau-arc'));
    anneau.appendChild(moitie);
  });
  return anneau;
}
