// serveur/ha/voitures.js
//
// Rôle    : les voitures électriques (choix de Thomas du 14/10 : une Renault Mégane, intégration Renault de HA) : règles de
//           la variable VOITURES (rôles, domaines, entités interdites), projection des états de HA au strict nécessaire,
//           source du flux « voitures », et liste des écritures permises (commandes de la Mégane, décision de Thomas du
//           14/10 : serveur/ha/actions-voiture.js, sous le garde-fou ACTIONS_VOITURE).
// Entrées : la configuration lue par config.js (lireVoitures) : [{ nom, entites: { batterie, branchee, autonomie?, charge?,
//           activite?, restant?, charger?, clim?, phares?, klaxon?, charge_min?, charge_cible? } }], vide par défaut ;
//           états bruts de HA reçus par subscribeEntities.
// Sorties : ROLES (rôle -> domaine attendu), ROLES_REQUIS, ROLES_COMMANDES (button), ROLES_NIVEAUX (number), VOITURES_MAX,
//           MOTS_INTERDITS, ETATS_CHARGE ;
//           projeterVoitures(etats, voitures) -> [{ nom, batterie, autonomie: { valeur, unite } | null, branchee, charge,
//           vu_le, fin_charge, commandes, niveaux }] dans l'ordre de la configuration (batterie : entier de 0 à 100 ou null ;
//           branchee : vrai, faux ou null ; charge : une valeur de ETATS_CHARGE, « autre » ou null ; vu_le et fin_charge :
//           ISO 8601 ou null ; commandes : les rôles de ROLES_COMMANDES configurés et disponibles, dans cet ordre ;
//           niveaux : { charge_min, charge_cible }, chacun { valeur, min, max, pas } ou null) ;
//           ecrituresVoitures(voitures) -> [{ nom, role, service, entityId }] : chaque commande et chaque niveau configurés,
//           avec son service (button.press, number.set_value) ;
//           SourceVoitures(connexion, voitures) : valeur (la projection courante, [] sans configuration) et événement 'maj'
//           avec la valeur complète quand elle change.
// Pièges  :
//   - Le nom affiché est celui de VOITURES, JAMAIS le friendly_name : l'appareil Renault porte le nom de la plaque
//     d'immatriculation, et ses entity_id aussi (sensor.<plaque>_batterie) tant que Thomas ne les renomme pas. Rien ne
//     sort d'ici sous un entity_id : ni l'identifiant, ni friendly_name, ni aucun attribut autre que l'unité de
//     l'autonomie et du temps restant (lue pour le calcul, jamais recopiée telle quelle) et les bornes min, max et step
//     des deux niveaux de charge (recopiées sous min, max, pas, avec l'état sous valeur ; ni mode, ni unité, ni rien
//     d'autre).
//   - Domaines permis, chacun au rôle qui l'attend (ROLES) : sensor et binary_sensor pour la lecture, button pour les 4
//     commandes (charger, clim, phares, klaxon), number pour les 2 niveaux de charge. Jamais device_tracker (position) ni
//     select (mode de charge) : aucun rôle ne les prend. Les entity_id qui parlent de position ou de kilométrage
//     (MOTS_INTERDITS) sont refusés aussi, au démarrage.
//   - Commande disponible : entité présente et pas « unavailable ». L'état d'un bouton est « unknown » ou l'heure du
//     dernier appui : les deux comptent comme disponibles, et un nouvel appui ne change pas la projection (pas de maj).
//   - Niveau : null si l'entité manque, est indisponible, si son état n'est pas un nombre, ou si ses bornes ne sont pas
//     des nombres cohérents (min < max, step > 0) : la page n'affiche alors pas le réglage, et actions-voiture.js refuse
//     d'envoyer une valeur (503) faute de bornes.
//   - Abonnement à la MÊME collection d'entités que SourceEntites (subscribeEntities de la bibliothèque la partage sur
//     la connexion) : aucune requête de plus vers HA, et rien vers les serveurs Renault (c'est HA qui les relève).
//   - La donnée Renault est la dernière que la voiture a envoyée, pas une mesure en direct : vu_le vient du capteur
//     « Dernière activité de la batterie » (désactivé par défaut dans HA, à activer), la page grise la carte au-delà de
//     6 h. Sans ce capteur, vu_le vaut null et la carte n'est jamais grisée.
//   - fin_charge : seulement pendant une charge (charge_in_progress) et avec le temps restant ; il se compte depuis
//     l'heure de la donnée (vu_le, même relevé Renault que la batterie), à défaut depuis le dernier changement du
//     capteur du temps restant. Unité lue dans l'attribut (min, h ou s) ; une autre unité : pas d'heure de fin.
//   - États unknown et unavailable (intégration absente, panne des serveurs Renault, quota dépassé) : null, jamais
//     une valeur inventée. Une valeur d'état de charge inconnue de cette liste (v2l_connected, v2g_...) : « autre ».

import { EventEmitter } from 'node:events';
import { subscribeEntities } from 'home-assistant-js-websocket';

