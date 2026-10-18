// tests/garde-fous.test.js
//
// Rôle    : prouver le câblage des quatre garde-fous d'écriture (serveur/garde-fous.js), de la configuration jusqu'à la
//           connexion HA, sans AUCUN croisement : ACTIONS_REELLES=1 seul laisse la maison, la voiture et les clims en
//           simulation (et la connexion refuse leurs écritures), ACTIONS_MAISON=1 seul laisse les courses, la voiture et
//           les clims en simulation, ACTIONS_VOITURE=1 seul laisse les courses, la maison et les clims en simulation,
//           ACTIONS_CLIM=1 seul n'ouvre que les clims, trois drapeaux n'ouvrent jamais le quatrième, rien par défaut ; et
//           les couples d'écriture de la voiture viennent de VOITURES, ceux des clims de CLIMS.
// Entrées : chargerConfig avec les fixtures de tests/fixtures/config (clés et jeton factices), une VOITURES à plaque
//           factice (ab_123_cd, comme tests/voitures.test.js) et une CLIMS ; des ConnexionHA jamais démarrées (aucun
//           réseau).
// Sorties : node --test.
// Pièges  : sans connexion démarrée, une écriture permise échoue sur « non connecté » : c'est ce message, différent du
//           refus du drapeau, qui prouve qu'un garde-fou est ouvert.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chargerConfig } from '../serveur/config.js';
import { creerConnexion, creerEcritures } from '../serveur/garde-fous.js';
import { projeterClims } from '../serveur/ha/clims.js';
import { SourceCourses } from '../serveur/ha/courses.js';
import { projeterVoitures } from '../serveur/ha/voitures.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/config', import.meta.url));
const ENV = {
  HA_URL: 'http://192.0.2.1:8123',
  HA_JETON_FICHIER: join(FIXTURES, 'jeton-factice'),
  CLE_CADRE_FICHIER: join(FIXTURES, 'cle-factice'),
  CLE_CLEVO_FICHIER: join(FIXTURES, 'cle-clevo-factice'),
  VOITURES: 'Mégane: batterie=sensor.ab_123_cd_batterie, branchee=binary_sensor.ab_123_cd_branchee, '
    + 'klaxon=button.ab_123_cd_klaxonner, charge_min=number.ab_123_cd_niveau_de_charge_minimal',
  CLIMS: 'Salon: climat=climate.clim_salon, eco=switch.clim_salon_eco',
};
const KLAXON = ['button.press', 'button.ab_123_cd_klaxonner', {}];
const NIVEAU = ['number.set_value', 'number.ab_123_cd_niveau_de_charge_minimal', { value: 30 }];
const ETATS_VOITURE = {
  'button.ab_123_cd_klaxonner': { state: 'unknown', attributes: {} },
  'number.ab_123_cd_niveau_de_charge_minimal': { state: '45', attributes: { min: 15, max: 45, step: 5 } },
};
const MODE_CLIM = ['climate.set_hvac_mode', 'climate.clim_salon', { hvac_mode: 'cool' }];
const ECO = ['switch.turn_on', 'switch.clim_salon_eco', {}];
const ETATS_CLIM = {
  'climate.clim_salon': { state: 'off', attributes: { hvac_modes: ['off', 'cool', 'heat'], min_temp: 16, max_temp: 30, temperature: 25 } },
  'switch.clim_salon_eco': { state: 'off', attributes: {} },
};
const journal = () => ({ info() {}, warn() {}, error() {} });

function cabler(env) {
  const config = chargerConfig({ ...ENV, ...env });
  const connexion = creerConnexion(config, journal());
  const entites = Object.assign(new EventEmitter(), {
    valeur: { 'media_player.sejour_sejour': { state: 'idle', last_changed: '', attributes: { source_list: ['Netflix'] } } },
  });
  const courses = new SourceCourses(connexion, entites, journal());
  const voitures = { valeur: projeterVoitures(ETATS_VOITURE, config.voitures) };
  const clims = { valeur: projeterClims(ETATS_CLIM, config.clims) };
  return {
    connexion,
    ...creerEcritures(config, {
      connexion, entites, courses, voitures, clims, journal,
    }),
  };
}

const modes = ({
  actions, actionsMaison, actionsVoiture, actionsClim,
}) => [actions.simulation, actionsMaison.simulation, actionsVoiture.simulation, actionsClim.simulation];
const refuse = (promesse, motif, message) => assert.rejects(promesse, motif, message);
const ouvert = (promesse, message) => assert.rejects(promesse, /non connecté/, message);

