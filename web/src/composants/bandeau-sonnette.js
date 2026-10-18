// web/src/composants/bandeau-sonnette.js
//
// Rôle    : le bandeau sonnette (conception §1.6, piste 5) : en haut au centre de la scène, par-dessus TOUS les écrans
//           (Accueil, recette en plein écran, mode Photos), « On a sonné · 19:41 », la photo de CE coup de sonnette
//           (ou « Photo en cours… »), sa légende, et « Voir le direct » quand le serveur a un flux vidéo.
// Entrées : le conteneur (#sonnette de index.html, couche commune de la scène) ; { voirDirect() } ; mettreAJour(vue)
//           à chaque seconde avec la vue de web/src/sonnette.js (null : masqué).
// Sorties : creerBandeauSonnette(conteneur, actions) -> { mettreAJour(vue), estVisible(), contient(noeud) } ;
//           contient dit si un toucher vise le bouton « Voir le direct » (main.js masque le bandeau sur tout autre
//           toucher, et ce toucher-là n'atteint pas ce qui est dessous).
// Pièges  :
//   - « Voir le direct » ouvre un écran : navigation sur pointerdown (conception §1.2). Masqué sans flux vidéo
//     (vue.direct faux) : une photo fixe rafraîchie ne serait pas un direct.
//   - Verre en mode « teinte » seulement (fond semi-opaque, AUCUN backdrop-filter : le flou fait tomber les fondus à
//     16 FPS sur le cadre, docs/cadre-ave948.md), couleurs dans jetons.css.
//   - La photo est vidée quand le bandeau se masque : rien ne reste en mémoire d'image ni à l'écran.
//   - Réveil de l'écran (luminosité du jour, sortie du mode nuit) : décidé dans main.js d'après estVisible().

import { ecrire, element, icone, masquer } from '../dom.js';
import { creerPhotoSonnette } from './photo-sonnette.js';

export function creerBandeauSonnette(conteneur, { voirDirect }) {
  const photo = creerPhotoSonnette(conteneur, 'sonnette-photo');
  const textes = element('div', 'sonnette-textes');
  const titre = element('p', 'sonnette-titre');
  const legende = element('p', 'sonnette-legende');
  textes.appendChild(icone('i-bell', 'sonnette-icone'));
  textes.appendChild(titre);
  textes.appendChild(legende);
  textes.appendChild(element('p', 'sonnette-consigne', 'Toucher ailleurs pour masquer'));
  const bouton = element('button', 'bouton-fort sonnette-voir');
  bouton.type = 'button';
  bouton.appendChild(icone('i-camera', 'bouton-fort-icone'));
  bouton.appendChild(element('span', '', 'Voir le direct'));
  bouton.addEventListener('pointerdown', () => voirDirect());
  conteneur.appendChild(textes);
  conteneur.appendChild(bouton);
  conteneur.hidden = true;

  return {
    mettreAJour(vue) {
      masquer(conteneur, vue === null);
      if (vue === null) {
        photo.vider();
        return;
      }
      ecrire(titre, vue.texte);
      ecrire(legende, vue.legende);
      masquer(legende, !vue.photo);
      masquer(bouton, !vue.direct);
      if (vue.photo) photo.afficher(vue.photo);
      else photo.annoncer(vue.legende);
    },
    estVisible: () => !conteneur.hidden,
    contient: (noeud) => !bouton.hidden && bouton.contains(noeud),
  };
}
