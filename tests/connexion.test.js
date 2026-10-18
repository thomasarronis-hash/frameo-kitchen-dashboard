// tests/connexion.test.js
//
// Rôle    : prouver les deux garde-fous de serveur/ha/connexion.js :
//           - lecture : seuls weather.get_forecasts, todo.get_items et calendar.get_events passent par lire(),
//             chacun sur une entité de son domaine ;
//           - écriture : seuls todo.add_item, todo.update_item, todo.remove_item et todo.remove_completed_items
//             sur todo.shopping_list passent par ecrire(), et seulement si la connexion a été créée avec
//             actionsReelles (ACTIONS_REELLES=1) ;
//           - écriture maison, verrou SÉPARÉ : seuls les 4 couples des télécommandes, de l'appli de l'Apple TV et
//             du direct de la sonnette passent par ecrireMaison(), et seulement avec actionsMaison
//             (ACTIONS_MAISON=1) ; aucun service d'alarme, aucun autre script, ni Freebox ni notification ;
//           - écriture de la voiture, troisième verrou SÉPARÉ : seuls les couples button.press et number.set_value donnés
//             à la création (commandes de VOITURES) passent par ecrireVoiture(), et seulement avec actionsVoiture
//             (ACTIONS_VOITURE=1) ; un autre couple est refusé dès la création ; aucun message ne cite l'entity_id.
//           Tout refus arrive AVANT même de regarder la connexion. Une lecture sans réponse est rejetée au bout du délai.
// Entrées : des ConnexionHA jamais démarrées (aucun réseau : createLongLivedTokenAuth ne se connecte pas), et une
//           démarrée sur une fausse Connection (délai des lectures).
// Sorties : node --test.
// Pièges  : sans connexion, un appel autorisé échoue sur « non connecté » ; c'est ce message, différent
//           de « refusé », qui prouve que le refus vient bien des listes et non de l'état.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConnexionHA } from '../serveur/ha/connexion.js';

const journal = { info() {}, warn() {}, error() {} };
const connexion = new ConnexionHA({ url: 'http://192.0.2.1:8123', jeton: 'jeton-factice', journal });
const connexionReelle = new ConnexionHA({ url: 'http://192.0.2.1:8123', jeton: 'jeton-factice', journal, actionsReelles: true });
const connexionMaison = new ConnexionHA({ url: 'http://192.0.2.1:8123', jeton: 'jeton-factice', journal, actionsMaison: true });

const ECRITURES_MAISON = [
  ['remote.send_command', 'remote.sejour_sejour', { command: 'up' }],
  ['media_player.select_source', 'media_player.sejour_sejour', { source: 'Netflix' }],
  ['remote.send_command', 'remote.smart_tv_pro_2', { command: 'HOME' }],
  ['script.turn_on', 'script.sonnette_direct', {}],
];

const ECRITURES_PERMISES = [
  ['todo.add_item', { item: 'lait' }],
  ['todo.update_item', { item: 'uid1', status: 'completed' }],
  ['todo.remove_item', { item: 'uid1' }],
  ['todo.remove_completed_items', {}],
];

test('tout service hors lecture est refusé (alarme, courses en écriture, télécommande, scripts...)', async () => {
  const interdits = [
    ['alarm_control_panel.alarm_disarm', 'alarm_control_panel.alarme_maison'],
    ['alarm_control_panel.alarm_arm_away', 'alarm_control_panel.alarm_center'],
    ['todo.add_item', 'todo.shopping_list'],
    ['todo.update_item', 'todo.shopping_list'],
    ['todo.remove_item', 'todo.shopping_list'],
    ['remote.send_command', 'remote.sejour_sejour'],
    ['media_player.select_source', 'media_player.sejour_sejour'],
    ['script.turn_on', 'script.sonnette_direct'],
    ['switch.turn_off', 'switch.freebox_v9_r1_wi_fi'],
    ['notify.notify', undefined],
    ['weather.get_forecasts_x', 'weather.forecast_maison'],
  ];
  for (const [service, entite] of interdits) {
    await assert.rejects(connexion.lire(service, entite, {}), /^Error: service refusé, lecture seule/, service);
  }
});

