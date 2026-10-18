// web/src/ecrans/photos-donnees.js
//
// Rôle    : calculer, sans DOM, ce que l'écran Photos affiche : les pastilles du mode ambiant (horloge et date, météo,
//           « Ce soir » et minuteur en cours).
// Entrées : donnees (etat.js : entites, pluie, menu), ms (heure corrigée par le serveur) ; la vue de la pastille des
//           minuteurs (vuePastille de minuteurs.js, null sans minuteur).
// Sorties : vuePhotos(donnees, ms) -> { heure, date, meteo: { temperature, picto, libelle } | null, soir: { intitule,
//           titre } | null } ; ligneMinuteur(vue) -> { temps, libelle } | null.
// Pièges  :
//   - Les mêmes calculs que l'Accueil (vueMeteo de accueil-donnees.js, repasAffiche de repas-donnees.js) : « Ce midi »
//     le week-end avant 14h, rien sans menu publié (la pastille ne dit pas « Menu pas encore publié » par-dessus une
//     photo : elle se tait).
//   - Le minuteur affiché est le plus proche, comme la pastille des minuteurs (cachée en mode Photos) ; « +2 » s'il
//     en tourne d'autres. Un minuteur qui sonne a son alerte plein écran par-dessus le mode Photos.
//   - Plus de face « page » ni de message depuis le 14/10 : l'écran n'est plus au menu (menu.js), on n'y entre
//     qu'automatiquement, photos prêtes, de jour et en ligne (pilotage.js). Sans clé Immich, la marche à suivre est dans
//     le README, « Photos ».

import { texteDate, texteHeure } from '../heure.js';
import { vueMeteo } from './accueil-donnees.js';
import { repasAffiche } from './repas-donnees.js';

export function vuePhotos(donnees, ms) {
  const repas = repasAffiche(donnees.menu, ms);
  return {
    heure: texteHeure(ms),
    date: texteDate(ms),
    meteo: vueMeteo(donnees.entites, donnees.pluie, ms),
    soir: repas.titre === null ? null : { intitule: repas.intitule, titre: repas.titre },
  };
}

export function ligneMinuteur(vue) {
  if (!vue) return null;
  return { temps: vue.temps, libelle: vue.autres ? `${vue.libelle} ${vue.autres}` : vue.libelle };
}
