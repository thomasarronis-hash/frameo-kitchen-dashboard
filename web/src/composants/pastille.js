// web/src/composants/pastille.js
//
// Rôle    : la pastille des minuteurs, visible sur TOUS les écrans, nuit comprise (conception §1.6) : le temps
//           restant du minuteur le plus proche (ou « Terminé » s'il sonne), son nom, et combien d'autres tournent.
// Entrées : le conteneur (#pastille) ; { ouvrir() } appelé au toucher ; mettreAJour(vue) à chaque tick, avec
//           vuePastille de web/src/minuteurs.js (null : aucun minuteur).
// Sorties : creerPastille(conteneur, actions) -> { mettreAJour(vue) }.
// Pièges  :
//   - Ouvrir le tiroir est une navigation : sur pointerdown. La nuit, le même toucher réveille l'écran (main.js,
//     écouteur en phase de capture) puis le tiroir s'ouvre.
//   - Appelée chaque seconde : seuls les textes qui changent sont écrits (dom.js), la classe « sonne » n'est
//     basculée que si elle change (classList.toggle ne touche pas au DOM sans changement).
//   - En haut à droite de la scène (minuteurs.css) : les écrans gardent ce coin libre.

import { changerIcone, ecrire, element, icone, masquer } from '../dom.js';

export function creerPastille(conteneur, actions) {
  const picto = icone('i-timer', 'pastille-icone');
  const temps = element('span', 'pastille-temps chiffres');
  const textes = element('span', 'pastille-textes');
  const libelle = element('span', 'pastille-libelle');
  const autres = element('span', 'pastille-autres');
  textes.appendChild(libelle);
  textes.appendChild(autres);
  [picto, temps, textes].forEach((noeud) => conteneur.appendChild(noeud));
  conteneur.hidden = true;
  conteneur.setAttribute('role', 'button');
  conteneur.addEventListener('pointerdown', () => actions.ouvrir());

  return {
    mettreAJour(vue) {
      masquer(conteneur, vue === null);
      if (!vue) return;
      ecrire(temps, vue.temps);
      ecrire(libelle, vue.libelle);
      ecrire(autres, vue.autres);
      masquer(autres, vue.autres === '');
      changerIcone(picto, vue.sonne ? 'i-bell' : 'i-timer');
      conteneur.classList.toggle('pastille-sonne', vue.sonne);
    },
  };
}
