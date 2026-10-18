// web/src/ecrans/enfants-effets.js
//
// Rôle    : les petites animations du tableau des enfants (choix de Thomas du 14/10, partie 4) : le « +5 » qui vole d'une case
//           vers la bourse, les pièces qui tombent dedans, l'étoile de Pablo qui tombe dans son bocal, la fête du coffre et
//           de la case « Ensuite », et le petit rebond d'un nombre qui monte.
// Entrées : la racine de l'écran des enfants (position: relative) et les nœuds de départ et d'arrivée, déjà affichés.
// Sorties : voler(racine, depuis, vers, { classe, texte, icone }) ; pluie(racine, cible, nombre) ; fete(racine, cible) ;
//           rebond(noeud).
// Pièges  :
//   - Web Animations (element.animate), en transform et opacity seulement (conception §3.1), jamais d'@keyframes (les
//     feuilles n'admettent que @font-face, tests/contraste.test.js). Sans animate (faux DOM des tests, très vieille
//     WebView), rien ne bouge et rien ne reste : l'état final est déjà affiché par l'écran.
//   - La scène est mise à l'échelle par transform en développement (scene.js) : les positions lues par
//     getBoundingClientRect sont divisées par l'échelle de la racine pour rester en pixels de la scène.
//   - Les éléments volants sont retirés à la fin de leur animation (onfinish), et au plus tard au bout de 3 s : jamais de
//     nœud oublié dans la page, qui tourne des jours.
//   - Couleurs par classes (enfants-effets.css), aucune ici.

import { element, icone } from '../dom.js';

const DUREE_VOL_MS = 900;
const DUREE_PLUIE_MS = 700;
const DUREE_FETE_MS = 1400;
const NETTOYAGE_MS = 3000;
const BRINS_FETE = 18;

const anime = (noeud) => typeof noeud.animate === 'function';

function centreDans(racine, noeud) {
  const cadre = racine.getBoundingClientRect();
  const boite = noeud.getBoundingClientRect();
  const echelle = racine.offsetWidth ? cadre.width / racine.offsetWidth : 1;
  return {
    x: (boite.left + boite.width / 2 - cadre.left) / (echelle || 1),
    y: (boite.top + boite.height / 2 - cadre.top) / (echelle || 1),
  };
}

function poser(racine, classe, point) {
  const noeud = element('span', `effet ${classe}`);
  noeud.style.left = `${Math.round(point.x)}px`;
  noeud.style.top = `${Math.round(point.y)}px`;
  racine.appendChild(noeud);
  const retirer = () => {
    if (noeud.parentNode) noeud.parentNode.removeChild(noeud);
  };
  setTimeout(retirer, NETTOYAGE_MS);
  return { noeud, retirer };
}

function jouer(noeud, images, options, retirer) {
  const animation = noeud.animate(images, options);
  animation.onfinish = retirer;
}

export function voler(racine, depuis, vers, { classe, texte, icone: picto }) {
  if (!anime(racine)) return;
  const a = centreDans(racine, depuis);
  const b = centreDans(racine, vers);
  const { noeud, retirer } = poser(racine, classe, a);
  if (picto) noeud.appendChild(icone(picto, 'effet-icone'));
  if (texte) noeud.appendChild(element('span', 'effet-texte', texte));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  jouer(noeud, [
    { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
    { transform: `translate(calc(-50% + ${dx * 0.3}px), calc(-50% + ${dy * 0.3 - 120}px)) scale(1.2)`, opacity: 1, offset: 0.35 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.7)`, opacity: 1, offset: 0.9 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.4)`, opacity: 0 },
  ], { duration: DUREE_VOL_MS, easing: 'ease-in-out' }, retirer);
}

export function pluie(racine, cible, nombre) {
  if (!anime(racine)) return;
  const centre = centreDans(racine, cible);
  for (let i = 0; i < nombre; i += 1) {
    const decalage = (i - (nombre - 1) / 2) * 34;
    const { noeud, retirer } = poser(racine, 'effet-piece', { x: centre.x + decalage, y: centre.y });
    jouer(noeud, [
      { transform: 'translate(-50%, -260%)', opacity: 0 },
      { transform: 'translate(-50%, -160%)', opacity: 1, offset: 0.3 },
      { transform: 'translate(-50%, -50%)', opacity: 1, offset: 0.85 },
      { transform: 'translate(-50%, -20%) scale(0.6)', opacity: 0 },
    ], { duration: DUREE_PLUIE_MS, delay: DUREE_VOL_MS * 0.8 + i * 90, easing: 'ease-in', fill: 'backwards' }, retirer);
  }
}

export function fete(racine, cible) {
  if (!anime(racine)) return;
  const centre = centreDans(racine, cible);
  for (let i = 0; i < BRINS_FETE; i += 1) {
    const angle = (i / BRINS_FETE) * 2 * Math.PI;
    const distance = 160 + (i % 3) * 70;
    const { noeud, retirer } = poser(racine, `effet-brin fete-${(i % 4) + 1}`, centre);
    const x = Math.round(Math.cos(angle) * distance);
    const y = Math.round(Math.sin(angle) * distance - 80);
    jouer(noeud, [
      { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${(i % 2 ? 1 : -1) * 220}deg)`, opacity: 1, offset: 0.7 },
      { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y + 140}px)) rotate(${(i % 2 ? 1 : -1) * 300}deg)`, opacity: 0 },
    ], { duration: DUREE_FETE_MS, delay: (i % 5) * 40, easing: 'ease-out', fill: 'backwards' }, retirer);
  }
}

export function rebond(noeud) {
  if (!anime(noeud)) return;
  noeud.animate([
    { transform: 'scale(1)' }, { transform: 'scale(1.25)', offset: 0.4 }, { transform: 'scale(1)' },
  ], { duration: 500, easing: 'ease-out' });
}
