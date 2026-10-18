// web/src/composants/rendez-vous.js
//
// Rôle    : montrer qui a rendez-vous : la pastille d'une personne (sa couleur, son initiale), et une ligne de
//           rendez-vous au fil du texte (pour chacun sa pastille puis son texte, séparés par « · », puis « +N »
//           pour ceux qui ne sont pas montrés). La ligne sert à la colonne « La semaine » de l'Accueil et à la ligne
//           « Journée » de la page Aujourd'hui, la pastille seule à l'écran Agenda et à la page Aujourd'hui.
// Entrées : creerPastille(classe) ; majPastille(noeud, { couleur, initiale, personne }) avec les valeurs de
//           agenda-donnees.js ; creerLigneRendezVous(parent, { nombre, classe }) puis mettreAJour({ evenements:
//           [{ texte, couleur, initiale, personne }], plus }) (plus : nombre de rendez-vous non montrés).
// Sorties : creerPastille -> span ; creerLigneRendezVous -> { racine, mettreAJour(contenu) }.
// Pièges  :
//   - Vue préconstruite (nombre rendez-vous au plus) : une mise à jour ne change que textes, classes et hidden,
//     et seulement ce qui change (dom.js).
//   - La classe de couleur (personne-1 à 4, rendez-vous.css) est posée avec la classe de base : jamais une
//     couleur seule pour dire qui, l'initiale est dans la pastille et le prénom dans son aria-label.
//   - « +N » est masqué quand N vaut 0 ; un contenu null masque toute la ligne.

import { ecrire, element, etiqueter, masquer } from '../dom.js';

export function creerPastille(classe) {
  return element('span', classe ? `pastille-personne ${classe}` : 'pastille-personne');
}

export function majPastille(noeud, { couleur, initiale, personne }) {
  const base = noeud.className.split(' ').filter((nom) => nom.indexOf('personne-') !== 0).join(' ');
  const classe = `${base} personne-${couleur}`;
  if (noeud.className !== classe) noeud.className = classe;
  ecrire(noeud, initiale);
  etiqueter(noeud, personne);
}

export function creerLigneRendezVous(parent, { nombre, classe }) {
  const racine = element('div', classe ? `rdv-ligne ${classe}` : 'rdv-ligne');
  const liste = element('span', 'rdv-liste');
  const items = [];
  for (let i = 0; i < nombre; i += 1) {
    const item = element('span', 'rdv');
    const pastille = creerPastille();
    const texte = element('span', 'rdv-texte');
    item.appendChild(pastille);
    item.appendChild(texte);
    liste.appendChild(item);
    items.push({ item, pastille, texte });
  }
  const plus = element('span', 'rdv-plus');
  racine.appendChild(liste);
  racine.appendChild(plus);
  parent.appendChild(racine);
  return {
    racine,
    mettreAJour(contenu) {
      masquer(racine, !contenu);
      if (!contenu) return;
      items.forEach((noeuds, i) => {
        const evenement = contenu.evenements[i];
        masquer(noeuds.item, !evenement);
        if (!evenement) return;
        majPastille(noeuds.pastille, evenement);
        ecrire(noeuds.texte, evenement.texte);
      });
      masquer(plus, contenu.plus === 0);
      ecrire(plus, `+${contenu.plus}`);
    },
  };
}
