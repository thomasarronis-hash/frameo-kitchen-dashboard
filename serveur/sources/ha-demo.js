// serveur/sources/ha-demo.js
//
// Rôle    : faux Home Assistant de démonstration (HA_DEMO=1, développement seulement) : une fausse Connection de
//           home-assistant-js-websocket, branchée à la place de la vraie par ConnexionHA (option connecter), pour voir
//           tout le tableau de bord sans maison : alarme et ouvertures, courses, agenda, météo horaire, sonnette,
//           télécommandes, deux clims, une voiture.
// Entrées : tests/fixtures/ha_states.json (états anonymisés), tests/fixtures/ha-meteo-horaire.json et
//           tests/fixtures/ha-calendrier-evenements.json, plus quelques états fabriqués ici (calendriers, clims, voiture).
// Sorties : connecterDemo() -> une fausse Connection (subscribeMessage pour subscribe_entities, sendMessagePromise pour
//           les lectures call_service, ping) ; decalerDates(texte, jours) et decalageSemaines(aujourdhui), qui recalent les
//           fixtures sur la semaine en cours (servent aussi à outils/demo.mjs pour le menu) ;
//           CALENDRIERS_DEMO, VOITURES_DEMO, CLIMS_DEMO : les valeurs des variables à poser avec HA_DEMO=1.
// Pièges  :
//   - Les fixtures datent de la semaine du 10/10/2026 : elles sont décalées d'un nombre ENTIER de semaines (un menu
//     commence un samedi, un rendez-vous garde son jour de la semaine de l'agenda, du lundi au dimanche). La météo
//     horaire repart de l'heure en cours.
//   - Aucune écriture n'aboutit : avec HA_DEMO=1, config.js refuse les ACTIONS_* à 1 (tout reste « Mode essai »).
//   - Les états anonymisés gardent leurs dates d'origine (« ouvert depuis 14 jours ») : c'est voulu, rien n'en dépend.

import { readFileSync } from 'node:fs';
import { dateParis } from '../heure-paris.js';

const FIXTURES = new URL('../../tests/fixtures/', import.meta.url);
const SAMEDI_DES_FIXTURES = '2026-10-10';
const LUNDI_DES_FIXTURES = '2026-10-12';
const JOUR_MS = 86_400_000;
const HEURE_MS = 3_600_000;

export const CALENDRIERS_DEMO = 'calendar.famille=Camille,calendar.ecole=Sacha';
export const VOITURES_DEMO = 'Voiture: batterie=sensor.voiture_batterie, branchee=binary_sensor.voiture_prise, '
  + 'autonomie=sensor.voiture_autonomie, charge=sensor.voiture_charge, charger=button.voiture_charger, '
  + 'clim=button.voiture_clim, charge_cible=number.voiture_charge_cible';
export const CLIMS_DEMO = 'Salon: climat=climate.clim_salon, eco=switch.clim_salon_eco, boost=switch.clim_salon_boost ; '
  + 'Chambre: climat=climate.clim_chambre';

const lireFixture = (nom) => readFileSync(new URL(nom, FIXTURES), 'utf8');
const versMs = (jour) => Date.parse(`${jour}T00:00:00Z`);

// Jours à ajouter aux fixtures pour que leur semaine soit celle d'aujourd'hui : du samedi au vendredi pour le menu (par
// défaut), du lundi au dimanche pour l'agenda (debutSemaine = LUNDI_DES_FIXTURES), comme sa grille.
export function decalageSemaines(aujourdhui, debutSemaine = SAMEDI_DES_FIXTURES) {
  return Math.floor((versMs(aujourdhui) - versMs(debutSemaine)) / (7 * JOUR_MS)) * 7;
}

