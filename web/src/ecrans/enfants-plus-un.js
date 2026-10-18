// web/src/ecrans/enfants-plus-un.js
//
// Rôle    : le bouton « +1 » libre de Timo (décision de Thomas du 14/10 en fin d'après-midi), dans l'en-tête de son écran,
//           sur les onglets Quête et Points : tout le monde peut le toucher, sans mode parent (un parent qui passe, Timo
//           lui-même). Après chaque appui, un bouton retour (icône seule, barre d'or qui se vide) retire ce point pendant
//           5 s (erreur de doigt) ; au plafond du jour, le bouton est grisé et dit « À demain ».
// Entrées : creerPlusUn(parent, { donner(noeud), annuler() }) ; mettreAJour(vue de boutique-donnees.js vuePlusUn, ms).
// Sorties : { racine, bouton (nœud du « +1 », départ de l'étoile qui vole), mettreAJour(vue, ms) }.
// Pièges  :
//   - Un toucher simple au lever du doigt (appui.js) : un doigt qui glisse n'envoie rien. Pas d'appui long : le bouton sert à un parent qui passe, Thomas l'a voulu sans détour.
//   - Grisé au plafond (disabled, aucune opacité) : le toucher ne part plus, le serveur refuserait (plafond_libre).
//   - Barre du retour en transform: scaleX avec une transition posée une fois par point (même mécanique que l'Annuler de
//     la quête) ; le rendu de chaque seconde masque le retour après 5 s.
//   - Couleurs : l'or des pièces et le « +1 » en --texte-piece (paire contrôlée), comme les « +1 » de la liste Bravo.

import { surAppui } from '../composants/appui.js';
import {
  changerIcone, ecrire, element, etiqueter, icone, masquer,
} from '../dom.js';

const DUREE_RETOUR_MS = 5000;

export function creerPlusUn(parent, actions) {
  const racine = element('div', 'plus-un');
  const retour = element('button', 'bouton-doux plus-un-retour');
  retour.type = 'button';
  retour.appendChild(icone('i-back', 'plus-un-retour-icone'));
  const barre = element('span', 'plus-un-retour-barre');
  retour.appendChild(barre);
  etiqueter(retour, 'Annuler le point');
  retour.hidden = true;
  const bouton = element('button', 'plus-un-bouton');
  bouton.type = 'button';
  const picto = icone('i-etoile', 'plus-un-etoile');
  const texte = element('span', 'plus-un-texte chiffres');
  bouton.appendChild(picto);
  bouton.appendChild(texte);
  racine.appendChild(retour);
  racine.appendChild(bouton);
  parent.appendChild(racine);
  let jusqua = null;
  surAppui(bouton, () => {
    if (!bouton.disabled) actions.donner(bouton);
  });
  surAppui(retour, () => {
    if (jusqua !== null) actions.annuler();
  });

  function rendreRetour(annulation, ms) {
    masquer(retour, annulation === null);
    if (!annulation) {
      jusqua = null;
      return;
    }
    if (annulation.jusqua === jusqua) return;
    jusqua = annulation.jusqua;
    barre.style.transition = 'none';
    barre.style.transform = `scaleX(${Math.max(0, Math.min(1, (jusqua - ms) / DUREE_RETOUR_MS))})`;
    if (typeof barre.getBoundingClientRect === 'function') barre.getBoundingClientRect();
    barre.style.transition = `transform ${Math.max(0, jusqua - ms)}ms linear`;
    barre.style.transform = 'scaleX(0)';
  }

  return {
    racine,
    bouton,
    mettreAJour(vue, ms) {
      if (bouton.disabled !== !vue.possible) bouton.disabled = !vue.possible;
      bouton.classList.toggle('plus-un-plafond', !vue.possible);
      changerIcone(picto, vue.possible ? 'i-etoile' : 'i-moon');
      ecrire(texte, vue.texte);
      etiqueter(bouton, vue.possible ? 'Donner un point' : 'Assez de points pour aujourd\'hui');
      rendreRetour(vue.annulation, ms);
    },
  };
}