test('ACTIONS_REELLES=1 seul : courses réelles, maison, voiture et clims SIMULÉES, et la connexion refuse leurs écritures', async () => {
  const cable = cabler({ ACTIONS_REELLES: '1' });
  const {
    connexion, actionsMaison, actionsVoiture, actionsClim,
  } = cable;
  assert.deepEqual(modes(cable), [false, true, true, true]);
  assert.deepEqual(await actionsClim.executer('clim_mode', { clim: 'Salon', mode: 'cool' }), { ok: true, simulation: true });
  await refuse(connexion.ecrireClim(...MODE_CLIM), /ACTIONS_CLIM ne vaut pas 1/);
  assert.deepEqual(await actionsMaison.executer('tv_touche', { touche: 'MUTE' }), { ok: true, simulation: true });
  assert.deepEqual(await actionsVoiture.executer('voiture_commande', { voiture: 'Mégane', commande: 'klaxon' }), { ok: true, simulation: true });
  await refuse(connexion.ecrireMaison('remote.send_command', 'remote.smart_tv_pro_2', { command: 'MUTE' }), /ACTIONS_MAISON ne vaut pas 1/);
  await refuse(connexion.ecrireVoiture(...KLAXON), /ACTIONS_VOITURE ne vaut pas 1/);
  await refuse(connexion.ecrireVoiture(...NIVEAU), /ACTIONS_VOITURE ne vaut pas 1/);
  await ouvert(connexion.ecrire('todo.add_item', 'todo.shopping_list', { item: 'lait' }), 'courses ouvertes');
});

test('ACTIONS_MAISON=1 seul : maison réelle, courses, voiture et clims SIMULÉES, et la connexion refuse leurs écritures', async () => {
  const cable = cabler({ ACTIONS_MAISON: '1' });
  const { connexion, actionsVoiture } = cable;
  assert.deepEqual(modes(cable), [true, false, true, true]);
  await refuse(connexion.ecrireClim(...ECO), /ACTIONS_CLIM ne vaut pas 1/);
  assert.deepEqual(await actionsVoiture.executer('voiture_niveau', { voiture: 'Mégane', reglage: 'charge_min', valeur: 30 }), { ok: true, simulation: true });
  await refuse(connexion.ecrire('todo.add_item', 'todo.shopping_list', { item: 'lait' }), /ACTIONS_REELLES ne vaut pas 1/);
  await refuse(connexion.ecrireVoiture(...KLAXON), /ACTIONS_VOITURE ne vaut pas 1/);
  await ouvert(connexion.ecrireMaison('script.turn_on', 'script.sonnette_direct', {}), 'maison ouverte');
});

test('ACTIONS_VOITURE=1 seul : voiture réelle, courses, maison et clims SIMULÉES, et la connexion refuse leurs écritures', async () => {
  const cable = cabler({ ACTIONS_VOITURE: '1' });
  const { connexion, actionsMaison } = cable;
  assert.deepEqual(modes(cable), [true, true, false, true]);
  await refuse(connexion.ecrireClim(...MODE_CLIM), /ACTIONS_CLIM ne vaut pas 1/);
  assert.deepEqual(await actionsMaison.executer('sonnette_direct', {}), { ok: true, simulation: true });
  await refuse(connexion.ecrire('todo.add_item', 'todo.shopping_list', { item: 'lait' }), /ACTIONS_REELLES ne vaut pas 1/);
  await refuse(connexion.ecrireMaison('script.turn_on', 'script.sonnette_direct', {}), /ACTIONS_MAISON ne vaut pas 1/);
  await ouvert(connexion.ecrireVoiture(...KLAXON), 'klaxon ouvert');
  await ouvert(connexion.ecrireVoiture(...NIVEAU), 'niveau ouvert');
});

test('ACTIONS_CLIM=1 seul : clims réelles, courses, maison et voiture SIMULÉES, et la connexion refuse leurs écritures', async () => {
  const cable = cabler({ ACTIONS_CLIM: '1' });
  const { connexion, actionsVoiture } = cable;
  assert.deepEqual(modes(cable), [true, true, true, false]);
  assert.deepEqual(await actionsVoiture.executer('voiture_commande', { voiture: 'Mégane', commande: 'klaxon' }), { ok: true, simulation: true });
  await refuse(connexion.ecrire('todo.add_item', 'todo.shopping_list', { item: 'lait' }), /ACTIONS_REELLES ne vaut pas 1/);
  await refuse(connexion.ecrireMaison('script.turn_on', 'script.sonnette_direct', {}), /ACTIONS_MAISON ne vaut pas 1/);
  await refuse(connexion.ecrireVoiture(...KLAXON), /ACTIONS_VOITURE ne vaut pas 1/);
  await ouvert(connexion.ecrireClim(...MODE_CLIM), 'mode de la clim ouvert');
  await ouvert(connexion.ecrireClim(...ECO), 'option de la clim ouverte');
});

