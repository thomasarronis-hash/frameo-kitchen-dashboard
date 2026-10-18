// web/src/scene.js
//
// Rôle    : mettre la scène fixe de 1920x1080 px à l'échelle de la fenêtre quand elle ne fait pas
//           1920x1080 (développement dans un navigateur), centrée et sans déformation.
// Entrées : l'élément de la scène, la fenêtre (innerWidth, innerHeight).
// Sorties : echelleScene(largeur, hauteur) -> { echelle, x, y } ; ajusterScene(scene, fenetre) pose le transform.
// Pièges  :
//   - Sur le cadre, le viewport width=1920 du kiosque donne 1920x1080 : échelle 1, aucun transform.
//   - transform seulement (pas de zoom CSS), origine en haut à gauche (base.css) : translate puis scale.

const LARGEUR = 1920;
const HAUTEUR = 1080;

export function echelleScene(largeur, hauteur) {
  const echelle = Math.min(largeur / LARGEUR, hauteur / HAUTEUR);
  return { echelle, x: (largeur - LARGEUR * echelle) / 2, y: (hauteur - HAUTEUR * echelle) / 2 };
}

export function ajusterScene(scene, fenetre) {
  const { echelle, x, y } = echelleScene(fenetre.innerWidth, fenetre.innerHeight);
  scene.style.transform = echelle === 1 ? '' : `translate(${x}px, ${y}px) scale(${echelle})`;
}
