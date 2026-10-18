// tests/actions.test.js
//
// Rôle    : prouver la liste blanche des actions (serveur/ha/actions.js) et sa route (serveur/routes/actions.js) :
//           domaines, services et entités interdits refusés ; simulation par défaut SANS aucun appel à la
//           connexion HA, avec la copie locale des courses mise à jour (et rejouée après une relecture) ;
//           ACTIONS_REELLES=1 appelle le bon service sur le bon entity_id puis relit la liste ; corps invalides
//           refusés (400, dont les caractères invisibles : demi-paire isolée, C1, saut de ligne Unicode, bidi),
//           noms inconnus refusés (404), échec de HA rendu en 502, limite dédiée de 60 par minute.
// Entrées : une fausse connexion HA qui note chaque appel (lire, ecrire) ; une vraie SourceCourses par-dessus.
// Sorties : node --test.
// Pièges  : la fausse connexion n'est pas une ConnexionHA : son garde-fou d'écriture (ACTIONS_REELLES, liste des
//           services) est prouvé à part dans tests/connexion.test.js. Ici, on prouve que actions.js n'appelle
//           JAMAIS la connexion en simulation, et l'appelle comme il faut en réel.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { ACTIONS, creerActions, ErreurAction, verifierActions } from '../serveur/ha/actions.js';
import { SourceCourses } from '../serveur/ha/courses.js';
import { CLE, CLE_CLEVO, monter } from './aides.js';

const LISTE_HA = [
  { uid: 'a1', summary: 'lait', status: 'needs_action' },
  { uid: 'b2', summary: 'pain', status: 'completed' },
];

function journalCapture() {
  const lignes = [];
  return { lignes, info: (m) => lignes.push(m), warn: (m) => lignes.push(m), error: (m) => lignes.push(m) };
}

// Fausse connexion : note tout ; lire renvoie LISTE_HA ; ecrire réussit ou échoue selon echecEcriture.
function fausseConnexion({ echecEcriture = null } = {}) {
  const connexion = new EventEmitter();
  connexion.etat = 'ok';
  connexion.appels = [];
  connexion.lire = async (service, entite, donnees) => {
    connexion.appels.push({ methode: 'lire', service, entite, donnees });
    return { items: structuredClone(LISTE_HA) };
  };
  connexion.ecrire = async (service, entite, donnees) => {
    connexion.appels.push({ methode: 'ecrire', service, entite, donnees });
    if (echecEcriture) throw new Error(echecEcriture);
  };
  return connexion;
}

function preparer({ reelles = false, echecEcriture } = {}) {
  const connexion = fausseConnexion({ echecEcriture });
  const journal = journalCapture();
  const courses = new SourceCourses(connexion, new EventEmitter(), journal);
  const actions = creerActions({ connexion, courses, reelles, journal });
  return { connexion, courses, actions, journal };
}

test('la table ne contient que les 4 services todo sur todo.shopping_list', () => {
  assert.deepEqual(Object.keys(ACTIONS), ['courses_ajouter', 'courses_cocher', 'courses_supprimer', 'courses_vider_coches']);
  for (const { domaine, service, entity_id: entite } of Object.values(ACTIONS)) {
    assert.equal(domaine, 'todo');
    assert.ok(['add_item', 'update_item', 'remove_item', 'remove_completed_items'].includes(service), service);
    assert.equal(entite, 'todo.shopping_list');
  }
  assert.doesNotThrow(() => verifierActions(ACTIONS));
});