test('trois drapeaux n\'ouvrent jamais le quatrième', async () => {
  const sansClim = cabler({ ACTIONS_REELLES: '1', ACTIONS_MAISON: '1', ACTIONS_VOITURE: '1' });
  assert.deepEqual(modes(sansClim), [false, false, false, true]);
  await refuse(sansClim.connexion.ecrireClim(...MODE_CLIM), /ACTIONS_CLIM ne vaut pas 1/);
  const sansVoiture = cabler({ ACTIONS_REELLES: '1', ACTIONS_MAISON: '1', ACTIONS_CLIM: '1' });
  assert.deepEqual(modes(sansVoiture), [false, false, true, false]);
  await refuse(sansVoiture.connexion.ecrireVoiture(...KLAXON), /ACTIONS_VOITURE ne vaut pas 1/);
  const sansMaison = cabler({ ACTIONS_REELLES: '1', ACTIONS_VOITURE: '1', ACTIONS_CLIM: '1' });
  assert.deepEqual(modes(sansMaison), [false, true, false, false]);
  await refuse(sansMaison.connexion.ecrireMaison('script.turn_on', 'script.sonnette_direct', {}), /ACTIONS_MAISON ne vaut pas 1/);
  const sansCourses = cabler({ ACTIONS_MAISON: '1', ACTIONS_VOITURE: '1', ACTIONS_CLIM: '1' });
  assert.deepEqual(modes(sansCourses), [true, false, false, false]);
  await refuse(sansCourses.connexion.ecrire('todo.add_item', 'todo.shopping_list', { item: 'lait' }), /ACTIONS_REELLES ne vaut pas 1/);
});

test('par défaut (aucun des quatre) : tout est simulé et la connexion refuse les quatre sortes d\'écriture', async () => {
  const cable = cabler({});
  const { connexion } = cable;
  assert.deepEqual(modes(cable), [true, true, true, true]);
  await refuse(connexion.ecrireClim(...MODE_CLIM), /ACTIONS_CLIM ne vaut pas 1/);
  await refuse(connexion.ecrire('todo.add_item', 'todo.shopping_list', { item: 'lait' }), /ACTIONS_REELLES ne vaut pas 1/);
  await refuse(connexion.ecrireMaison('script.turn_on', 'script.sonnette_direct', {}), /ACTIONS_MAISON ne vaut pas 1/);
  await refuse(connexion.ecrireVoiture(...KLAXON), /ACTIONS_VOITURE ne vaut pas 1/);
});

test('couples de la voiture tirés de VOITURES : seules ses commandes configurées passent, même avec ACTIONS_VOITURE=1', async () => {
  const { connexion } = cabler({ ACTIONS_VOITURE: '1' });
  const horsListe = [
    ['button.press', 'button.ab_123_cd_commencer_la_charge'],
    ['number.set_value', 'number.ab_123_cd_niveau_de_charge_cible'],
    ['number.set_value', 'button.ab_123_cd_klaxonner'],
    ['button.press', 'number.ab_123_cd_niveau_de_charge_minimal'],
    ['button.press', 'button.freebox_reboot'],
    ['sensor.update', 'sensor.ab_123_cd_batterie'],
  ];
  for (const [service, entite] of horsListe) {
    await refuse(connexion.ecrireVoiture(service, entite, {}), (err) => {
      assert.match(err.message, /^écriture voiture refusée, hors liste/, `${service} sur ${entite}`);
      assert.doesNotMatch(err.message, /ab_123_cd|freebox/, 'jamais d\'entity_id dans le message');
      return true;
    });
  }
  const sansCommande = creerConnexion(chargerConfig({ ...ENV, ACTIONS_VOITURE: '1', VOITURES: '' }), journal());
  await refuse(sansCommande.ecrireVoiture(...KLAXON), /hors liste/, 'sans VOITURES : aucun couple');
});

test('couples des clims tirés de CLIMS : seules ses entités et les services des clims passent, même avec ACTIONS_CLIM=1', async () => {
  const { connexion } = cabler({ ACTIONS_CLIM: '1' });
  const horsListe = [
    ['climate.set_hvac_mode', 'climate.clim_etage'],
    ['switch.turn_on', 'switch.clim_salon_boost'],
    ['switch.toggle', 'switch.clim_salon_eco'],
    ['climate.set_preset_mode', 'climate.clim_salon'],
    ['switch.turn_on', 'climate.clim_salon'],
    ['switch.turn_off', 'switch.freebox_wifi'],
    ['button.press', 'button.ab_123_cd_klaxonner'],
  ];
  for (const [service, entite] of horsListe) {
    await refuse(connexion.ecrireClim(service, entite, {}), /^Error: écriture clim refusée, hors liste/, `${service} sur ${entite}`);
  }
  const sansClim = creerConnexion(chargerConfig({ ...ENV, ACTIONS_CLIM: '1', CLIMS: '' }), journal());
  await refuse(sansClim.ecrireClim(...MODE_CLIM), /hors liste/, 'sans CLIMS : aucun couple');
});
