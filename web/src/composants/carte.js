// web/src/composants/carte.js
//
// Rôle    : la carte titrée commune à l'Accueil et à la page Aujourd'hui : une carte dont l'en-tête est l'intitulé en
//           capitales précédé de son icône (« COURSES · 2 », « MÉTÉO »...).
// Entrées : carteTitree(balise, classe, titre, nomIcone) : balise de la carte (article sur l'Accueil, section sur la
//           page Aujourd'hui), classes en plus de « carte », texte de l'intitulé, symbole de web/public/icones.svg.
// Sorties : { racine, titre } : la carte, et le span du texte de l'intitulé (l'Accueil y réécrit « Courses · 2 »).
// Pièges  : styles dans base.css (.carte, .intitule) et accueil.css (.carte-titre, .carte-icone) ; la carte n'est pas
//           insérée ici, l'écran la place où il veut.

import { element, icone } from '../dom.js';

export function carteTitree(balise, classe, titre, nomIcone) {
  const racine = element(balise, `carte ${classe}`);
  const entete = element('h2', 'intitule carte-titre');
  entete.appendChild(icone(nomIcone, 'carte-icone'));
  const texte = element('span', '', titre);
  entete.appendChild(texte);
  racine.appendChild(entete);
  return { racine, titre: texte };
}
