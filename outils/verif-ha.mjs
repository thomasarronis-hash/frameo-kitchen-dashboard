#!/usr/bin/env node
// outils/verif-ha.mjs (npm run verif-ha)
//
// Rôle    : vérifier, en LECTURE SEULE, que chaque entité de la liste blanche du BFF existe dans Home
//           Assistant, et relever son état et ses unités ; puis que les entités visées par les actions (courses et
//           maison : script.sonnette_direct...) existent aussi. À relancer après chaque mise à jour de HA (§2.7).
// Entrées : les mêmes variables que le serveur (HA_URL, HA_JETON_FICHIER, AGENDA_CALENDRIERS, VOITURES, CLIMS ; .env lu
//           par npm run verif-ha) : les calendriers configurés sont vérifiés comme le reste de la liste blanche, et les
//           entités de chaque voiture et de chaque clim (sous le nom donné dans VOITURES ou CLIMS et leur rôle, état et
//           unité seulement).
// Sorties : un tableau à l'écran, puis le bilan. Code de sortie : 0 si tout est là ; 1 s'il manque une
//           entité ou si le jeton est celui d'un administrateur ; 2 si HA est injoignable ou refuse le jeton.
// Pièges  :
//   - Seuls auth/current_user et get_states sont envoyés : aucune écriture, aucun appel de service.
//   - Le jeton n'est jamais affiché ; get_states renvoie aussi les positions GPS, rien d'autre que l'état
//     et les unités des entités de la liste blanche n'est imprimé.
//   - Voitures : ni entity_id ni friendly_name imprimés (la plaque d'immatriculation y est souvent) : le nom de VOITURES
//     et le rôle suffisent à savoir ce qui manque.
//   - Les unités affichées sont celles des attributs (unit_of_measurement, *_unit) : c'est ce que la page
//     affichera, le système d'unités global de HA n'y change rien.

import { createConnection, createLongLivedTokenAuth, getStates, getUser } from 'home-assistant-js-websocket';
import {
  chargerConfigHA, lireCalendriers, lireClims, lireVoitures,
} from '../serveur/config.js';
import { ACTIONS } from '../serveur/ha/actions.js';
import { ACTIONS_MAISON } from '../serveur/ha/actions-maison.js';
import { listeBlanche } from '../serveur/ha/entites.js';

function unites(attributs) {
  return Object.entries(attributs)
    .filter(([nom]) => nom === 'unit_of_measurement' || nom.endsWith('_unit'))
    .map(([nom, valeur]) => `${nom}=${valeur}`)
    .join(', ');
}

// La bibliothèque rejette avec un code numérique (ERR_CANNOT_CONNECT = 1, ERR_INVALID_AUTH = 2...).
const CAUSES = { 1: 'HA injoignable', 2: 'jeton refusé', 3: 'connexion perdue' };

let conn;
let utilisateur;
let etats;
let liste;
let voitures;
let clims;
try {
  liste = listeBlanche(lireCalendriers().map((calendrier) => calendrier.id));
  voitures = lireVoitures();
  clims = lireClims();
  const { haUrl, haJeton } = chargerConfigHA();
  conn = await createConnection({ auth: createLongLivedTokenAuth(haUrl, haJeton) });
  utilisateur = await getUser(conn);
  etats = new Map((await getStates(conn)).map((etat) => [etat.entity_id, etat]));
  conn.close();
} catch (err) {
  console.error(`Lecture de Home Assistant impossible : ${CAUSES[err] ?? err?.message ?? err}`);
  process.exit(2);
}

console.log(`Home Assistant ${conn.haVersion}, jeton de « ${utilisateur.name} » (admin : ${utilisateur.is_admin ? 'OUI' : 'non'})\n`);
const manquantes = [];
for (const entityId of Object.keys(liste)) {
  const etat = etats.get(entityId);
  if (!etat) {
    manquantes.push(entityId);
    console.log(`MANQUE  ${entityId}`);
    continue;
  }
  const u = unites(etat.attributes);
  console.log(`ok      ${entityId.padEnd(52)} ${String(etat.state).padEnd(14)} ${u}`);
}

// Cibles des actions hors liste blanche de lecture (script de la sonnette) : présence seulement, rien n'est appelé.
const cibles = [...new Set([...Object.values(ACTIONS), ...Object.values(ACTIONS_MAISON)].map((action) => action.entity_id))]
  .filter((entityId) => !(entityId in liste));
console.log('\nCibles des actions (hors liste de lecture) :');
for (const entityId of cibles) {
  const etat = etats.get(entityId);
  if (!etat) manquantes.push(entityId);
  console.log(`${etat ? 'ok    ' : 'MANQUE'}  ${entityId.padEnd(52)} ${etat ? etat.state : ''}`);
}

// Voitures de VOITURES : rôle et état, sous le nom affiché (jamais l'entity_id).
const roles = voitures.flatMap((voiture) => Object.entries(voiture.entites).map(([role, entityId]) => ({ voiture: voiture.nom, role, entityId })));
if (roles.length > 0) console.log('\nVoitures (VOITURES) :');
for (const { voiture, role, entityId } of roles) {
  const etat = etats.get(entityId);
  if (!etat) manquantes.push(`${voiture} ${role}`);
  console.log(`${etat ? 'ok    ' : 'MANQUE'}  ${`${voiture} · ${role}`.padEnd(52)} ${etat ? `${String(etat.state).padEnd(14)} ${unites(etat.attributes)}` : ''}`);
}

// Clims de CLIMS : rôle et état, sous le nom affiché.
const rolesClims = clims.flatMap((clim) => Object.entries(clim.entites).map(([role, entityId]) => ({ clim: clim.nom, role, entityId })));
if (rolesClims.length > 0) console.log('\nClims (CLIMS) :');
for (const { clim, role, entityId } of rolesClims) {
  const etat = etats.get(entityId);
  if (!etat) manquantes.push(`${clim} ${role}`);
  console.log(`${etat ? 'ok    ' : 'MANQUE'}  ${`${clim} · ${role}`.padEnd(52)} ${etat ? String(etat.state) : ''}`);
}

const total = Object.keys(liste).length + cibles.length + roles.length + rolesClims.length;
console.log(`\n${total - manquantes.length}/${total} entités présentes, ${manquantes.length} manquante(s).`);
if (utilisateur.is_admin) console.log('REFUS : le BFF ne doit jamais tourner avec un jeton administrateur (conception §2.5).');
process.exit(manquantes.length > 0 || utilisateur.is_admin ? 1 : 0);