test('les trois services de lecture passent le garde-fou (puis échouent ici faute de connexion)', async () => {
  assert.equal(connexion.etat, 'ko');
  await assert.rejects(connexion.lire('weather.get_forecasts', 'weather.forecast_maison', { type: 'hourly' }), /non connecté/);
  await assert.rejects(connexion.lire('todo.get_items', 'todo.shopping_list', { status: ['needs_action', 'completed'] }), /non connecté/);
  await assert.rejects(connexion.lire('calendar.get_events', 'calendar.famille', { duration: { days: 14 } }), /non connecté/);
});

test('lecture : un service permis sur une entité d\'un autre domaine est refusé', async () => {
  const croises = [
    ['calendar.get_events', 'alarm_control_panel.alarme_maison'],
    ['calendar.get_events', 'todo.shopping_list'],
    ['calendar.get_events', undefined],
    ['todo.get_items', 'calendar.famille'],
    ['weather.get_forecasts', 'switch.freebox_v9_r1_wi_fi'],
  ];
  for (const [service, entite] of croises) {
    await assert.rejects(connexion.lire(service, entite, {}), /^Error: lecture refusée : .*hors de son domaine$/, `${service} sur ${entite}`);
  }
});

test('écriture : sans ACTIONS_REELLES=1, même les 4 services permis sont refusés', async () => {
  for (const [service, donnees] of ECRITURES_PERMISES) {
    await assert.rejects(connexion.ecrire(service, 'todo.shopping_list', donnees), /^Error: écriture refusée : ACTIONS_REELLES ne vaut pas 1$/, service);
  }
});

test('écriture : avec ACTIONS_REELLES=1, tout service ou toute entité hors liste reste refusé', async () => {
  const interdits = [
    ['todo.add_item', 'todo.autre_liste'],
    ['todo.get_items', 'todo.shopping_list'],
    ['alarm_control_panel.alarm_disarm', 'alarm_control_panel.alarme_maison'],
    ['alarm_control_panel.alarm_arm_away', 'alarm_control_panel.alarm_center'],
    ['select.select_option', 'select.alarm_center_guard_mode'],
    ['switch.turn_off', 'switch.freebox_v9_r1_wi_fi'],
    ['remote.turn_off', 'remote.sejour_sejour'],
    ['script.turn_on', 'script.sonnette_direct'],
    ['notify.notify', undefined],
    ['shell_command.quelconque', undefined],
    ['calendar.get_events', 'calendar.famille'],
    ['calendar.create_event', 'calendar.famille'],
  ];
  for (const [service, entite] of interdits) {
    await assert.rejects(connexionReelle.ecrire(service, entite, {}), /^Error: écriture refusée, hors liste/, `${service} sur ${entite}`);
  }
});

test('écriture : avec ACTIONS_REELLES=1, les 4 services permis passent le garde-fou (puis échouent ici faute de connexion)', async () => {
  for (const [service, donnees] of ECRITURES_PERMISES) {
    await assert.rejects(connexionReelle.ecrire(service, 'todo.shopping_list', donnees), /non connecté/, service);
  }
});

test('actionsReelles n\'accepte que le booléen vrai', async () => {
  const chaine = new ConnexionHA({ url: 'http://192.0.2.1:8123', jeton: 'jeton-factice', journal, actionsReelles: '1' });
  await assert.rejects(chaine.ecrire('todo.add_item', 'todo.shopping_list', { item: 'lait' }), /ACTIONS_REELLES ne vaut pas 1/);
});

test('écriture maison : sans ACTIONS_MAISON=1, même les 4 couples permis sont refusés, ACTIONS_REELLES=1 n\'y change rien', async () => {
  for (const c of [connexion, connexionReelle]) {
    for (const [service, entite, donnees] of ECRITURES_MAISON) {
      await assert.rejects(c.ecrireMaison(service, entite, donnees), /^Error: écriture maison refusée : ACTIONS_MAISON ne vaut pas 1$/, `${service} sur ${entite}`);
    }
  }
});

test('écriture maison : ACTIONS_MAISON=1 n\'ouvre pas les courses', async () => {
  for (const [service, donnees] of ECRITURES_PERMISES) {
    await assert.rejects(connexionMaison.ecrire(service, 'todo.shopping_list', donnees), /ACTIONS_REELLES ne vaut pas 1/, service);
  }
});

