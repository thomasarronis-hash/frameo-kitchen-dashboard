// web/src/routeur.js
//
// Rôle    : le routeur d'écrans de la page, sorti de main.js pour être testé avec de faux écrans : un seul écran
//           visible à la fois, l'écran QUITTÉ est prévenu (il libère ce qu'il tient : images du mode Photos, direct de
//           la sonnette, Wi-Fi invités affiché, saisie des courses), l'écran ouvert aussi (entrer), le mode Photos
//           ambiant en plein écran (classe scene-photos), et la recette qui masque tout quand elle est ouverte.
// Entrées : creerRouteur({ ecrans, scene, tiroir, menu, recetteOuverte }) : ecrans { nom: { racine, entrer(contexte)?,
//           quitter()? } } (photos.entrer rend vrai si le mode ambiant s'ouvre, faux s'il refuse) ; scene (#scene, classList) ; tiroir
//           (fermer) ; menu (marquerActif) ; recetteOuverte() -> booléen.
// Sorties : creerRouteur(...) -> { afficher(nom, contexte), rafraichir(), actif() } ; contexte (Photos : { nuit,
//           enLigne }) est passé tel quel à entrer ; rafraichir() remet le masquage après l'ouverture ou la fermeture de
//           la recette, sans rentrer dans l'écran.
// Pièges  :
//   - quitter() n'est appelé qu'en changeant d'écran ; entrer() à chaque affichage (Maison recharge la photo de la
//     sonnette, Photos revérifie s'il peut s'ouvrir, Enfants revient à son écran d'entrée et rend le menu ; son mode
//     enfant plein écran, classe scene-enfant, est posé par l'écran lui-même, via main.js).
//   - Mode Photos ambiant : le tiroir des minuteurs se referme et le menu disparaît (classe scene-photos, menu.css).
//     Photos n'a plus de face « page » (plus d'entrée au menu depuis le 14/10) : s'il refuse de s'ouvrir (nuit, hors
//     ligne, pas de photos ; main.js ne le demande pourtant que dans les mêmes conditions), l'Accueil s'affiche à sa
//     place, jamais une page vide.

import { masquer } from './dom.js';

export function creerRouteur({
  ecrans, scene, tiroir, menu, recetteOuverte,
}) {
  let actif = 'accueil';

  function rafraichir() {
    const recette = recetteOuverte();
    Object.keys(ecrans).forEach((cle) => masquer(ecrans[cle].racine, recette || cle !== actif));
    menu.marquerActif(actif);
  }

  return {
    afficher(nom, contexte) {
      if (actif !== nom && ecrans[actif].quitter) ecrans[actif].quitter();
      const ouvert = ecrans[nom].entrer ? ecrans[nom].entrer(contexte || {}) : false;
      const ambiance = nom === 'photos' && ouvert === true;
      if (ambiance) tiroir.fermer();
      scene.classList.toggle('scene-photos', ambiance);
      actif = nom === 'photos' && !ambiance ? 'accueil' : nom;
      rafraichir();
    },
    rafraichir,
    actif: () => actif,
  };
}
