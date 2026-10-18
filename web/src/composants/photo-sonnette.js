// web/src/composants/photo-sonnette.js
//
// Rôle    : une photo de la sonnette qui se recharge sans clignoter (bandeau « On a sonné », section Sonnette de
//           l'écran Maison) : deux <img> superposées, la nouvelle ne remplace l'ancienne qu'une fois chargée ; ou, à la
//           place de l'image, un court message (« Photo en cours… »).
// Entrées : creerPhotoSonnette(parent, classe) ; afficher(url) avec une URL de /api/sonnette.jpg qui change quand la
//           photo change (web/src/sonnette.js) ; annoncer(texte) ; vider().
// Sorties : { racine, afficher(url), annoncer(texte), vider() }.
// Pièges  :
//   - Le chargement se fait dans l'image cachée ; à son load, elle passe devant et l'autre se cache. Une réponse qui
//     arrive pour une URL déjà dépassée (rechargement suivant demandé entre-temps) est ignorée.
//   - Échec (HA injoignable, 502 du serveur) : l'ancienne photo reste ; « Photo indisponible » seulement s'il n'y en
//     a encore aucune.
//   - Même URL redemandée : rien n'est rechargé (la page redessine chaque seconde).
//   - annoncer() et vider() retirent les src : le navigateur abandonne un chargement en cours et ne garde aucune
//     image (ni à l'écran, ni en mémoire) ; appelés à chaque seconde, ils ne touchent au DOM que si quelque chose
//     change.

import { ecrire, element, masquer } from '../dom.js';

export function creerPhotoSonnette(parent, classe) {
  const racine = element('div', `photo-sonnette ${classe}`);
  const images = [element('img', 'photo-sonnette-image'), element('img', 'photo-sonnette-image')];
  const message = element('p', 'photo-sonnette-message', 'Photo indisponible');
  let devant = 0;
  let demandee = null;

  images.forEach((image, i) => {
    image.alt = 'Photo de la sonnette';
    image.hidden = true;
    image.addEventListener('load', () => {
      if (image.getAttribute('src') !== demandee) return;
      masquer(image, false);
      masquer(images[1 - i], true);
      devant = i;
      masquer(message, true);
    });
    image.addEventListener('error', () => {
      if (image.getAttribute('src') === demandee && images[devant].hidden) {
        ecrire(message, 'Photo indisponible');
        masquer(message, false);
      }
    });
    racine.appendChild(image);
  });
  message.hidden = true;
  racine.appendChild(message);
  parent.appendChild(racine);

  // Retire les images (src compris) ; garde le message tel quel.
  function retirerImages() {
    demandee = null;
    images.forEach((image) => {
      if (image.hasAttribute('src')) image.removeAttribute('src');
      masquer(image, true);
    });
  }

  return {
    racine,
    afficher(url) {
      if (url === demandee) return;
      demandee = url;
      images[1 - devant].src = url;
    },
    annoncer(texte) {
      retirerImages();
      ecrire(message, texte);
      masquer(message, false);
    },
    vider() {
      retirerImages();
      masquer(message, true);
    },
  };
}
