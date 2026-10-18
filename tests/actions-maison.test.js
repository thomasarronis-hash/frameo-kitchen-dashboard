// tests/actions-maison.test.js
//
// Rôle    : prouver la liste blanche des actions MAISON (serveur/ha/actions-maison.js) et leur passage par la route
//           POST /api/action/:nom : aucune action d'alarme (tout service alarm_control_panel refusé, au chargement de
//           la table comme à la route), touches hors liste refusées, applis hors source_list refusées, simulation par
//           défaut SANS aucun appel à la connexion HA, ACTIONS_MAISON=1 qui appelle le bon service sur le bon
//           entity_id (fausse connexion), garde-fou séparé de celui des courses, touches de télécommande à
//           10 par seconde hors limite globale et hors limite dédiée.
// Entrées : une fausse connexion qui note chaque appel (ecrireMaison, ecrire, lire) ; une fausse SourceEntites avec la
//           source_list réelle de l'Apple TV (tests/fixtures/ha_states.json).
// Sorties : node --test.
// Pièges  : la fausse connexion n'est pas une ConnexionHA : son verrou d'écriture maison (ACTIONS_MAISON, couples
//           permis) est prouvé à part dans tests/connexion.test.js. Ici, on prouve que actions-maison.js ne l'appelle
//           JAMAIS en simulation, et l'appelle comme il faut en réel.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ACTIONS_MAISON, creerActionsMaison, TOUCHES_APPLE_TV, TOUCHES_TELE } from '../serveur/ha/actions-maison.js';
import { verifierActions } from '../serveur/ha/actions.js';
import { SourceCourses } from '../serveur/ha/courses.js';
import { CLE, FausseSource, monter } from './aides.js';

const etats = JSON.parse(readFileSync(new URL('./fixtures/ha_states.json', import.meta.url), 'utf8'));
const APPLE_TV = etats.find((etat) => etat.entity_id === 'media_player.sejour_sejour');
const SOURCES = APPLE_TV.attributes.source_list;

function journalCapture() {
  const lignes = [];
  return { lignes, info: (m) => lignes.push(m), warn: (m) => lignes.push(m), error: (m) => lignes.push(m) };
}

function fausseConnexion({ echec = null } = {}) {
  const appels = [];
  const noter = (methode) => async (service, entite, donnees) => {
    appels.push({ methode, service, entite, donnees });
    if (echec) throw new Error(echec);
  };
  return { appels, ecrireMaison: noter('ecrireMaison'), ecrire: noter('ecrire'), lire: noter('lire') };
}

const entitesAvecApplis = (liste = SOURCES) => ({
  valeur: { 'media_player.sejour_sejour': { state: 'off', last_changed: '', attributes: { source_list: liste } } },
});

function preparer({ reelles = false, echec, entites = entitesAvecApplis() } = {}) {
  const connexion = fausseConnexion({ echec });
  const journal = journalCapture();
  return { connexion, journal, actions: creerActionsMaison({ connexion, entites, reelles, journal }) };
}

test('la table : 4 actions maison, entités figées, AUCUNE action d\'alarme', () => {
  assert.deepEqual(Object.keys(ACTIONS_MAISON), ['appletv_touche', 'appletv_appli', 'tv_touche', 'sonnette_direct']);
  const cibles = Object.values(ACTIONS_MAISON).map(({ domaine, service, entity_id: entite }) => `${domaine}.${service} ${entite}`);
  assert.deepEqual(cibles, [
    'remote.send_command remote.sejour_sejour',
    'media_player.select_source media_player.sejour_sejour',
    'remote.send_command remote.smart_tv_pro_2',
    'script.turn_on script.sonnette_direct',
  ]);
  assert.ok(Object.values(ACTIONS_MAISON).every(({ domaine, entity_id: entite }) => domaine !== 'alarm_control_panel' && !entite.startsWith('alarm_control_panel.')));
  assert.doesNotThrow(() => verifierActions(ACTIONS_MAISON, { scripts: ['script.sonnette_direct'] }));
});

