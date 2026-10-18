// web/src/ecrans/maison-entretien.js
//
// Rôle    : la section Entretien de l'écran Maison : en haut les trois cartes Draps (14/10, maison-draps.js), en bas les
//           deux encres de l'imprimante en barres (niveau écrit à côté, « à changer » sous 15 %) et les piles faibles
//           nommées (ou « Aucune pile faible »).
// Entrées : creerSectionEntretien(parent, { client, monotone }) ; mettreAJour(vue, draps, ms) avec vueEntretien de
//           maison-donnees.js, la valeur draps du flux et l'heure corrigée ; entretenir() à chaque seconde ; quitter().
// Sorties : { racine, mettreAJour(vue, draps, ms), entretenir(), quitter() }.
// Pièges  :
//   - Barre en transform: scaleX (seule propriété animable permise avec opacity) sur une piste pleine largeur ; le
//     niveau est toujours écrit en chiffres : la barre n'est qu'une aide.
//   - Place (834 px de section, mesurée sur capture) : les draps prennent la rangée du haut, encres et piles celle du
//     bas ; la carte des piles montre 5 lignes au plus (4 et « + N autres » au-delà) : 12 piles faibles à la fois
//     n'arrivent pas, et le détail de chaque capteur est aussi dans la vue Alarme.
//   - Liste des piles préconstruite : une mise à jour ne change que les textes et hidden.

import { ecrire, element, icone, masquer } from '../dom.js';
import { texteAutres } from '../format.js';
import { creerDraps } from './maison-draps.js';

const PILES_MAX = 5;

export function creerSectionEntretien(parent, { client, monotone }) {
  const racine = element('div', 'maison-section maison-entretien');
  const draps = creerDraps(racine, { client, monotone });
  const carteEncres = element('section', 'carte entretien-encres');
  carteEncres.appendChild(element('h2', 'intitule', 'Imprimante'));
  const encres = [0, 1].map(() => {
    const ligne = element('div', 'encre');
    const nom = element('span', 'encre-nom');
    const niveau = element('span', 'encre-niveau');
    const piste = element('span', 'encre-piste');
    const remplissage = element('span', 'encre-remplissage');
    piste.appendChild(remplissage);
    [nom, niveau, piste].forEach((noeud) => ligne.appendChild(noeud));
    carteEncres.appendChild(ligne);
    return {
      ligne, nom, niveau, remplissage,
    };
  });

  const cartePiles = element('section', 'carte entretien-piles');
  cartePiles.appendChild(element('h2', 'intitule', 'Piles des capteurs'));
  const aucune = element('p', 'piles-aucune');
  const liste = element('ul', 'piles');
  const piles = [];
  for (let i = 0; i < PILES_MAX; i += 1) {
    const item = element('li', 'pile');
    item.appendChild(icone('i-battery', 'pile-icone'));
    const nom = element('span', 'pile-nom');
    item.appendChild(nom);
    liste.appendChild(item);
    piles.push({ item, nom });
  }
  const autres = element('p', 'piles-autres');
  cartePiles.appendChild(aucune);
  cartePiles.appendChild(liste);
  cartePiles.appendChild(autres);
  racine.appendChild(carteEncres);
  racine.appendChild(cartePiles);
  parent.appendChild(racine);

  return {
    racine,
    entretenir: () => draps.entretenir(),
    quitter: () => draps.quitter(),
    mettreAJour(vue, etatDraps, ms) {
      draps.mettreAJour(etatDraps, ms);
      encres.forEach((n, i) => {
        const encre = vue.encres[i];
        ecrire(n.nom, encre.nom);
        ecrire(n.niveau, encre.alerte ? `${encre.texte} · à changer` : encre.texte);
        n.ligne.classList.toggle('encre-alerte', encre.alerte);
        const echelle = encre.niveau === null ? 0 : Math.max(0, Math.min(100, encre.niveau)) / 100;
        const transformation = `scaleX(${echelle})`;
        if (n.remplissage.style.transform !== transformation) n.remplissage.style.transform = transformation;
      });
      ecrire(aucune, vue.piles.length === 0 ? `Aucune pile faible (${vue.capteurs} capteurs suivis)` : `${vue.piles.length} pile${vue.piles.length > 1 ? 's' : ''} à changer`);
      aucune.classList.toggle('piles-alerte', vue.piles.length > 0);
      const montrees = vue.piles.length > PILES_MAX ? vue.piles.slice(0, PILES_MAX - 1) : vue.piles;
      piles.forEach((n, i) => {
        masquer(n.item, i >= montrees.length);
        if (i < montrees.length) ecrire(n.nom, montrees[i]);
      });
      masquer(autres, montrees.length === vue.piles.length);
      ecrire(autres, texteAutres(vue.piles.length - montrees.length));
    },
  };
}
