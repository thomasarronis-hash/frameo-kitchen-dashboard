// serveur/garde-fous.js
//
// Rôle    : câbler les QUATRE garde-fous d'écriture d'après la configuration, en un seul endroit testé : ACTIONS_REELLES
//           (les 4 actions courses_*), ACTIONS_MAISON (télécommandes, direct de la sonnette), ACTIONS_VOITURE (commandes
//           de la voiture) et ACTIONS_CLIM (commandes des clims), chacun branché sur SON drapeau, dans la connexion HA
//           (dernier verrou) comme dans les tables d'actions (simulation).
// Entrées : creerConnexion(config, journal) : config de config.js (haUrl, haJeton, actionsReelles, actionsMaison,
//           actionsVoiture, voitures, actionsClim, clims) ; creerEcritures(config, { connexion, entites, courses, voitures,
//           clims, journal }) : la connexion, SourceEntites (applis de l'Apple TV), SourceCourses (copie locale en
//           simulation), SourceVoitures (commandes disponibles, bornes des niveaux), SourceClims (ce que chaque clim
//           accepte) et le journal.
// Sorties : creerConnexion -> ConnexionHA ; creerEcritures -> { actions, actionsMaison, actionsVoiture, actionsClim }
//           (serveur/ha/actions.js, actions-maison.js, actions-voiture.js et actions-clim.js).
// Pièges  :
//   - C'est ici qu'un croisement des drapeaux rendrait réelles les actions maison ou celles de la voiture avec le seul
//     ACTIONS_REELLES=1, déjà posé sur le M900 : tests/garde-fous.test.js le prouve dans tous les sens, en partant de
//     chargerConfig.
//   - Les couples d'écriture de la voiture donnés à la connexion viennent de VOITURES (ecrituresVoitures de
//     ha/voitures.js) : seules les entités des rôles de commande, chacune avec son service (button.press,
//     number.set_value) ; ceux des clims viennent de CLIMS (ecrituresClims de ha/clims.js : services climate et switch
//     des clims sur leurs seules entités).
//   - HA_DEMO=1 (config.haDemo) : la connexion se branche sur le faux Home Assistant de sources/ha-demo.js au lieu du
//     vrai ; config.js a déjà refusé tout garde-fou à 1 dans ce cas.
//   - Aucun appel réseau à la création : la connexion ne se fait qu'à connexion.demarrer() (index.js).

import { creerActions } from './ha/actions.js';
import { creerActionsClim } from './ha/actions-clim.js';
import { creerActionsMaison } from './ha/actions-maison.js';
import { creerActionsVoiture } from './ha/actions-voiture.js';
import { ecrituresClims } from './ha/clims.js';
import { ConnexionHA } from './ha/connexion.js';
import { ecrituresVoitures } from './ha/voitures.js';
import { connecterDemo } from './sources/ha-demo.js';

export function creerConnexion(config, journal) {
  return new ConnexionHA({
    url: config.haUrl,
    jeton: config.haJeton,
    journal,
    actionsReelles: config.actionsReelles,
    actionsMaison: config.actionsMaison,
    actionsVoiture: config.actionsVoiture,
    ecrituresVoiture: ecrituresVoitures(config.voitures).map(({ service, entityId }) => `${service} ${entityId}`),
    actionsClim: config.actionsClim,
    ecrituresClim: ecrituresClims(config.clims).map(({ service, entityId }) => `${service} ${entityId}`),
    ...(config.haDemo ? { connecter: connecterDemo } : {}),
  });
}

export function creerEcritures(config, {
  connexion, entites, courses, voitures, clims, journal,
}) {
  return {
    actions: creerActions({
      connexion, courses, reelles: config.actionsReelles, journal: journal('actions'),
    }),
    actionsMaison: creerActionsMaison({
      connexion, entites, reelles: config.actionsMaison, journal: journal('maison'),
    }),
    actionsVoiture: creerActionsVoiture({
      connexion, voitures: config.voitures, source: voitures, reelles: config.actionsVoiture, journal: journal('voitures'),
    }),
    actionsClim: creerActionsClim({
      connexion, clims: config.clims, source: clims, reelles: config.actionsClim, journal: journal('clims'),
    }),
  };
}
