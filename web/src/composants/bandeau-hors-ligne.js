// web/src/composants/bandeau-hors-ligne.js
//
// Rôle    : le bandeau « hors ligne », en bas de l'écran (place décrite dans web/styles/bandeau.css), quand le
//           flux du serveur est muet depuis plus de 45 s : ce qui est affiché date d'avant la coupure, et la
//           page le dit.
// Entrées : le conteneur (#bandeau de index.html) ; mettreAJour({ enLigne, silenceMs, surAccueil }) à chaque
//           seconde (surAccueil : l'Accueil est l'écran affiché).
// Sorties : creerBandeauHorsLigne(conteneur) -> { mettreAJour(etat) } ; texteHorsLigne(etat) -> texte ou
//           null, sans DOM (testable).
// Pièges  :
//   - Le seuil de 45 s est décidé par api.js (SILENCE_MAX_MS) et arrive ici déjà tranché dans enLigne.
//   - Sur l'Accueil seulement : sa place est celle des boutons Alarme, Wi-Fi invités et Télé, qui ne peuvent
//     rien sans le serveur. Ailleurs, le pied du menu dit « hors ligne depuis N min », et l'écran Courses le
//     dit à côté de ses boutons ; Repas et Recette marchent hors ligne (le menu est déjà reçu).
//   - Masqué par base.css pendant la nuit (seule l'horloge reste) ; il revient au premier toucher.
//   - Pas d'animation : il apparaît et disparaît d'un coup, une seule fois par coupure.
//   - Appelé à chaque seconde : il ne touche au DOM que si quelque chose change (masquer et ecrire de
//     dom.js), sinon chaque tick provoquerait un recalcul de style, jour et nuit.

import { ecrire, masquer } from '../dom.js';
import { texteDuree } from '../heure.js';

export function texteHorsLigne({ enLigne, silenceMs }) {
  return enLigne ? null : `Hors ligne depuis ${texteDuree(silenceMs)} : les informations affichées ne sont plus à jour`;
}

export function creerBandeauHorsLigne(conteneur) {
  return {
    mettreAJour(etat) {
      const message = etat.surAccueil ? texteHorsLigne(etat) : null;
      masquer(conteneur, message === null);
      if (message !== null) ecrire(conteneur, message);
    },
  };
}