test('verifierActions : toute action d\'alarme, un autre script, la Freebox, notify, remote.turn_off sont refusés même en table maison', () => {
  const action = (domaine, service, entite) => ({ x: { domaine, service, entity_id: entite } });
  const options = { scripts: ['script.sonnette_direct'] };
  const refus = [
    ...['alarm_arm_home', 'alarm_arm_night', 'alarm_arm_away', 'alarm_arm_vacation', 'alarm_disarm', 'alarm_trigger', 'alarm_arm_custom_bypass']
      .map((service) => [action('alarm_control_panel', service, 'alarm_control_panel.alarme_maison'), /domaine interdit alarm_control_panel/]),
    [action('alarm_control_panel', 'alarm_disarm', 'alarm_control_panel.alarm_center'), /domaine interdit alarm_control_panel/],
    [action('select', 'select_option', 'select.alarm_center_guard_mode'), /entité interdite select\.alarm_center_guard_mode/],
    [action('script', 'turn_on', 'script.sonnette_flux_on'), /script non permis script\.sonnette_flux_on/],
    [action('script', 'turn_on', 'script.alarme_desarmer'), /script non permis/],
    [action('remote', 'turn_off', 'remote.sejour_sejour'), /service interdit remote\.turn_off/],
    [action('switch', 'turn_off', 'switch.freebox_v9_r1_wi_fi'), /entité interdite switch\.freebox_v9_r1_wi_fi/],
    [action('button', 'press', 'button.freebox_reboot'), /entité interdite button\.freebox_reboot/],
    [action('notify', 'notify', 'notify.mobile_app_iphone'), /domaine interdit notify/],
    [action('shell_command', 'x', 'shell_command.x'), /domaine interdit shell_command/],
  ];
  for (const [table, motif] of refus) assert.throws(() => verifierActions(table, options), motif);
});

test('aucun service d\'alarme n\'est atteignable par la route : 404, rien d\'appelé, en simulation comme en réel', async () => {
  for (const reelles of [false, true]) {
    const { connexion, actions } = preparer({ reelles });
    for (const nom of ['alarme_armer_maison', 'alarme_armer_nuit', 'alarme_armer_absent', 'alarme_desarmer', 'alarm_disarm', 'alarm_control_panel.alarm_disarm']) {
      assert.equal(actions.connait(nom), false, nom);
      await assert.rejects(actions.executer(nom, { code: '1234' }), { statusCode: 404, code: 'action_inconnue' }, nom);
    }
    assert.deepEqual(connexion.appels, []);
  }
});

test('simulation par défaut : réponse de même forme, AUCUN appel à la connexion, journal « simulation »', async () => {
  const { connexion, journal, actions } = preparer();
  assert.equal(actions.simulation, true);
  const essais = [
    ['appletv_touche', { touche: 'select' }, 'remote.send_command sur remote.sejour_sejour {"command":"select"}'],
    ['appletv_appli', { source: 'Netflix' }, 'media_player.select_source sur media_player.sejour_sejour {"source":"Netflix"}'],
    ['tv_touche', { touche: 'VOLUME_UP' }, 'remote.send_command sur remote.smart_tv_pro_2 {"command":"VOLUME_UP"}'],
    ['sonnette_direct', {}, 'script.turn_on sur script.sonnette_direct'],
  ];
  for (const [nom, corps, detail] of essais) {
    assert.deepEqual(await actions.executer(nom, corps), { ok: true, simulation: true }, nom);
    assert.equal(journal.lignes.at(-1), `simulation : ${nom} (${detail}), rien n'est envoyé à la maison`);
  }
  assert.deepEqual(connexion.appels, [], 'la connexion HA ne doit jamais être appelée en simulation');
});

test('ACTIONS_MAISON=1 : le bon service sur le bon entity_id, avec la bonne donnée', async () => {
  const { connexion, actions } = preparer({ reelles: true });
  assert.equal(actions.simulation, false);
  const cas = [
    ['appletv_touche', { touche: 'up' }, 'remote.send_command', 'remote.sejour_sejour', { command: 'up' }],
    ['appletv_touche', { touche: 'play_pause' }, 'remote.send_command', 'remote.sejour_sejour', { command: 'play_pause' }],
    ['appletv_appli', { source: 'france•tv' }, 'media_player.select_source', 'media_player.sejour_sejour', { source: 'france•tv' }],
    ['tv_touche', { touche: 'DPAD_CENTER' }, 'remote.send_command', 'remote.smart_tv_pro_2', { command: 'DPAD_CENTER' }],
    ['sonnette_direct', {}, 'script.turn_on', 'script.sonnette_direct', {}],
  ];
  for (const [nom, corps, service, entite, donnees] of cas) {
    connexion.appels.length = 0;
    assert.deepEqual(await actions.executer(nom, corps), { ok: true, simulation: false }, nom);
    assert.deepEqual(connexion.appels, [{ methode: 'ecrireMaison', service, entite, donnees }], nom);
  }
});

