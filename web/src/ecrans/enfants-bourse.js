// web/src/ecrans/enfants-bourse.js
//
// Rôle    : la bourse de Timo, à droite de sa quête (choix de Thomas du 14/10) : les minutes qu'il peut encore regarder en
//           très grand sous une bourse dessinée, le bouton « Je regarde » (appui long) qui la change en minuteur qui se vide
//           comme un Time Timer (disque, minutes restantes en très grand, Pause, Fini), puis « Fin de la vidéo, puis on
//           éteint » ; « À demain » une fois les minutes perdues le soir.
// Entrées : creerBourse(parent, { minuteur(action) }) ; mettreAJour(vue de quete-donnees.js vueBourse) à chaque rendu et
//           chaque seconde.
// Sorties : { racine, nombre (nœud du grand nombre, cible des pièces), mettreAJour(vue) } ; secteur(fraction, cx, cy, r) ->
//           l'attribut d d'un secteur de disque partant de midi dans le sens des aiguilles (testé).
// Pièges  :
//   - Timo regarde sur la tablette : le cadre ne pilote rien, il montre le temps (Barkley, « rendre le temps réel »).
//   - Disque en SVG, un seul chemin recalculé chaque seconde (pas d'animation CSS : un attribut qui change, comme un
//     texte) ; jamais rouge : le secteur est de la couleur des pièces, gris en pause.
//   - « Je regarde » à l'appui long d'une seconde (barre qui se remplit, comme les autres appuis longs du cadre) : un
//     toucher qui passe ne lance rien. Pause et Fini d'un toucher (lever du doigt, appui.js).
//   - Signe « min » à part et plus petit que le nombre : en Fraunces d'affichage, un petit signe se perd à 2 m (même
//     remède que le % des voitures).

import { surAppui, surAppuiLong } from '../composants/appui.js';
import { ecrire, element, icone, masquer } from '../dom.js';

const NS_SVG = 'http://www.w3.org/2000/svg';
const MODES = ['bourse', 'minuteur', 'pause', 'fin', 'perdues'];
const TAILLE = 400;

export function secteur(fraction, cx, cy, r) {
  if (fraction <= 0) return '';
  if (fraction >= 0.9999) return `M${cx} ${cy - r}A${r} ${r} 0 1 1 ${cx} ${cy + r}A${r} ${r} 0 1 1 ${cx} ${cy - r}Z`;
  const angle = fraction * 2 * Math.PI;
  const x = (cx + r * Math.sin(angle)).toFixed(2);
  const y = (cy - r * Math.cos(angle)).toFixed(2);
  return `M${cx} ${cy}L${cx} ${cy - r}A${r} ${r} 0 ${fraction > 0.5 ? 1 : 0} 1 ${x} ${y}Z`;
}

function svg(nom, attributs) {
  const noeud = document.createElementNS(NS_SVG, nom);
  Object.keys(attributs).forEach((cle) => noeud.setAttribute(cle, attributs[cle]));
  return noeud;
}

function chiffres(classe) {
  const ligne = element('p', `${classe} chiffres chiffres-affiche`);
  const nombre = element('span', '');
  const unite = element('span', 'bourse-unite');
  ligne.appendChild(nombre);
  ligne.appendChild(unite);
  return { ligne, nombre, unite };
}

function bouton(classe, picto, texte) {
  const noeud = element('button', classe);
  noeud.type = 'button';
  noeud.appendChild(icone(picto, 'bouton-fort-icone'));
  noeud.appendChild(element('span', '', texte));
  return noeud;
}

export function creerBourse(parent, actions) {
  const racine = element('div', 'carte bourse');
  const repos = element('div', 'bourse-repos');
  repos.appendChild(icone('i-bourse', 'bourse-dessin'));
  const total = chiffres('bourse-nombre');
  const gagnees = element('p', 'bourse-gagnees');
  [total.ligne, gagnees].forEach((noeud) => repos.appendChild(noeud));

  const disque = element('div', 'bourse-disque');
  const dessin = svg('svg', { class: 'bourse-disque-svg', viewBox: `0 0 ${TAILLE} ${TAILLE}`, 'aria-hidden': 'true' });
  dessin.appendChild(svg('circle', {
    class: 'bourse-disque-piste', cx: TAILLE / 2, cy: TAILLE / 2, r: TAILLE / 2 - 4,
  }));
  const reste = svg('path', { class: 'bourse-disque-reste' });
  dessin.appendChild(reste);
  const centre = element('div', 'bourse-disque-centre');
  const restant = chiffres('bourse-restant');
  centre.appendChild(restant.ligne);
  disque.appendChild(dessin);
  disque.appendChild(centre);

  const fin = element('div', 'bourse-fin');
  fin.appendChild(icone('i-tv', 'bourse-fin-dessin'));
  fin.appendChild(element('p', 'bourse-fin-titre', 'Fin de la vidéo'));
  fin.appendChild(element('p', 'bourse-fin-texte', 'puis on éteint'));

  const perdues = element('div', 'bourse-perdues');
  perdues.appendChild(icone('i-moon', 'bourse-fin-dessin'));
  perdues.appendChild(element('p', 'bourse-fin-titre', 'À demain'));

  const boutons = element('div', 'bourse-boutons');
  const regarder = bouton('bouton-fort bourse-regarder', 'i-tv', 'Je regarde');
  const pause = bouton('bouton-doux', 'i-pause', 'Pause');
  const finir = bouton('bouton-doux', 'i-check', 'Fini');
  [regarder, pause, finir].forEach((noeud) => boutons.appendChild(noeud));
  surAppuiLong(regarder, { court: () => {}, long: () => actions.minuteur('demarrer') });
  surAppui(pause, () => actions.minuteur('pause'));
  surAppui(finir, () => actions.minuteur('finir'));

  [repos, disque, fin, perdues, boutons].forEach((noeud) => racine.appendChild(noeud));
  parent.appendChild(racine);
  let derniereFraction = null;

  return {
    racine,
    nombre: total.ligne,
    mettreAJour(vue) {
      MODES.forEach((mode) => racine.classList.toggle(`bourse-${mode}`, vue.mode === mode));
      masquer(repos, vue.mode !== 'bourse');
      masquer(disque, vue.mode !== 'minuteur' && vue.mode !== 'pause');
      masquer(fin, vue.mode !== 'fin');
      masquer(perdues, vue.mode !== 'perdues');
      masquer(regarder, !vue.peutRegarder && vue.mode !== 'pause');
      masquer(pause, vue.mode !== 'minuteur');
      masquer(finir, vue.mode !== 'minuteur' && vue.mode !== 'pause');
      masquer(boutons, vue.mode === 'fin' || vue.mode === 'perdues' || (vue.mode === 'bourse' && !vue.peutRegarder));
      ecrire(total.nombre, vue.nombre);
      ecrire(total.unite, vue.unite);
      ecrire(restant.nombre, vue.nombre);
      ecrire(restant.unite, vue.unite);
      masquer(gagnees, vue.gagnees === null);
      ecrire(gagnees, vue.gagnees || '');
      const fraction = vue.fraction.toFixed(4);
      if (fraction !== derniereFraction) {
        derniereFraction = fraction;
        reste.setAttribute('d', secteur(vue.fraction, TAILLE / 2, TAILLE / 2, TAILLE / 2 - 4));
      }
    },
  };
}