test('écriture maison : avec ACTIONS_MAISON=1, alarme (tous ses services), autres scripts, Freebox, couples croisés restent refusés', async () => {
  const alarme = ['alarm_arm_home', 'alarm_arm_night', 'alarm_arm_away', 'alarm_arm_vacation', 'alarm_arm_custom_bypass', 'alarm_disarm', 'alarm_trigger', 'turn_on', 'turn_off']
    .flatMap((service) => ['alarme_maison', 'alarm_center'].map((nom) => [`alarm_control_panel.${service}`, `alarm_control_panel.${nom}`]));
  const interdits = [
    ...alarme,
    ['select.select_option', 'select.alarm_center_guard_mode'],
    ['script.turn_on', 'script.sonnette_flux_on'],
    ['script.turn_on', 'script.sonnette_capture'],
    ['script.sonnette_direct', undefined],
    ['script.turn_off', 'script.sonnette_direct'],
    ['remote.turn_off', 'remote.sejour_sejour'],
    ['remote.turn_on', 'remote.sejour_sejour'],
    ['remote.send_command', 'remote.autre'],
    ['media_player.select_source', 'media_player.smart_tv_pro_2_2'],
    ['media_player.turn_off', 'media_player.sejour_sejour'],
    ['switch.turn_off', 'switch.freebox_v9_r1_wi_fi'],
    ['button.press', 'button.freebox_reboot'],
    ['notify.notify', undefined],
    ['shell_command.quelconque', undefined],
    ['todo.add_item', 'todo.shopping_list'],
  ];
  for (const [service, entite] of interdits) {
    await assert.rejects(connexionMaison.ecrireMaison(service, entite, {}), /^Error: écriture maison refusée, hors liste/, `${service} sur ${entite}`);
  }
});

test('écriture maison : avec ACTIONS_MAISON=1, les 4 couples permis passent le garde-fou (puis échouent ici faute de connexion)', async () => {
  for (const [service, entite, donnees] of ECRITURES_MAISON) {
    await assert.rejects(connexionMaison.ecrireMaison(service, entite, donnees), /non connecté/, `${service} sur ${entite}`);
  }
  const chaine = new ConnexionHA({ url: 'http://192.0.2.1:8123', jeton: 'jeton-factice', journal, actionsMaison: '1' });
  await assert.rejects(chaine.ecrireMaison('script.turn_on', 'script.sonnette_direct', {}), /ACTIONS_MAISON ne vaut pas 1/, 'le booléen vrai seulement');
});

const ECRITURES_VOITURE = ['button.press button.ab_123_cd_klaxonner', 'number.set_value number.ab_123_cd_niveau_de_charge_cible'];
const connexionVoiture = new ConnexionHA({
  url: 'http://192.0.2.1:8123', jeton: 'jeton-factice', journal, actionsVoiture: true, ecrituresVoiture: ECRITURES_VOITURE,
});
const sansPlaque = (motif) => (err) => {
  assert.match(err.message, motif);
  assert.doesNotMatch(err.message, /ab_123_cd/, `entity_id cité : ${err.message}`);
  return true;
};

test('écriture voiture : couples refusés dès la création s\'ils ne sont pas button.press sur un button ou number.set_value sur un number', () => {
  const refuses = [
    'remote.send_command remote.sejour_sejour', 'script.turn_on script.sonnette_direct', 'todo.add_item todo.shopping_list',
    'alarm_control_panel.alarm_disarm alarm_control_panel.alarme_maison', 'button.press number.ab_123_cd_x', 'number.set_value button.ab_123_cd_x',
    'select.select_option select.ab_123_cd_mode_de_charge', 'button.press button.AB_123_cd', 'button.press  button.x', 'button.press',
  ];
  for (const couple of refuses) {
    assert.throws(() => new ConnexionHA({
      url: 'http://192.0.2.1:8123', jeton: 'jeton-factice', journal, actionsVoiture: true, ecrituresVoiture: [couple],
    }), sansPlaque(/^ecrituresVoiture : seuls button\.press/), couple);
  }
});

