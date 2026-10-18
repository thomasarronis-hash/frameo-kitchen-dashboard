// web/src/ecrans/clims.js
//
// Rôle    : l'écran Clims (9e entrée du menu, choix de Thomas du 16/10) : un panneau de commande par clim (clims-panneau.js),
//           côte à côte s'il y en a deux ; en tête, « Mode essai : rien n'est envoyé » tant que le serveur simule les
//           commandes des clims. Sans clim configurée : « Clims pas encore reliées ».
// Entrées : creerClims(conteneur, { client, monotone }) : client (api.js : poster), horloge monotone (performance.now) ;
//           mettreAJour(vue) avec la vue de clims-donnees.js (vueClims) ; entretenir() à chaque seconde (main.js).
// Sorties : { racine, mettreAJour(vue), entretenir() }.
// Pièges  :
//   - Aucune protection contre les enfants (choix de Thomas, comme la Mégane) ; l'écran revient à l'Accueil après 60 s
//     sans toucher, comme les autres.
//   - Vue préconstruite (CARTES_MAX panneaux) : une mise à jour ne change que textes, classes, hidden et disabled.
//   - « Mode essai » : seulement si l'instantané dit simulation_clim: true (serveur sans ACTIONS_CLIM=1) ; l'en-tête garde
//     sa hauteur dans les deux cas.
//   - « Clims pas encore reliées » : une phrase pour la famille ; ce que Thomas doit faire est dans le README (« Clims »).

import { element, icone, masquer } from '../dom.js';
import { CARTES_MAX } from './clims-donnees.js';
import { creerPanneauClim } from './clims-panneau.js';

export function creerClims(conteneur, { client, monotone }) {
  const racine = element('section', 'ecran-page clims');
  const entete = element('header', 'page-entete clims-entete');
  entete.appendChild(element('h2', 'intitule', 'Clims'));
  const essai = element('p', 'clims-essai');
  essai.appendChild(icone('i-alert', 'clims-essai-icone'));
  essai.appendChild(element('span', '', 'Mode essai : rien n\'est envoyé'));
  essai.hidden = true;
  entete.appendChild(essai);
  const liste = element('div', 'clims-liste');
  const envoyer = (chemin, corps) => client.poster(chemin, corps);
  const panneaux = [];
  for (let i = 0; i < CARTES_MAX; i += 1) panneaux.push(creerPanneauClim(liste, { envoyer, monotone }));
  const vide = element('div', 'page-vide clims-vide');
  vide.appendChild(icone('i-clim', 'clims-vide-icone'));
  vide.appendChild(element('p', 'page-vide-titre', 'Clims pas encore reliées'));
  racine.appendChild(entete);
  racine.appendChild(liste);
  racine.appendChild(vide);
  conteneur.appendChild(racine);

  return {
    racine,
    mettreAJour(vue) {
      masquer(vide, vue.etat !== 'vide');
      masquer(liste, vue.etat !== 'ok');
      masquer(essai, !vue.essai);
      liste.classList.toggle('clims-deux', vue.cartes.length > 1);
      panneaux.forEach((panneau, i) => {
        const carte = vue.cartes[i];
        masquer(panneau.racine, !carte);
        if (carte) panneau.mettreAJour(carte);
      });
    },
    entretenir() {
      panneaux.forEach((panneau) => panneau.entretenir());
    },
  };
}
