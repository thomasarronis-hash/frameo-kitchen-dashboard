// serveur/ha/entites.js
//
// Rôle    : LISTE BLANCHE des entités Home Assistant lisibles par le cadre, et projection de leurs états au
//           strict nécessaire (jamais de GPS, de jeton, d'image ni de numéro de téléphone).
// Entrées : états bruts reçus par subscribeEntities (toutes les entités de HA, personnes comprises) ;
//           calendriers, les entity_id calendar.* de AGENDA_CALENDRIERS (config.js), vide par défaut.
// Sorties : LISTE_BLANCHE (entity_id -> attributs autorisés), listeBlanche(calendriers) (la même, plus les
//           calendriers configurés), projeter(etats, liste) -> { entity_id: { state, last_changed, attributes } }
//           limité à la liste, verifierListeBlanche(liste) ;
//           SourceEntites(connexion, { calendriers }) : valeur (projection courante), recue (vrai dès le premier
//           état reçu de HA) et événement 'maj' avec les seules entités changées (null pour une entité disparue).
// Pièges  :
//   - subscribeEntities reçoit TOUT, y compris person.* et device_tracker.* avec latitude et longitude :
//     rien ne sort de ce module sans passer par projeter().
//   - Les attributs sont autorisés un par un, entité par entité : un attribut ajouté par une mise à jour
//     de HA ne sort pas tant qu'il n'est pas ajouté ici.
//   - camera.sonnette_derniere_photo : état seul. Son access_token change toutes les 5 min sans changer
//     la projection, donc sans maj inutile dans le flux.
//   - Au chargement, verifierListeBlanche() refuse toute entité ou tout attribut interdit (alarm_center,
//     select.alarm_center_guard_mode qui contournent le panneau à code, person.*, zone.*, Freebox...).
//   - Les 12 capteurs de pile et les 9 capteurs d'ouverture viennent de l'inventaire réel du 11/10 ;
//     outils/verif-ha.mjs signale ceux qui disparaîtraient. Ouvertures : état et last_changed seulement (la vue
//     des ouvertures de l'écran Maison, en lecture seule ; les noms affichés sont écrits dans la page). Elles
//     remontent en temps réel depuis le correctif du pont Eufy du 11/10.
//   - Alarme en LECTURE SEULE (décision de Thomas du 13/10 : le cadre n'arme ni ne désarme) : état seul, sans
//     code_format ni code_arm_required, et plus de counter.alarme_codes_faux (il ne servait qu'au clavier).
//   - Calendriers : nom seul (friendly_name). Leur état (on pendant un événement) sert de signal de relecture
//     à serveur/ha/agenda.js ; leurs autres attributs (message, description, location) ne sortent pas : les
//     événements passent par calendar.get_events, projetés sans description ni participants.

import { EventEmitter } from 'node:events';
import { subscribeEntities } from 'home-assistant-js-websocket';

const PILES = [
  'alarme_interieur', 'baie_vitree_centrale', 'baie_vitree_droit', 'baie_vitree_gauche', 'fenetre_cuisine', 'garage',
  'fenetre_chambre', 'porte_garage', 'porte_d_entree', 'porte_fenetre_bureau', 'salon', 'fenetre_salon',
];
const OUVERTURES = [
  'porte_d_entree', 'baie_vitree_gauche', 'baie_vitree_droit', 'baie_vitree_centrale', 'fenetre_salon',
  'fenetre_chambre', 'fenetre_cuisine', 'porte_garage', 'porte_fenetre_bureau',
];