test('écriture voiture : sans ACTIONS_VOITURE=1, même les couples permis sont refusés, ACTIONS_REELLES et ACTIONS_MAISON n\'y changent rien', async () => {
  const fermee = new ConnexionHA({
    url: 'http://192.0.2.1:8123', jeton: 'jeton-factice', journal, actionsReelles: true, actionsMaison: true, ecrituresVoiture: ECRITURES_VOITURE,
  });
  await assert.rejects(fermee.ecrireVoiture('button.press', 'button.ab_123_cd_klaxonner', {}), sansPlaque(/^écriture voiture refusée : ACTIONS_VOITURE ne vaut pas 1$/));
  await assert.rejects(fermee.ecrireVoiture('number.set_value', 'number.ab_123_cd_niveau_de_charge_cible', { value: 80 }), /ACTIONS_VOITURE ne vaut pas 1/);
  const chaine = new ConnexionHA({
    url: 'http://192.0.2.1:8123', jeton: 'jeton-factice', journal, actionsVoiture: '1', ecrituresVoiture: ECRITURES_VOITURE,
  });
  await assert.rejects(chaine.ecrireVoiture('button.press', 'button.ab_123_cd_klaxonner', {}), /ACTIONS_VOITURE ne vaut pas 1/, 'le booléen vrai seulement');
});

test('écriture voiture : ACTIONS_VOITURE=1 n\'ouvre ni les courses ni la maison ; tout couple hors liste reste refusé, sans citer l\'entité', async () => {
  await assert.rejects(connexionVoiture.ecrire('todo.add_item', 'todo.shopping_list', { item: 'lait' }), /ACTIONS_REELLES ne vaut pas 1/);
  await assert.rejects(connexionVoiture.ecrireMaison('script.turn_on', 'script.sonnette_direct', {}), /ACTIONS_MAISON ne vaut pas 1/);
  const interdits = [
    ['button.press', 'button.ab_123_cd_commencer_la_charge'],
    ['number.set_value', 'number.ab_123_cd_niveau_de_charge_minimal'],
    ['number.set_value', 'button.ab_123_cd_klaxonner'],
    ['button.press', 'number.ab_123_cd_niveau_de_charge_cible'],
    ['button.press', 'button.freebox_reboot'],
    ['alarm_control_panel.alarm_disarm', 'alarm_control_panel.alarme_maison'],
    ...ECRITURES_MAISON.map(([service, entite]) => [service, entite]),
    ['button.press button.ab_123_cd_klaxonner', ''],
    ['button.press', undefined],
  ];
  for (const [service, entite] of interdits) {
    await assert.rejects(connexionVoiture.ecrireVoiture(service, entite, {}), sansPlaque(/^écriture voiture refusée, hors liste/), `${service} sur ${entite}`);
  }
});

test('écriture voiture : avec ACTIONS_VOITURE=1, les couples donnés passent le garde-fou (puis échouent ici faute de connexion)', async () => {
  await assert.rejects(connexionVoiture.ecrireVoiture('button.press', 'button.ab_123_cd_klaxonner', {}), /non connecté/);
  await assert.rejects(connexionVoiture.ecrireVoiture('number.set_value', 'number.ab_123_cd_niveau_de_charge_cible', { value: 80 }), /non connecté/);
});

// Fausse Connection de la bibliothèque : callService passe par sendMessagePromise, que chaque test règle.
function fausseConnection(repondre) {
  return {
    haVersion: 'test', addEventListener() {}, ping: () => new Promise(() => {}), close() {}, reconnect() {}, sendMessagePromise: repondre,
  };
}

test('lecture : une réponse qui n\'arrive jamais est rejetée au bout du délai (« délai dépassé »), la suivante passe', async () => {
  let muette = true;
  const conn = fausseConnection(() => (muette ? new Promise(() => {}) : Promise.resolve({ response: { 'calendar.domicile': { events: [] } } })));
  const lente = new ConnexionHA({
    url: 'http://192.0.2.1:8123', jeton: 'jeton-factice', journal, delaiLectureMs: 50, connecter: async () => conn,
  });
  await lente.demarrer();
  assert.equal(lente.etat, 'ok');
  const debut = Date.now();
  await assert.rejects(lente.lire('calendar.get_events', 'calendar.domicile', { duration: { days: 14 } }), /^Error: calendar\.get_events : délai dépassé/);
  assert.ok(Date.now() - debut < 2000, 'rejet au bout du délai, pas d\'attente sans fin');
  muette = false;
  assert.deepEqual(await lente.lire('calendar.get_events', 'calendar.domicile', { duration: { days: 14 } }), { events: [] });
  lente.arreter();
});