export const ROLES = Object.freeze({
  batterie: 'sensor',
  branchee: 'binary_sensor',
  autonomie: 'sensor',
  charge: 'sensor',
  activite: 'sensor',
  restant: 'sensor',
  charger: 'button',
  clim: 'button',
  phares: 'button',
  klaxon: 'button',
  charge_min: 'number',
  charge_cible: 'number',
});
export const ROLES_REQUIS = Object.freeze(['batterie', 'branchee']);
export const ROLES_COMMANDES = Object.freeze(['charger', 'clim', 'phares', 'klaxon']);
export const ROLES_NIVEAUX = Object.freeze(['charge_min', 'charge_cible']);
const SERVICE_ECRITURE = Object.freeze({ button: 'button.press', number: 'number.set_value' });
export const VOITURES_MAX = 2;
export const MOTS_INTERDITS = /(kilometrage|mileage|odometre|odometer|location|localisation|position|gps|latitude|longitude|tracker)/;
// Valeurs de l'état de charge de l'intégration Renault (capteur charge_state, enum).
export const ETATS_CHARGE = Object.freeze([
  'not_in_charge', 'waiting_for_a_planned_charge', 'charge_ended', 'waiting_for_current_charge', 'energy_flap_opened',
  'charge_in_progress', 'charge_error',
]);
const MINUTES_PAR_UNITE = { min: 1, h: 60, s: 1 / 60 };
const ETATS_ABSENTS = new Set(['unknown', 'unavailable', '']);
const LONGUEUR_UNITE_MAX = 8;

const etatDe = (etats, entityId) => (entityId ? etats[entityId] : undefined);

function nombre(etat) {
  if (!etat || ETATS_ABSENTS.has(etat.state)) return null;
  const valeur = Number(etat.state);
  return Number.isFinite(valeur) ? valeur : null;
}

function batterie(etat) {
  const valeur = nombre(etat);
  return valeur === null || valeur < 0 || valeur > 100 ? null : Math.round(valeur);
}

function autonomie(etat) {
  const valeur = nombre(etat);
  const unite = etat?.attributes?.unit_of_measurement;
  if (valeur === null || valeur < 0 || typeof unite !== 'string' || unite === '' || unite.length > LONGUEUR_UNITE_MAX) return null;
  return { valeur: Math.round(valeur), unite };
}

function branchee(etat) {
  if (etat?.state === 'on') return true;
  if (etat?.state === 'off') return false;
  return null;
}

function charge(etat) {
  if (!etat || ETATS_ABSENTS.has(etat.state)) return null;
  return ETATS_CHARGE.includes(etat.state) ? etat.state : 'autre';
}

function instant(texte) {
  const ms = typeof texte === 'string' ? Date.parse(texte) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function finCharge(etatCharge, etatRestant, vuLe) {
  if (etatCharge !== 'charge_in_progress') return null;
  const valeur = nombre(etatRestant);
  const parUnite = MINUTES_PAR_UNITE[etatRestant?.attributes?.unit_of_measurement];
  const depart = vuLe ?? instant(etatRestant?.last_changed);
  if (valeur === null || valeur < 0 || parUnite === undefined || depart === null) return null;
  return new Date(depart + valeur * parUnite * 60_000).toISOString();
}

const disponible = (etat) => Boolean(etat) && etat.state !== 'unavailable';

function niveau(etat) {
  if (!disponible(etat)) return null;
  const valeur = nombre(etat);
  const { min, max, step } = etat.attributes || {};
  if (valeur === null || ![min, max, step].every(Number.isFinite) || min >= max || step <= 0) return null;
  return { valeur, min, max, pas: step };
}

function projeterVoiture(etats, { nom, entites }) {
  const lire = (role) => etatDe(etats, entites[role]);
  const activite = lire('activite');
  const vuLe = activite && !ETATS_ABSENTS.has(activite.state) ? instant(activite.state) : null;
  const etatCharge = charge(lire('charge'));
  return {
    nom,
    batterie: batterie(lire('batterie')),
    autonomie: autonomie(lire('autonomie')),
    branchee: branchee(lire('branchee')),
    charge: etatCharge,
    vu_le: vuLe === null ? null : new Date(vuLe).toISOString(),
    fin_charge: finCharge(etatCharge, lire('restant'), vuLe),
    commandes: ROLES_COMMANDES.filter((role) => disponible(lire(role))),
    niveaux: Object.fromEntries(ROLES_NIVEAUX.map((role) => [role, niveau(lire(role))])),
  };
}

export function projeterVoitures(etats, voitures) {
  return voitures.map((voiture) => projeterVoiture(etats, voiture));
}

export function ecrituresVoitures(voitures) {
  return voitures.flatMap(({ nom, entites }) => [...ROLES_COMMANDES, ...ROLES_NIVEAUX]
    .filter((role) => entites[role])
    .map((role) => ({
      nom, role, service: SERVICE_ECRITURE[ROLES[role]], entityId: entites[role],
    })));
}

export class SourceVoitures extends EventEmitter {
  #voitures;
  #valeur;
  #empreinte;

  constructor(connexion, voitures = []) {
    super();
    this.#voitures = voitures;
    this.#valeur = projeterVoitures({}, voitures);
    this.#empreinte = JSON.stringify(this.#valeur);
    if (voitures.length > 0) connexion.once('connectee', (conn) => subscribeEntities(conn, (etats) => this.#recevoir(etats)));
  }

  get valeur() {
    return this.#valeur;
  }

  #recevoir(etats) {
    const valeur = projeterVoitures(etats, this.#voitures);
    const empreinte = JSON.stringify(valeur);
    if (empreinte === this.#empreinte) return;
    this.#empreinte = empreinte;
    this.#valeur = valeur;
    this.emit('maj', valeur);
  }
}