export const LISTE_BLANCHE = Object.freeze({
  // Accueil et Météo : unités lues dans les attributs, crédit met.no affiché.
  'weather.forecast_maison': ['temperature', 'temperature_unit', 'wind_speed', 'wind_speed_unit', 'wind_bearing', 'precipitation_unit', 'attribution'],
  // Thème jour/soir : élévation du soleil seulement.
  'sun.sun': ['elevation'],
  // Alarme, en lecture seule : son état (vue Alarme de l'écran Maison, gros bouton de l'Accueil).
  'alarm_control_panel.alarme_maison': [],
  // Ouvertures : ouverte (on) ou fermée (off), et depuis quand (last_changed).
  ...Object.fromEntries(OUVERTURES.map((nom) => [`binary_sensor.${nom}_sensor_open`, []])),
  // Nombre d'articles à faire ; son changement déclenche la relecture des courses.
  'todo.shopping_list': [],
  // Bandeau sonnette : état et heure du coup de sonnette ; la photo passe par GET /api/sonnette.jpg.
  'binary_sensor.doorbell_ringing': [],
  'camera.sonnette_derniere_photo': [],
  // Entretien : encre et piles faibles (état seul : les noms affichés sont écrits dans la page, maison-donnees.js).
  'sensor.hp_deskjet_2800_series_black_ink': ['unit_of_measurement'],
  'sensor.hp_deskjet_2800_series_tri_color_ink': ['unit_of_measurement'],
  ...Object.fromEntries(PILES.map((nom) => [`binary_sensor.${nom}_battery_low`, []])),
  // Télécommandes : Apple TV (applis de source_list, état de la box et de son intégration) et télé TCL (état par
  // l'entité Android TV Remote, joignabilité par son remote).
  'media_player.sejour_sejour': ['source_list'],
  'media_player.smart_tv_pro_2_2': [],
  'remote.sejour_sejour': [],
  'remote.smart_tv_pro_2': [],
});

export const ENTITES_INTERDITES = [
  /^person\./, /^zone\./, /^device_tracker\./, /^sensor\.freebox_/,
  /^alarm_control_panel\.alarm_center$/, /^select\.alarm_center_guard_mode$/,
];
export const ATTRIBUTS_INTERDITS = ['latitude', 'longitude', 'gps_accuracy', 'access_token', 'entity_picture'];

export function verifierListeBlanche(liste) {
  for (const [entityId, attributs] of Object.entries(liste)) {
    if (ENTITES_INTERDITES.some((motif) => motif.test(entityId))) {
      throw new Error(`liste blanche : entité interdite ${entityId}`);
    }
    const interdit = attributs.find((nom) => ATTRIBUTS_INTERDITS.includes(nom));
    if (interdit) throw new Error(`liste blanche : attribut interdit ${interdit} sur ${entityId}`);
  }
}
verifierListeBlanche(LISTE_BLANCHE);

function projeterEntite(etat, attributsAutorises) {
  const attributes = {};
  for (const nom of attributsAutorises) {
    if (etat.attributes?.[nom] !== undefined) attributes[nom] = etat.attributes[nom];
  }
  return { state: etat.state, last_changed: etat.last_changed, attributes };
}

export function listeBlanche(calendriers = []) {
  const liste = { ...LISTE_BLANCHE };
  for (const entityId of calendriers) {
    if (!/^calendar\.[a-z0-9_]+$/.test(entityId)) throw new Error(`liste blanche : ${entityId} n'est pas un calendrier`);
    liste[entityId] = ['friendly_name'];
  }
  verifierListeBlanche(liste);
  return Object.freeze(liste);
}

export function projeter(etats, liste = LISTE_BLANCHE) {
  const projection = {};
  for (const [entityId, attributsAutorises] of Object.entries(liste)) {
    if (etats[entityId]) projection[entityId] = projeterEntite(etats[entityId], attributsAutorises);
  }
  return projection;
}

export class SourceEntites extends EventEmitter {
  #liste;
  #valeur = {};
  #recue = false;
  #empreintes = new Map();

  constructor(connexion, { calendriers = [] } = {}) {
    super();
    this.#liste = listeBlanche(calendriers);
    connexion.once('connectee', (conn) => subscribeEntities(conn, (etats) => this.#recevoir(etats)));
  }

  get valeur() {
    return this.#valeur;
  }

  get recue() {
    return this.#recue;
  }

  #recevoir(etats) {
    this.#recue = true;
    const projection = projeter(etats, this.#liste);
    const fragment = {};
    for (const [entityId, projete] of Object.entries(projection)) {
      const empreinte = JSON.stringify(projete);
      if (this.#empreintes.get(entityId) !== empreinte) {
        this.#empreintes.set(entityId, empreinte);
        fragment[entityId] = projete;
      }
    }
    for (const entityId of this.#empreintes.keys()) {
      if (!(entityId in projection)) {
        this.#empreintes.delete(entityId);
        fragment[entityId] = null;
      }
    }
    this.#valeur = projection;
    if (Object.keys(fragment).length > 0) this.emit('maj', fragment);
  }
}
