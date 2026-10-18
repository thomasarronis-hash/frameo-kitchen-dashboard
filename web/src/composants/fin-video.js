// web/src/composants/fin-video.js
//
// Rôle    : le message de fin du minuteur d'écran de Timo (choix de Thomas du 14/10, partie 4), par-dessus tous les écrans :
//           son visage, une télé, « Fin de la vidéo » en grand et « puis on éteint », avec un son doux. Le cadre ne coupe
//           rien : Timo regarde sur la tablette, le message sert de signal à la famille.
// Entrées : le conteneur (#fin-video) ; { fermer(cle) } quand on le touche ; mettreAJour(vue) à chaque tick, avec l'observation
//           de creerVeilleFin (enfants-donnees.js) : null ou { cle, prenom, avatar, couleur, sonner } ; { jouer(nom) } des sons.
// Sorties : creerFinVideo(conteneur, { fermer, sons }) -> { mettreAJour(vue), estVisible() }.
// Pièges  :
//   - Montré 2 min au plus après la fin (enfants-donnees.js), ou jusqu'au premier toucher, qui ne fait QUE le fermer (le
//     voile couvre toute la scène : le bouton dessous ne voit pas le toucher).
//   - Son « fin » une seule fois par fin (clé), et seulement si la fin est fraîche (sonner) : pas de son pour une fin
//     relue après un rechargement.
//   - Couleurs des jetons (fin-video.css) ; verre « teinte » interdit ici aussi : voile opaque à 55 % derrière une carte
//     opaque, le texte n'est jamais sur le voile.

import { creerAvatar } from './avatar.js';
import { element, icone, masquer } from '../dom.js';

export function creerFinVideo(conteneur, { fermer, sons }) {
  conteneur.appendChild(element('div', 'fin-video-voile'));
  const carte = element('div', 'carte fin-video-carte');
  const dessins = element('div', 'fin-video-dessins');
  const avatar = creerAvatar('fin-video-avatar');
  dessins.appendChild(avatar.racine);
  dessins.appendChild(icone('i-tv', 'fin-video-tele'));
  carte.appendChild(dessins);
  carte.appendChild(element('p', 'fin-video-titre', 'Fin de la vidéo'));
  carte.appendChild(element('p', 'fin-video-texte', 'puis on éteint'));
  conteneur.appendChild(carte);
  conteneur.hidden = true;
  let cle = null;
  const sonnees = {};
  conteneur.addEventListener('pointerdown', () => {
    if (cle) fermer(cle);
    cle = null;
    masquer(conteneur, true);
  });
  return {
    mettreAJour(vue) {
      masquer(conteneur, vue === null);
      cle = vue ? vue.cle : null;
      if (!vue) return;
      avatar.mettreAJour({ ...vue, fini: false });
      if (vue.sonner && !sonnees[vue.cle]) {
        sonnees[vue.cle] = true;
        sons.jouer('fin');
      }
    },
    estVisible: () => !conteneur.hidden,
  };
}