test('domaines, services et entités interdits refusés par verifierActions (tout le domaine alarm_control_panel, scripts hors liste)', () => {
  const action = (domaine, service, entite) => ({ x: { domaine, service, entity_id: entite } });
  const interdits = [
    [action('notify', 'notify', 'notify.mobile_app'), /domaine interdit notify/],
    [action('shell_command', 'reboot', 'shell_command.reboot'), /domaine interdit shell_command/],
    [action('script', 'turn_on', 'script.quelconque'), /script non permis script\.quelconque/],
    [action('script', 'turn_on', 'script.sonnette_direct'), /script non permis script\.sonnette_direct/],
    [action('remote', 'turn_off', 'remote.sejour_sejour'), /service interdit remote\.turn_off/],
    [action('switch', 'turn_off', 'switch.freebox_v9_r1_wi_fi'), /entité interdite switch\.freebox_v9_r1_wi_fi/],
    [action('button', 'press', 'button.freebox_reboot'), /entité interdite button\.freebox_reboot/],
    [action('alarm_control_panel', 'alarm_disarm', 'alarm_control_panel.alarm_center'), /domaine interdit alarm_control_panel/],
    [action('alarm_control_panel', 'alarm_arm_home', 'alarm_control_panel.alarme_maison'), /domaine interdit alarm_control_panel/],
    [action('remote', 'send_command', 'alarm_control_panel.alarme_maison'), /entité interdite alarm_control_panel\.alarme_maison/],
    [action('select', 'select_option', 'select.alarm_center_guard_mode'), /entité interdite select\.alarm_center_guard_mode/],
    [action('todo', 'add_item', 'switch.cuisine'), /switch\.cuisine n'est pas du domaine todo/],
  ];
  for (const [table, motif] of interdits) assert.throws(() => verifierActions(table), motif);
});

test('simulation par défaut : aucun appel à la connexion HA, copie locale mise à jour, journal « simulation »', async () => {
  const { connexion, courses, actions, journal } = preparer();
  const maj = [];
  courses.on('maj', (valeur) => maj.push(valeur));

  assert.deepEqual(await actions.executer('courses_ajouter', { texte: '  crème fraîche ' }), { ok: true, simulation: true });
  const [ajoute] = courses.valeur.articles;
  assert.match(ajoute.uid, /^simulation-[0-9a-f]{8}$/);
  assert.deepEqual(ajoute, { uid: ajoute.uid, summary: 'crème fraîche', status: 'needs_action' });

  assert.deepEqual(await actions.executer('courses_cocher', { uid: ajoute.uid, fait: true }), { ok: true, simulation: true });
  assert.equal(courses.valeur.articles[0].status, 'completed');
  await actions.executer('courses_cocher', { uid: ajoute.uid, fait: false });
  assert.equal(courses.valeur.articles[0].status, 'needs_action');
  await actions.executer('courses_ajouter', { texte: 'œufs' });
  await actions.executer('courses_cocher', { uid: ajoute.uid, fait: true });
  await actions.executer('courses_vider_coches', {});
  assert.deepEqual(courses.valeur.articles.map((a) => a.summary), ['œufs']);
  await actions.executer('courses_supprimer', { uid: courses.valeur.articles[0].uid });
  assert.deepEqual(courses.valeur, { articles: [] });

  assert.deepEqual(connexion.appels, [], 'la connexion HA ne doit jamais être appelée en simulation');
  assert.equal(maj.length, 7);
  assert.equal(journal.lignes.filter((l) => /^simulation : courses_\w+ \(todo\.\w+ sur todo\.shopping_list\), rien n'est écrit dans Home Assistant$/.test(l)).length, 7);
});

test('simulation : les actions simulées survivent à la relecture périodique de HA', async () => {
  const { courses, actions } = preparer();
  await courses.actualiser();
  assert.deepEqual(courses.valeur, { articles: LISTE_HA });
  await actions.executer('courses_cocher', { uid: 'a1', fait: true });
  await actions.executer('courses_ajouter', { texte: 'beurre' });
  await actions.executer('courses_supprimer', { uid: 'b2' });
  await courses.actualiser();
  assert.deepEqual(courses.valeur.articles.map(({ summary, status }) => [summary, status]), [['lait', 'completed'], ['beurre', 'needs_action']]);
});

// Fausse connexion dont la liste « HA » change entre deux lectures (ce que fait un iPhone pour de vrai).
function preparerHaChangeant(liste) {
  const { connexion, courses, actions } = preparer();
  const etat = { liste };
  connexion.lire = async () => ({ items: structuredClone(etat.liste) });
  return { courses, actions, etat };
}
const vu = (courses) => courses.valeur.articles.map(({ summary, status }) => `${summary}:${status}`);

test('simulation : « vider les cochés » est figé au geste, un article coché ensuite sur l\'iPhone reste visible (coché)', async () => {
  const { courses, actions, etat } = preparerHaChangeant([
    { uid: 'l1', summary: 'lait', status: 'needs_action' },
    { uid: 'p1', summary: 'pain', status: 'completed' },
    { uid: 'o1', summary: 'œufs', status: 'needs_action' },
  ]);
  await courses.actualiser();
  await actions.executer('courses_vider_coches', {});
  assert.deepEqual(vu(courses), ['lait:needs_action', 'œufs:needs_action']);
  etat.liste = [
    { uid: 'l1', summary: 'lait', status: 'completed' },
    { uid: 'p1', summary: 'pain', status: 'completed' },
    { uid: 'o1', summary: 'œufs', status: 'completed' },
  ];
  await courses.actualiser();
  assert.deepEqual(vu(courses), ['lait:completed', 'œufs:completed'], 'seul le pain, coché au geste, reste retiré');
});

test('simulation : une coche simulée tient aux relectures, mais s\'efface pour de bon dès que HA change l\'article', async () => {
  const { courses, actions, etat } = preparerHaChangeant([{ uid: 'l1', summary: 'lait', status: 'needs_action' }]);
  await courses.actualiser();
  await actions.executer('courses_cocher', { uid: 'l1', fait: true });
  await courses.actualiser();
  assert.deepEqual(vu(courses), ['lait:completed'], 'HA inchangé : la coche simulée reste (pas de retour en arrière)');
  etat.liste = [{ uid: 'l1', summary: 'lait', status: 'completed' }];
  await courses.actualiser();
  etat.liste = [{ uid: 'l1', summary: 'lait', status: 'needs_action' }];
  await courses.actualiser();
  assert.deepEqual(vu(courses), ['lait:needs_action'], 'coché puis décoché sur l\'iPhone : HA a le dernier mot');
});

test('simulation : la coche d\'un article ajouté en simulation tient (il n\'existe pas dans HA)', async () => {
  const { courses, actions } = preparerHaChangeant([]);
  await courses.actualiser();
  await actions.executer('courses_ajouter', { texte: 'beurre' });
  await actions.executer('courses_cocher', { uid: courses.valeur.articles[0].uid, fait: true });
  await courses.actualiser();
  assert.deepEqual(vu(courses), ['beurre:completed']);
});

test('simulation : un article introuvable donne un échec (502), comme HA', async () => {
  const { actions } = preparer();
  await assert.rejects(actions.executer('courses_cocher', { uid: 'inconnu', fait: true }), (err) => {
    assert.ok(err instanceof ErreurAction);
    assert.equal(err.statusCode, 502);
    assert.equal(err.code, 'action_echouee');
    assert.match(err.message, /article introuvable/);
    return true;
  });
});

test('ACTIONS_REELLES=1 : le bon service sur todo.shopping_list, puis la liste est relue', async () => {
  const { connexion, courses, actions } = preparer({ reelles: true });
  const cas = [
    ['courses_ajouter', { texte: ' lait ' }, 'todo.add_item', { item: 'lait' }],
    ['courses_cocher', { uid: 'a1', fait: true }, 'todo.update_item', { item: 'a1', status: 'completed' }],
    ['courses_cocher', { uid: 'a1', fait: false }, 'todo.update_item', { item: 'a1', status: 'needs_action' }],
    ['courses_supprimer', { uid: 'b2' }, 'todo.remove_item', { item: 'b2' }],
    ['courses_vider_coches', {}, 'todo.remove_completed_items', {}],
  ];
  for (const [nom, corps, service, donnees] of cas) {
    connexion.appels = [];
    assert.deepEqual(await actions.executer(nom, corps), { ok: true, simulation: false }, nom);
    assert.deepEqual(connexion.appels, [
      { methode: 'ecrire', service, entite: 'todo.shopping_list', donnees },
      { methode: 'lire', service: 'todo.get_items', entite: 'todo.shopping_list', donnees: { status: ['needs_action', 'completed'] } },
    ], nom);
  }
  assert.deepEqual(courses.valeur, { articles: LISTE_HA });
});

test('ACTIONS_REELLES=1 : un refus de HA donne 502, sans relecture', async () => {
  const { connexion, actions, journal } = preparer({ reelles: true, echecEcriture: 'todo.add_item : non connecté' });
  await assert.rejects(actions.executer('courses_ajouter', { texte: 'lait' }), { statusCode: 502, code: 'action_echouee' });
  assert.deepEqual(connexion.appels.map((a) => a.methode), ['ecrire']);
  assert.match(journal.lignes.join('\n'), /courses_ajouter : échec de todo\.add_item/);
});

test('corps invalides refusés (400) avant tout appel, en simulation comme en réel', async () => {
  const invalides = [
    ['courses_ajouter', {}],
    ['courses_ajouter', { texte: '' }],
    ['courses_ajouter', { texte: '   ' }],
    ['courses_ajouter', { texte: 'x'.repeat(61) }],
    ['courses_ajouter', { texte: 'lait\nbeurre' }],
    ['courses_ajouter', { texte: '\uD800' }],
    ['courses_ajouter', { texte: 'lait \uDC00' }],
    ['courses_ajouter', { texte: 'lait\u0085' }],
    ['courses_ajouter', { texte: 'lait\u2028beurre' }],
    ['courses_ajouter', { texte: 'lait\u202e' }],
    ['courses_ajouter', { texte: '\u2066lait\u2069' }],
    ['courses_ajouter', { texte: 42 }],
    ['courses_ajouter', { texte: 'lait', entity_id: 'switch.freebox_v9_r1_wi_fi' }],
    ['courses_cocher', { uid: 'a1' }],
    ['courses_cocher', { uid: 'a1', fait: 'oui' }],
    ['courses_cocher', { uid: '../a1', fait: true }],
    ['courses_supprimer', { uid: '' }],
    ['courses_supprimer', { uid: 'x'.repeat(65) }],
    ['courses_vider_coches', { tout: true }],
    ['courses_ajouter', null],
    ['courses_ajouter', ['lait']],
  ];
  for (const reelles of [false, true]) {
    const { connexion, actions } = preparer({ reelles });
    for (const [nom, corps] of invalides) {
      await assert.rejects(actions.executer(nom, corps), (err) => {
        assert.equal(err.statusCode, 400, `${nom} ${JSON.stringify(corps)}`);
        assert.equal(err.code, 'corps_invalide');
        assert.match(err.message, new RegExp(`^corps invalide pour ${nom}, attendu : `));
        return true;
      });
    }
    assert.deepEqual(connexion.appels, []);
  }
  const { actions } = preparer();
  assert.deepEqual(await actions.executer('courses_ajouter', { texte: 'x'.repeat(60) }), { ok: true, simulation: true });
  assert.deepEqual(await actions.executer('courses_ajouter', { texte: 'crème fraîche 🥛 « bio »' }), { ok: true, simulation: true }, 'un émoji (paire complète) et les accents passent');
});

test('noms inconnus refusés (404), y compris ceux du prototype et les actions prévues plus tard', async () => {
  const { connexion, actions } = preparer({ reelles: true });
  for (const nom of ['inconnue', 'constructor', '__proto__', 'toString', 'alarme_desarmer', 'tv_touche', 'courses_ajouter ']) {
    await assert.rejects(actions.executer(nom, {}), { statusCode: 404, code: 'action_inconnue' }, nom);
  }
  assert.deepEqual(connexion.appels, []);
});

test('route POST /api/action/:nom : 200 simulé, 400, 404, JSON mal formé, clé exigée (cadre ou Clevo)', async (t) => {
  const connexion = fausseConnexion();
  const courses = new SourceCourses(connexion, new EventEmitter(), journalCapture());
  const { app } = await monter({ sources: { courses } });
  t.after(() => app.close());
  const poster = (url, corps, cle = CLE) => app.inject({
    method: 'POST', url, headers: { 'x-cadre-cle': cle, 'content-type': 'application/json' }, payload: corps,
  });

  let reponse = await poster('/api/action/courses_ajouter', { texte: 'lait' });
  assert.equal(reponse.statusCode, 200);
  assert.deepEqual(reponse.json(), { ok: true, simulation: true });
  assert.equal(reponse.headers['cache-control'], 'no-store');
  assert.equal((await poster('/api/action/courses_ajouter', { texte: 'pain' }, CLE_CLEVO)).statusCode, 200);
  assert.deepEqual(courses.valeur.articles.map((a) => a.summary), ['lait', 'pain']);

  reponse = await poster('/api/action/courses_ajouter', { texte: '' });
  assert.equal(reponse.statusCode, 400);
  assert.equal(reponse.json().erreur, 'corps_invalide');
  reponse = await poster('/api/action/alarme_desarmer', { code: '1234' });
  assert.equal(reponse.statusCode, 404);
  assert.equal(reponse.json().erreur, 'action_inconnue');
  assert.equal((await poster('/api/action/courses_ajouter', '{ pas du JSON')).statusCode, 400);
  const sansCorps = await app.inject({ method: 'POST', url: '/api/action/courses_vider_coches', headers: { 'x-cadre-cle': CLE } });
  assert.deepEqual(sansCorps.json(), { ok: true, simulation: true });
  assert.equal((await app.inject({ method: 'GET', url: '/api/action/courses_ajouter', headers: { 'x-cadre-cle': CLE } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/api/action/courses_ajouter', payload: { texte: 'lait' } })).statusCode, 401);
  assert.deepEqual(connexion.appels, [], 'aucune requête à HA en simulation');
});

test('route : un échec de HA en réel donne 502 { erreur: "action_echouee" }', async (t) => {
  const { connexion, courses, actions } = preparer({ reelles: true, echecEcriture: 'refusé par HA' });
  const { app } = await monter({ sources: { courses }, actions });
  t.after(() => app.close());
  const reponse = await app.inject({ method: 'POST', url: '/api/action/courses_ajouter', headers: { 'x-cadre-cle': CLE }, payload: { texte: 'lait' } });
  assert.equal(reponse.statusCode, 502);
  assert.deepEqual(reponse.json(), { erreur: 'action_echouee', message: 'refusé par HA' });
  assert.equal(connexion.appels.length, 1);
});

test('route : limite dédiée de 60 actions par minute et par IP, à part de la limite globale', async (t) => {
  const courses = new SourceCourses(fausseConnexion(), new EventEmitter(), journalCapture());
  const { app } = await monter({ sources: { courses } });
  t.after(() => app.close());
  for (let i = 0; i < 60; i += 1) {
    const reponse = await app.inject({ method: 'POST', url: '/api/action/inconnue', headers: { 'x-cadre-cle': CLE }, payload: {} });
    assert.equal(reponse.statusCode, 404, `action ${i + 1}`);
  }
  const refus = await app.inject({ method: 'POST', url: '/api/action/courses_ajouter', headers: { 'x-cadre-cle': CLE }, payload: { texte: 'lait' } });
  assert.equal(refus.statusCode, 429);
  assert.match(refus.json().message, /^Trop de requêtes, réessayer dans \d+ s$/);
  assert.ok(Number(refus.headers['retry-after']) > 0);
  assert.equal((await app.inject({ method: 'GET', url: '/api/menu', headers: { 'x-cadre-cle': CLE } })).statusCode, 200, 'le reste de /api reste ouvert');
  assert.equal(courses.valeur, null, 'l\'action refusée n\'a rien fait');
});
