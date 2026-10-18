// serveur/ha/clims.js
//
// Rôle    : les climatisations (choix de Thomas du 16/10 : deux clims Bosch, intégration HACS « Bosch HomeCom », pilotées
//           en entier depuis une entrée « Clims » du menu, sans protection contre les enfants) : règles de la variable
//           CLIMS (rôles, domaines), projection des états de HA au strict nécessaire, source du flux « clims », et liste des
//           écritures permises (serveur/ha/actions-clim.js, sous le garde-fou ACTIONS_CLIM).
// Entrées : la configuration lue par config.js (lireClims) : [{ nom, entites: { climat, eco?, boost?, sommeil?, ioniseur?,
//           pas_sur_moi?, hors_gel? } }], vide par défaut ; états bruts de HA reçus par subscribeEntities.
// Sorties : ROLES (rôle -> domaine attendu), ROLES_OPTIONS (switch, dans l'ordre de l'écran), MODES, VENTILATIONS, SENS,
//           CLIMS_MAX, SERVICES_CLIM (domaine -> services permis, repris par verifierActions de actions.js) ;
//           projeterClims(etats, clims) -> [{ nom, disponible, mode, modes, temperature, consigne, ventilation, ventilations,
//           oscillation, options }] dans l'ordre de la configuration (mode : « off », une valeur de MODES ou null ; modes :
//           les MODES que la clim accepte, dans cet ordre ; temperature : celle de la pièce, au demi-degré, ou null ;
//           consigne : { valeur, min, max, pas } ou null ; ventilation : une valeur de VENTILATIONS ou null ; ventilations :
//           celles que la clim accepte, dans cet ordre ; oscillation : { verticale, horizontale }, chacune vrai, faux ou
//           null quand la clim ne l'a pas ; options : [{ cle, actif, modifiable }] pour les options configurées et
//           disponibles, dans l'ordre de ROLES_OPTIONS) ;
//           ecrituresClims(clims) -> [{ nom, role, service, entityId }] : chaque service permis sur chaque entité
//           configurée (climate : marche, arrêt, mode, consigne, ventilation, oscillations ; switch : marche, arrêt) ;
//           SourceClims(connexion, clims) : valeur (la projection courante, [] sans configuration) et événement 'maj' avec
//           la valeur complète quand elle change.
// Pièges  :
//   - Le nom affiché est celui de CLIMS, jamais le friendly_name de HA (« Climatisation Salon » : trop long pour l'écran).
//     Rien ne sort d'ici sous un entity_id, ni friendly_name, ni attribut brut autre que ceux recopiés ci-dessus.
//   - Valeurs du climate lues dans ses attributs (hvac_modes, fan_modes, swing_modes, swing_horizontal_modes, min_temp,
//     max_temp, target_temp_step, temperature, current_temperature) ; une valeur hors des listes connues (un autre modèle,
//     une autre intégration) est ignorée : jamais de bouton pour une valeur dont on ne connaît pas le sens.
//   - Oscillation : seulement si la clim propose exactement « on » et « off » dans ce sens (cas des Bosch du 16/10) ;
//     sinon null, et pas de bouton.
//   - Option (switch) : l'intégration Bosch dit dans writable_now si elle peut changer maintenant (constat du 16/10 :
//     false pour toutes, clim éteinte). modifiable vaut faux SEULEMENT si writable_now vaut exactement false : la page
//     grise alors le bouton, et actions-clim.js refuse (503). Un switch sans cet attribut reste modifiable.
//   - Consigne : null si la clim est indisponible, si la consigne n'est pas un nombre ou si les bornes ne sont pas des
//     nombres cohérents (min < max, pas > 0, pas de 1 par défaut quand HA ne le donne pas).
//   - Température de la pièce : capteur de la clim, rapporté par le cloud Bosch (constat du 16/10 : les deux clims à
//     22,5 °C, éteintes) ; arrondie au demi-degré, null si inconnue.
//   - Abonnement à la MÊME collection d'entités que SourceEntites (subscribeEntities de la bibliothèque la partage) :
//     aucune requête de plus vers HA, rien vers le cloud Bosch (c'est HA qui le relève).

import { EventEmitter } from 'node:events';
import { subscribeEntities } from 'home-assistant-js-websocket';

