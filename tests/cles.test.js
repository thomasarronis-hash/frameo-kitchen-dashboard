// tests/cles.test.js
//
// Rôle    : prouver les deux clés d'appareil (serveur/securite.js, serveur/app.js) et les routes de l'état local
//           (serveur/routes/etat.js, serveur/routes/courses.js) : la clé du cadre et celle du Clevo ouvrent les
//           routes communes ; GET /api/etat et GET /api/courses sont réservés au Clevo (403 avec la clé du cadre) ;
//           chaque clé se révoque seule ; le drapeau « Prêt pour le drive » s'écrit dans data/etat/drive.json et se
//           relit par /api/etat, y compris sur des appuis simultanés ; une erreur imprévue sous /api répond 500
//           sans son message (chemins du serveur), journalisé en entier ; les clés ne sortent jamais dans les
//           journaux.
// Entrées : application montée par tests/aides.js ; un dossier d'état temporaire (os.tmpdir(), donc TMPDIR).
// Sorties : node --test.
// Pièges  : la révocation se prouve en remontant l'application avec une autre clé du Clevo : c'est ce que fait
//           un redémarrage du serveur après le changement du fichier de clé.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Fastify from 'fastify';
import application from '../serveur/app.js';
import { creerActions } from '../serveur/ha/actions.js';
import { creerActionsClim } from '../serveur/ha/actions-clim.js';
import { creerActionsMaison } from '../serveur/ha/actions-maison.js';
import { creerActionsVoiture } from '../serveur/ha/actions-voiture.js';
import { SourceCourses } from '../serveur/ha/courses.js';
import { optionsJournal } from '../serveur/securite.js';
import { CLE, CLE_CLEVO, FausseSource, monter, VERSION } from './aides.js';

const CADRE = { 'x-cadre-cle': CLE };
const CLEVO = { 'x-cadre-cle': CLE_CLEVO };
const ARTICLES = { articles: [{ uid: 'a1', summary: 'lait', status: 'needs_action' }] };

function dossierEtat(t) {
  const dossier = mkdtempSync(join(tmpdir(), 'cadre-etat-'));
  t.after(() => rmSync(dossier, { recursive: true, force: true }));
  return join(dossier, 'etat');
}

// Vraie source de courses (les actions simulées y écrivent), lue une fois par une fausse lecture de HA.
async function sourceCourses() {
  const connexion = Object.assign(new EventEmitter(), { etat: 'ok', lire: async () => ({ items: structuredClone(ARTICLES.articles) }) });
  const courses = new SourceCourses(connexion, new EventEmitter(), { warn() {} });
  await courses.actualiser();
  return courses;
}

async function preparer(t, options = {}) {
  const monte = await monter({ sources: { courses: await sourceCourses() }, dossierEtat: dossierEtat(t), ...options });
  t.after(() => monte.app.close());
  return monte;
}

const appeler = (app, method, url, headers = {}) => app.inject({ method, url, headers });

test('routes communes : la clé du cadre comme celle du Clevo, en en-tête ou en cookie', async (t) => {
  const { app } = await preparer(t);
  for (const cle of [CLE, CLE_CLEVO]) {
    for (const headers of [{ 'x-cadre-cle': cle }, { cookie: `cadre_cle=${cle}` }]) {
      assert.equal((await appeler(app, 'GET', '/api/menu', headers)).statusCode, 200);
      assert.equal((await appeler(app, 'POST', '/api/drive-pret', headers)).statusCode, 200);
      assert.equal((await appeler(app, 'POST', '/api/action/courses_vider_coches', headers)).statusCode, 200);
    }
  }
});

test('GET /api/etat et GET /api/courses : réservés à la clé du Clevo (403 avec celle du cadre, 401 sans clé)', async (t) => {
  const { app, journal } = await preparer(t);
  for (const url of ['/api/etat', '/api/courses']) {
    const refus = await appeler(app, 'GET', url, CADRE);
    assert.equal(refus.statusCode, 403, url);
    assert.deepEqual(refus.json(), { erreur: 'reserve_clevo', message: 'Route réservée au Clevo' });
    assert.equal((await appeler(app, 'GET', url, { cookie: `cadre_cle=${CLE}` })).statusCode, 403, `${url} par cookie`);
    assert.equal((await appeler(app, 'GET', url)).statusCode, 401, url);
    assert.equal((await appeler(app, 'GET', url, CLEVO)).statusCode, 200, url);
  }
  assert.deepEqual((await appeler(app, 'GET', '/api/courses', CLEVO)).json(), ARTICLES);
  assert.match(journal(), /route réservée au Clevo demandée avec la clé « cadre »/);
  assert.ok(!journal().includes(CLE) && !journal().includes(CLE_CLEVO), 'clé trouvée dans les journaux');
});

test('en-tête et cookie de deux appareils différents : l\'en-tête l\'emporte', async (t) => {
  const { app } = await preparer(t);
  assert.equal((await appeler(app, 'GET', '/api/etat', { ...CLEVO, cookie: `cadre_cle=${CLE}` })).statusCode, 200);
  assert.equal((await appeler(app, 'GET', '/api/etat', { ...CADRE, cookie: `cadre_cle=${CLE_CLEVO}` })).statusCode, 403);
  assert.equal((await appeler(app, 'GET', '/api/etat', { 'x-cadre-cle': 'fausse', cookie: `cadre_cle=${CLE_CLEVO}` })).statusCode, 200);
});