test('ACTIONS_MAISON=1 : un refus de HA donne 502 avec son message', async () => {
  const { actions, journal } = preparer({ reelles: true, echec: 'remote.send_command : non connecté' });
  await assert.rejects(actions.executer('tv_touche', { touche: 'HOME' }), { statusCode: 502, code: 'action_echouee', message: 'remote.send_command : non connecté' });
  assert.match(journal.lignes.join('\n'), /tv_touche : échec de remote\.send_command/);
});

test('touches hors liste refusées (400) avant tout appel : casse, touches d\'une autre télécommande, extinction, POWER', async () => {
  const invalides = [
    ['appletv_touche', { touche: 'turn_off' }],
    ['appletv_touche', { touche: 'UP' }],
    ['appletv_touche', { touche: 'DPAD_UP' }],
    ['appletv_touche', { touche: 'top_menu' }],
    ['appletv_touche', { touche: ['up'] }],
    ['appletv_touche', { touche: 'up', entity_id: 'remote.smart_tv_pro_2' }],
    ['appletv_touche', {}],
    ['tv_touche', { touche: 'POWER' }],
    ['tv_touche', { touche: 'dpad_up' }],
    ['tv_touche', { touche: 'up' }],
    ['tv_touche', { touche: 'KEYCODE_HOME' }],
    ['sonnette_direct', { duree: 300 }],
    ['appletv_appli', { source: '' }],
    ['appletv_appli', { source: 42 }],
    ['appletv_appli', null],
  ];
  for (const reelles of [false, true]) {
    const { connexion, actions } = preparer({ reelles });
    for (const [nom, corps] of invalides) {
      await assert.rejects(actions.executer(nom, corps), (err) => {
        assert.equal(err.statusCode, 400, `${nom} ${JSON.stringify(corps)}`);
        assert.equal(err.code, 'corps_invalide');
        return true;
      });
    }
    assert.deepEqual(connexion.appels, []);
  }
  assert.ok(TOUCHES_APPLE_TV.every((touche) => /^[a-z_]+$/.test(touche)) && TOUCHES_TELE.every((touche) => /^[A-Z_]+$/.test(touche)));
});

test('appli : seule une source de la source_list ACTUELLE passe ; liste inconnue = 503 ; rien d\'appelé sinon', async () => {
  for (const reelles of [false, true]) {
    const { connexion, actions } = preparer({ reelles, entites: entitesAvecApplis(['Netflix', 'YouTube']) });
    for (const source of ['Prime Video', 'netflix', 'Netflix ', 'Réglages']) {
      await assert.rejects(actions.executer('appletv_appli', { source }), { statusCode: 400, code: 'corps_invalide' }, source);
    }
    const sansListe = preparer({ reelles, entites: { valeur: {} } });
    await assert.rejects(sansListe.actions.executer('appletv_appli', { source: 'Netflix' }), { statusCode: 503, code: 'applis_inconnues' });
    assert.deepEqual([...connexion.appels, ...sansListe.connexion.appels], []);
    assert.deepEqual(await actions.executer('appletv_appli', { source: 'YouTube' }), { ok: true, simulation: !reelles });
  }
});

test('connait et telecommande : seules les deux actions de touches sont des télécommandes', () => {
  const { actions } = preparer();
  assert.deepEqual(['appletv_touche', 'appletv_appli', 'tv_touche', 'sonnette_direct', 'courses_ajouter', '__proto__', 'constructor', undefined]
    .map((nom) => [actions.connait(nom), actions.telecommande(nom)]),
  [[true, true], [true, false], [true, true], [true, false], [false, false], [false, false], [false, false], [false, false]]);
});

