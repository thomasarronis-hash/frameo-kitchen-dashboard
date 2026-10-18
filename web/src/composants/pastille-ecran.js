// web/src/composants/pastille-ecran.js
//
// Rôle    : la pastille du minuteur d'écran de Timo sur les autres écrans (choix de Thomas du 14/10, partie 4), comme celle
//           des minuteurs de cuisine : son visage et les minutes qui restent, en haut du menu, à la place de « La cuisine ».
// Entrées : le conteneur (#pastille-ecran) ; { ouvrir(id) } au toucher (l'écran Enfants sur sa quête) ; mettreAJour(vue) à
//           chaque tick, avec vuePastilleEcran d'enfants-donnees.js (null : aucun minuteur d'écran qui tourne).
// Sorties : creerPastilleEcran(conteneur, actions) -> { mettreAJour(vue) }.
// Pièges  :
//   - Dans la marque du menu (pastille-ecran.css) : elle ne cache aucun écran ni aucune entrée ; masquée avec le menu (mode
//     Photos, nuit, recette, mode enfant, où la bourse montre déjà le minuteur). Le mode Photos ne se déclenche pas tant
//     qu'un minuteur d'écran tourne (pilotage.js) : elle reste visible depuis l'Accueil.
//   - Ouvrir l'écran Enfants est une navigation : sur pointerdown.
//   - Appelée chaque seconde : seuls les textes qui changent sont écrits (dom.js).

import { creerAvatar } from './avatar.js';
import { ecrire, element, etiqueter, masquer } from '../dom.js';

export function creerPastilleEcran(conteneur, actions) {
  const avatar = creerAvatar('pastille-ecran-avatar');
  const temps = element('span', 'pastille-ecran-temps chiffres');
  const nombre = element('span', '');
  const unite = element('span', 'pastille-ecran-unite');
  temps.appendChild(nombre);
  temps.appendChild(unite);
  conteneur.appendChild(avatar.racine);
  conteneur.appendChild(temps);
  conteneur.hidden = true;
  conteneur.setAttribute('role', 'button');
  let id = null;
  conteneur.addEventListener('pointerdown', () => {
    if (id) actions.ouvrir(id);
  });
  return {
    mettreAJour(vue) {
      masquer(conteneur, vue === null);
      id = vue ? vue.id : null;
      if (!vue) return;
      avatar.mettreAJour({ ...vue, fini: false });
      ecrire(nombre, vue.nombre);
      ecrire(unite, vue.unite);
      etiqueter(conteneur, `${vue.prenom} regarde : encore ${vue.nombre} ${vue.unite}`);
    },
  };
}