test('chaque clé se révoque seule : nouvelle clé du Clevo, l\'ancienne est refusée, celle du cadre marche toujours', async (t) => {
  const app = Fastify({ logger: optionsJournal({ flux: { write() {} } }) });
  t.after(() => app.close());
  const connexion = Object.assign(new EventEmitter(), { etat: 'ok' });
  const sources = { menu: new FausseSource(null), courses: new FausseSource(ARTICLES) };
  const nouvelle = 'nouvelle-cle-clevo-0123456789abcdef0123456789';
  await app.register(application, {
    cles: { cadre: CLE, clevo: nouvelle }, version: VERSION, dossierWeb: '/inexistant', connexion, sources,
    actions: creerActions({ connexion, courses: sources.courses, reelles: false, journal: app.log }),
    actionsMaison: creerActionsMaison({ connexion, entites: { valeur: {} }, reelles: false, journal: app.log }),
    actionsVoiture: creerActionsVoiture({ connexion, voitures: [], source: { valeur: [] }, reelles: false, journal: app.log }),
    actionsClim: creerActionsClim({ connexion, clims: [], source: { valeur: [] }, reelles: false, journal: app.log }),
    dossierEtat: dossierEtat(t),
  });
  assert.equal((await appeler(app, 'GET', '/api/etat', CLEVO)).statusCode, 401, 'ancienne clé du Clevo révoquée');
  assert.equal((await appeler(app, 'GET', '/api/etat', { 'x-cadre-cle': nouvelle })).statusCode, 200);
  assert.equal((await appeler(app, 'GET', '/api/menu', CADRE)).statusCode, 200, 'la clé du cadre n\'est pas touchée');
});

test('Prêt pour le drive : POST écrit drive.json, GET /api/etat le relit ; null avant le premier appui', async (t) => {
  const etat = dossierEtat(t);
  const { app } = await preparer(t, { dossierEtat: etat });
  assert.deepEqual((await appeler(app, 'GET', '/api/etat', CLEVO)).json(), { drive_pret_le: null });
  const avant = Date.now();
  const pose = await appeler(app, 'POST', '/api/drive-pret', CADRE);
  assert.equal(pose.statusCode, 200);
  const { pret_le: pretLe } = pose.json();
  assert.ok(Math.abs(Date.parse(pretLe) - avant) < 5_000);
  assert.match(pretLe, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(JSON.parse(readFileSync(join(etat, 'drive.json'), 'utf8')), { pret_le: pretLe });
  assert.deepEqual((await appeler(app, 'GET', '/api/etat', CLEVO)).json(), { drive_pret_le: pretLe });
});

test('drive.json abîmé : drapeau à null et avertissement, pas d\'erreur 500', async (t) => {
  const etat = dossierEtat(t);
  const { app, journal } = await preparer(t, { dossierEtat: etat });
  await appeler(app, 'POST', '/api/drive-pret', CADRE);
  writeFileSync(join(etat, 'drive.json'), '{ abîmé');
  const reponse = await appeler(app, 'GET', '/api/etat', CLEVO);
  assert.equal(reponse.statusCode, 200);
  assert.deepEqual(reponse.json(), { drive_pret_le: null });
  assert.match(journal(), /drive\.json illisible, drapeau ignoré/);
  writeFileSync(join(etat, 'drive.json'), '{"pret_le":"hier"}');
  assert.deepEqual((await appeler(app, 'GET', '/api/etat', CLEVO)).json(), { drive_pret_le: null });
});

test('Prêt pour le drive : 6 appuis simultanés (cadre et Clevo) réussissent tous, sans fichier caché restant', async (t) => {
  const etat = dossierEtat(t);
  const { app } = await preparer(t, { dossierEtat: etat });
  const reponses = await Promise.all(Array.from({ length: 6 }, (_v, i) => appeler(app, 'POST', '/api/drive-pret', i % 2 ? CADRE : CLEVO)));
  assert.deepEqual(reponses.map((r) => r.statusCode), [200, 200, 200, 200, 200, 200]);
  assert.deepEqual(readdirSync(etat), ['drive.json']);
});

test('erreur imprévue sous /api : 500 { erreur: "erreur_interne" }, sans le message ni le chemin ; journalisée en entier', async (t) => {
  const racine = mkdtempSync(join(tmpdir(), 'cadre-etat-'));
  t.after(() => rmSync(racine, { recursive: true, force: true }));
  writeFileSync(join(racine, 'fichier'), '');
  const { app, journal } = await preparer(t, { dossierEtat: join(racine, 'fichier', 'etat') });
  const reponse = await appeler(app, 'POST', '/api/drive-pret', CADRE);
  assert.equal(reponse.statusCode, 500);
  assert.deepEqual(reponse.json(), { erreur: 'erreur_interne' });
  assert.ok(!reponse.body.includes(racine), 'aucun chemin du serveur dans la réponse');
  assert.match(journal(), /ENOTDIR/);
  assert.match(journal(), /erreur interne/);
});

test('GET /api/courses : 503 tant que la liste n\'a jamais été lue', async (t) => {
  const { app } = await preparer(t, { sources: { courses: new FausseSource(null) } });
  const reponse = await appeler(app, 'GET', '/api/courses', CLEVO);
  assert.equal(reponse.statusCode, 503);
  assert.equal(reponse.json().erreur, 'courses_indisponibles');
});

test('Prêt pour le drive : limite dédiée de 10 appuis par minute', async (t) => {
  const { app } = await preparer(t);
  for (let i = 0; i < 10; i += 1) assert.equal((await appeler(app, 'POST', '/api/drive-pret', CADRE)).statusCode, 200);
  assert.equal((await appeler(app, 'POST', '/api/drive-pret', CADRE)).statusCode, 429);
  assert.equal((await appeler(app, 'GET', '/api/etat', CLEVO)).statusCode, 200);
});