export const ROLES_OPTIONS = Object.freeze(['eco', 'boost', 'sommeil', 'ioniseur', 'pas_sur_moi', 'hors_gel']);
export const ROLES = Object.freeze({
  climat: 'climate',
  ...Object.fromEntries(ROLES_OPTIONS.map((role) => [role, 'switch'])),
});
export const MODES = Object.freeze(['cool', 'heat', 'auto', 'dry', 'fan_only']);
export const VENTILATIONS = Object.freeze(['auto', 'quiet', 'low', 'medium', 'high', 'turbo']);
export const SENS = Object.freeze({ verticale: 'swing_mode', horizontale: 'swing_horizontal_mode' });
export const CLIMS_MAX = 2;
const LISTES_SENS = { verticale: 'swing_modes', horizontale: 'swing_horizontal_modes' };
export const SERVICES_CLIM = Object.freeze({
  climate: ['turn_on', 'turn_off', 'set_hvac_mode', 'set_temperature', 'set_fan_mode', 'set_swing_mode', 'set_swing_horizontal_mode'],
  switch: ['turn_on', 'turn_off'],
});
const ETATS_ABSENTS = new Set(['unknown', 'unavailable', '']);
const PAS_PAR_DEFAUT = 1;

const disponible = (etat) => Boolean(etat) && etat.state !== 'unavailable';
const nombre = (valeur) => (typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null);
const liste = (valeur) => (Array.isArray(valeur) ? valeur : []);

function consigne(attributs) {
  const valeur = nombre(attributs.temperature);
  const min = nombre(attributs.min_temp);
  const max = nombre(attributs.max_temp);
  const pas = attributs.target_temp_step === undefined ? PAS_PAR_DEFAUT : nombre(attributs.target_temp_step);
  if (valeur === null || min === null || max === null || pas === null || min >= max || pas <= 0) return null;
  return { valeur, min, max, pas };
}

function temperature(attributs) {
  const valeur = nombre(attributs.current_temperature);
  return valeur === null ? null : Math.round(valeur * 2) / 2;
}

function oscillation(attributs) {
  return Object.fromEntries(Object.keys(SENS).map((sens) => {
    const valeurs = liste(attributs[LISTES_SENS[sens]]);
    const gere = valeurs.length === 2 && valeurs.includes('on') && valeurs.includes('off');
    const actuelle = attributs[SENS[sens]];
    return [sens, gere && (actuelle === 'on' || actuelle === 'off') ? actuelle === 'on' : null];
  }));
}

function option(etat) {
  if (!disponible(etat) || ETATS_ABSENTS.has(etat.state)) return null;
  if (etat.state !== 'on' && etat.state !== 'off') return null;
  return { actif: etat.state === 'on', modifiable: etat.attributes?.writable_now !== false };
}

function projeterClim(etats, { nom, entites }) {
  const climat = etats[entites.climat];
  const options = ROLES_OPTIONS
    .filter((role) => entites[role])
    .map((role) => ({ cle: role, ...option(etats[entites[role]]) }))
    .filter((entree) => entree.actif !== undefined);
  if (!disponible(climat)) {
    return {
      nom, disponible: false, mode: null, modes: [], temperature: null, consigne: null, ventilation: null, ventilations: [],
      oscillation: { verticale: null, horizontale: null }, options,
    };
  }
  const attributs = climat.attributes || {};
  const modes = MODES.filter((mode) => liste(attributs.hvac_modes).includes(mode));
  const ventilations = VENTILATIONS.filter((cle) => liste(attributs.fan_modes).includes(cle));
  return {
    nom,
    disponible: true,
    mode: climat.state === 'off' || modes.includes(climat.state) ? climat.state : null,
    modes,
    temperature: temperature(attributs),
    consigne: consigne(attributs),
    ventilation: ventilations.includes(attributs.fan_mode) ? attributs.fan_mode : null,
    ventilations,
    oscillation: oscillation(attributs),
    options,
  };
}

export function projeterClims(etats, clims) {
  return clims.map((clim) => projeterClim(etats, clim));
}

export function ecrituresClims(clims) {
  return clims.flatMap(({ nom, entites }) => Object.entries(entites).flatMap(([role, entityId]) => {
    const domaine = ROLES[role];
    return SERVICES_CLIM[domaine].map((action) => ({
      nom, role, service: `${domaine}.${action}`, entityId,
    }));
  }));
}

export class SourceClims extends EventEmitter {
  #clims;
  #valeur;
  #empreinte;

  constructor(connexion, clims = []) {
    super();
    this.#clims = clims;
    this.#valeur = projeterClims({}, clims);
    this.#empreinte = JSON.stringify(this.#valeur);
    if (clims.length > 0) connexion.once('connectee', (conn) => subscribeEntities(conn, (etats) => this.#recevoir(etats)));
  }

  get valeur() {
    return this.#valeur;
  }

  #recevoir(etats) {
    const valeur = projeterClims(etats, this.#clims);
    const empreinte = JSON.stringify(valeur);
    if (empreinte === this.#empreinte) return;
    this.#empreinte = empreinte;
    this.#valeur = valeur;
    this.emit('maj', valeur);
  }
}