// Route : actions maison simulées montées sur l'application, entités réelles de la fixture (source_list) ; courses
// simulées sur une vraie SourceCourses (aucune connexion appelée) pour comparer les limites.
async function monterRoute(t, options = {}) {
  const entites = new FausseSource(Object.fromEntries(etats.map((etat) => [etat.entity_id, { state: etat.state, last_changed: etat.last_changed, attributes: etat.attributes }])));
  const courses = new SourceCourses(fausseConnexion(), new EventEmitter(), journalCapture());
  const monte = await monter({ sources: { entites, courses }, ...options });
  t.after(() => monte.app.close());
  const poster = (nom, corps) => monte.app.inject({
    method: 'POST', url: `/api/action/${nom}`, headers: { 'x-cadre-cle': CLE, 'content-type': 'application/json' }, payload: corps,
  });
  return { ...monte, poster };
}

test('route : action maison simulée 200, corps refusé 400, alarme 404, sans clé 401', async (t) => {
  const { app, poster, journal } = await monterRoute(t);
  let reponse = await poster('appletv_touche', { touche: 'home' });
  assert.equal(reponse.statusCode, 200);
  assert.deepEqual(reponse.json(), { ok: true, simulation: true });
  assert.equal(reponse.headers['cache-control'], 'no-store');
  assert.equal((await poster('appletv_appli', { source: 'Disney+' })).statusCode, 200);
  reponse = await poster('appletv_appli', { source: 'Inconnue' });
  assert.equal(reponse.statusCode, 400);
  assert.match(reponse.json().message, /n'est pas dans la liste des applis/);
  assert.equal((await poster('alarme_desarmer', { code: '0000' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/api/action/tv_touche', payload: { touche: 'HOME' } })).statusCode, 401);
  assert.match(journal(), /simulation : appletv_touche \(remote\.send_command sur remote\.sejour_sejour/);
});

test('route : télécommandes à 10 par seconde, hors limite dédiée (60/min) et hors limite globale (300/min)', async (t) => {
  const { app, poster } = await monterRoute(t);
  const menu = () => app.inject({ method: 'GET', url: '/api/menu', headers: { 'x-cadre-cle': CLE } });
  for (let i = 0; i < 10; i += 1) assert.equal((await poster('tv_touche', { touche: 'VOLUME_UP' })).statusCode, 200, `touche ${i + 1}`);
  const refus = await poster('tv_touche', { touche: 'VOLUME_UP' });
  assert.equal(refus.statusCode, 429, '11e touche dans la même seconde');
  assert.ok(Number(refus.headers['retry-after']) >= 1);
  assert.equal((await poster('courses_ajouter', { texte: 'lait' })).statusCode, 200, 'les courses ne sont pas bloquées');
  assert.equal((await menu()).statusCode, 200);

  await new Promise((resoudre) => setTimeout(resoudre, 1100));
  for (let i = 0; i < 10; i += 1) assert.equal((await poster('appletv_touche', { touche: 'right' })).statusCode, 200, `seconde suivante, touche ${i + 1}`);
  // 21 touches envoyées : si elles comptaient dans la limite dédiée, la 40e action de courses serait refusée.
  for (let i = 1; i < 60; i += 1) assert.equal((await poster('courses_ajouter', { texte: `article ${i}` })).statusCode, 200, `action ${i + 1}`);
  assert.equal((await poster('courses_ajouter', { texte: 'de trop' })).statusCode, 429, 'la 61e action de la minute est refusée');
  // Limite globale : 62 requêtes comptées jusqu'ici (61 actions, 1 menu), les touches non ; 238 de plus atteignent 300.
  for (let i = 0; i < 238; i += 1) assert.equal((await menu()).statusCode, 200, `requête ${i + 63}`);
  assert.equal((await menu()).statusCode, 429, 'la 301e requête comptée est refusée');
});

test('route : une requête SANS clé vers une touche est plafonnée elle aussi (compteur de contexte, avant la clé)', async (t) => {
  const { app } = await monterRoute(t);
  const codes = [];
  for (let i = 0; i < 12; i += 1) {
    codes.push((await app.inject({ method: 'POST', url: '/api/action/appletv_touche', payload: { touche: 'up' } })).statusCode);
  }
  assert.deepEqual(codes, [...Array(10).fill(401), 429, 429]);
});
