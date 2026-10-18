// web/src/composants/avatar.js
//
// Rôle    : le visage d'un enfant (choix de Thomas du 14/10, partie 4) : un rond de sa couleur avec son petit personnage
//           dessiné au trait (avatar du barème : renard pour Timo, ourson pour Pablo), et une étoile dorée posée dessus quand
//           sa routine du matin est finie. Servi par la case du matin de l'Accueil, l'écran d'entrée, le sélecteur du mode
//           enfant, le chemin de la quête, la pastille du minuteur d'écran et le message de fin.
// Entrées : creerAvatar(classe) ; mettreAJour({ prenom, avatar, couleur, fini }) avec un visage d'enfants-donnees.js.
// Sorties : { racine, mettreAJour(visage) }.
// Pièges  :
//   - Couleur par classe couleur-<couleur du barème> (avatar.css) : aucune couleur écrite ici ; un enfant ajouté au barème
//     demande sa règle dans avatar.css (tests/enfants-page.test.js le vérifie).
//   - L'étoile ne dit rien d'autre que « fini » : ni chiffre ni progression (pas de comparaison entre frères).
//   - Étiquette d'accessibilité : le prénom (le dessin n'en a pas), plus « routine finie » avec l'étoile.
//   - L'étoile est dans un span : hidden n'existe pas sur un élément SVG (masquer() de dom.js ne le cacherait pas).

import {
  changerIcone, element, etiqueter, icone, masquer,
} from '../dom.js';

export function creerAvatar(classe) {
  const racine = element('span', classe ? `avatar ${classe}` : 'avatar');
  racine.setAttribute('role', 'img');
  const dessin = icone(null, 'avatar-dessin');
  const etoile = element('span', 'avatar-etoile');
  etoile.appendChild(icone('i-etoile', 'avatar-etoile-dessin'));
  racine.appendChild(dessin);
  racine.appendChild(etoile);
  let couleur = null;
  return {
    racine,
    mettreAJour(visage) {
      changerIcone(dessin, visage.avatar);
      if (visage.couleur !== couleur) {
        if (couleur) racine.classList.remove(`couleur-${couleur}`);
        racine.classList.add(`couleur-${visage.couleur}`);
        couleur = visage.couleur;
      }
      masquer(etoile, !visage.fini);
      etiqueter(racine, visage.fini ? `${visage.prenom}, routine finie` : visage.prenom);
    },
  };
}