// Décale de « jours » chaque date AAAA-MM-JJ du texte (suivie de T, d'un guillemet ou d'un tiret de créneau).
export function decalerDates(texte, jours) {
  return texte.replace(/\b(\d{4}-\d{2}-\d{2})(?=[T"-])/g, (jour) => new Date(versMs(jour) + jours * JOUR_MS).toISOString().slice(0, 10));
}

const climat = (state, attributs) => ({
  state,
  attributes: {
    hvac_modes: ['off', 'cool', 'heat', 'auto', 'dry', 'fan_only'],
    min_temp: 16,
    max_temp: 30,
    target_temp_step: 1,
    fan_modes: ['quiet', 'low', 'medium', 'high', 'turbo', 'auto'],
    swing_modes: ['off', 'on'],
    swing_horizontal_modes: ['off', 'on'],
    swing_mode: 'off',
    swing_horizontal_mode: 'on',
    ...attributs,
  },
});
const interrupteur = (state) => ({ state, attributes: { writable_now: true } });

function etatsFabriques(maintenant) {
  return {
    'calendar.famille': { state: 'off', attributes: { friendly_name: 'Famille' } },
    'calendar.ecole': { state: 'off', attributes: { friendly_name: 'École' } },
    'climate.clim_salon': climat('heat', { current_temperature: 19.5, temperature: 21, fan_mode: 'auto' }),
    'switch.clim_salon_eco': interrupteur('on'),
    'switch.clim_salon_boost': interrupteur('off'),
    'climate.clim_chambre': climat('off', { current_temperature: 18, temperature: 19, fan_mode: 'quiet' }),
    'sensor.voiture_batterie': { state: '62', attributes: { unit_of_measurement: '%' } },
    'binary_sensor.voiture_prise': { state: 'on', attributes: {} },
    'sensor.voiture_autonomie': { state: '241', attributes: { unit_of_measurement: 'km' } },
    'sensor.voiture_charge': { state: 'waiting_for_a_planned_charge', attributes: {} },
    'button.voiture_charger': { state: 'unknown', attributes: {} },
    'button.voiture_clim': { state: 'unknown', attributes: {} },
    'number.voiture_charge_cible': { state: '80', attributes: { min: 50, max: 100, step: 5 } },
    'binary_sensor.doorbell_ringing': { state: 'off', attributes: {}, last_changed: new Date(maintenant - 2 * HEURE_MS).toISOString() },
  };
}

// Tous les états au format compressé de subscribe_entities : { entity_id: { s, a, c, lc } }.
function etatsCompresses(maintenant) {
  const etats = Object.fromEntries(JSON.parse(lireFixture('ha_states.json')).map((etat) => [etat.entity_id, etat]));
  const tous = { ...etats, ...etatsFabriques(maintenant) };
  return Object.fromEntries(Object.entries(tous).map(([entityId, etat]) => [entityId, {
    s: etat.state,
    a: etat.attributes,
    c: `demo-${entityId}`,
    lc: Date.parse(etat.last_changed || new Date(maintenant - JOUR_MS).toISOString()) / 1000,
  }]));
}

const ARTICLES = ['Lait', 'Pain de mie', 'Pommes', 'Café', 'Yaourts nature', 'Papier toilette'];

function evenements(entityId, decalage) {
  const { events } = JSON.parse(decalerDates(lireFixture('ha-calendrier-evenements.json'), decalage));
  // Les rendez-vous de la fixture se partagent entre les deux calendriers, un sur deux.
  return events.filter((_evenement, i) => (entityId === 'calendar.famille' ? i % 2 === 0 : i % 2 === 1));
}

function previsions(maintenant) {
  const { horaire } = JSON.parse(lireFixture('ha-meteo-horaire.json'));
  const debut = Math.floor(maintenant / HEURE_MS) * HEURE_MS;
  return horaire.map((prevision, i) => ({ ...prevision, datetime: new Date(debut + i * HEURE_MS).toISOString() }));
}

function repondre({ domain, service, target }, maintenant) {
  const entityId = target?.entity_id;
  const decalage = decalageSemaines(dateParis(new Date(maintenant)), LUNDI_DES_FIXTURES);
  if (`${domain}.${service}` === 'weather.get_forecasts') return { [entityId]: { forecast: previsions(maintenant) } };
  if (`${domain}.${service}` === 'todo.get_items') {
    return { [entityId]: { items: ARTICLES.map((summary, i) => ({ uid: `demo-${i}`, summary, status: i < 4 ? 'needs_action' : 'completed' })) } };
  }
  if (`${domain}.${service}` === 'calendar.get_events') return { [entityId]: { events: evenements(entityId, decalage) } };
  throw new Error(`démo : ${domain}.${service} n'existe pas dans le faux Home Assistant`);
}

export async function connecterDemo() {
  return {
    haVersion: '2026.10.0 (démo)',
    addEventListener() {},
    close() {},
    reconnect() {},
    ping: async () => {},
    async subscribeMessage(rappel, message) {
      if (message.type === 'subscribe_entities') setImmediate(() => rappel({ a: etatsCompresses(Date.now()) }));
      return async () => {};
    },
    async sendMessagePromise(message) {
      if (message.type !== 'call_service') throw new Error(`démo : message ${message.type} non pris en charge`);
      return { response: repondre(message, Date.now()) };
    },
  };
}
