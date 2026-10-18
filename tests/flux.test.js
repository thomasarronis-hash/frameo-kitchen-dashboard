// tests/flux.test.js
//
// Rôle    : prouver le flux SSE de serveur/routes/flux.js : format des événements, instantane à la
//           connexion (menu, modes des actions de courses, maison et voiture, direct vidéo et photos compris), maj à chaque
//           changement, événement menu dédié, ping avec retry: 3000 et heure_serveur, plusieurs clients,
//           nettoyage à la déconnexion, client qui ne lit plus coupé, et arrêt du serveur malgré des clients
//           encore connectés.
// Entrées : application montée par tests/aides.js avec de fausses sources ; ping réduit à 100 ms.
// Sorties : node --test.
// Pièges  : un vrai port est ouvert (127.0.0.1, port choisi par le système) : le flux ne finit jamais.
//           Le client qui ne lit plus est une socket TCP brute mise en pause : fetch lirait pour lui.

import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { test } from 'node:test';
import { creerActions } from '../serveur/ha/actions.js';
import { creerActionsClim } from '../serveur/ha/actions-clim.js';
import { creerActionsMaison } from '../serveur/ha/actions-maison.js';
import { creerActionsVoiture } from '../serveur/ha/actions-voiture.js';
import { evenementSSE } from '../serveur/routes/flux.js';
import { CLE, FausseSource, monter, ouvrirFlux } from './aides.js';

const AVEC_CLE = { 'x-cadre-cle': CLE };

async function demarrer(t, options = {}) {
  const sources = { meteo: new FausseSource({ horaire: [1] }), courses: new FausseSource(null) };
  const monte = await monter({ sources, ...options });
  const adresse = await monte.app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => monte.app.close());
  return { ...monte, url: `${adresse}/api/flux` };
}

// Attend dans le journal la ligne « client du flux déconnecté » qui donne ce nombre de clients restants.
async function attendreClients(journal, nombre) {
  for (let essai = 0; essai < 50; essai += 1) {
    if (journal().includes(`"clients":${nombre},"msg":"client du flux déconnecté"`)) return;
    await new Promise((resoudre) => setTimeout(resoudre, 20));
  }
  assert.fail(`aucune déconnexion journalisée avec ${nombre} client(s) restant(s)`);
}

test('format SSE : event, retry facultatif, une seule ligne data en JSON, ligne vide finale', () => {
  assert.equal(evenementSSE('maj', { a: 1 }), 'event: maj\ndata: {"a":1}\n\n');
  assert.equal(evenementSSE('ping', { heure_serveur: 5 }, { retry: 3000 }), 'event: ping\nretry: 3000\ndata: {"heure_serveur":5}\n\n');
  assert.equal(evenementSSE('maj', { texte: 'deux\nlignes' }).split('\n').filter((l) => l.startsWith('data: ')).length, 1);
});

test('instantane à la connexion : heure serveur, état HA, valeur de chaque source, retry 3000', async (t) => {
  const { url } = await demarrer(t);
  const flux = await ouvrirFlux(url, AVEC_CLE);
  const avant = Date.now();
  const premier = await flux.lireEvenement();
  flux.fermer();
  assert.equal(premier.nom, 'instantane');
  assert.equal(premier.retry, '3000');
  assert.deepEqual(Object.keys(premier.donnees), [
    'heure_serveur', 'ha', 'simulation', 'simulation_maison', 'simulation_voiture', 'simulation_clim', 'direct_video',
    'photos_configurees', 'empreinte', 'menu', 'meteo', 'courses',
  ]);
  assert.equal(premier.donnees.empreinte, null, 'pas de page servie dans ce test');
  assert.equal(premier.donnees.simulation, true, 'actions simulées par défaut (tests/aides.js)');
  assert.equal(premier.donnees.simulation_maison, true, 'actions maison simulées par défaut (tests/aides.js)');
  assert.equal(premier.donnees.simulation_voiture, true, 'commandes de la voiture simulées par défaut (tests/aides.js)');
  assert.equal(premier.donnees.simulation_clim, true, 'commandes des clims simulées par défaut (tests/aides.js)');
  assert.equal(premier.donnees.direct_video, false, 'pas de direct vidéo sans go2rtc configuré');
  assert.equal(premier.donnees.photos_configurees, false, 'pas de photos sans clé Immich');
  assert.equal(premier.donnees.menu, null);
  assert.ok(Math.abs(premier.donnees.heure_serveur - avant) < 5_000);
  assert.equal(premier.donnees.ha, 'ok');
  assert.deepEqual(premier.donnees.meteo, { horaire: [1] });
  assert.equal(premier.donnees.courses, null);
  assert.equal(flux.reponse.headers.get('cache-control'), 'no-store');
});

test('instantane : simulation vaut false quand les actions sont réelles (écran Courses sans « mode essai »)', async (t) => {
  const connexionReelle = { ecrire: async () => {} };
  const courses = new FausseSource(null);
  courses.actualiser = async () => {};
  const actions = creerActions({ connexion: connexionReelle, courses, reelles: true, journal: { info() {}, error() {} } });
  const { url } = await demarrer(t, { actions });
  const flux = await ouvrirFlux(url, AVEC_CLE);
  const premier = await flux.lireEvenement();
  flux.fermer();
  assert.equal(premier.donnees.simulation, false);
});

test('instantane : simulation_maison vaut false avec ACTIONS_MAISON=1, direct_video vrai avec un flux go2rtc, photos_configurees vrai avec une clé Immich', async (t) => {
  const actionsMaison = creerActionsMaison({ connexion: {}, entites: { valeur: {} }, reelles: true, journal: { info() {}, error() {} } });
  const directSonnette = { ouvrir: async () => { throw new Error('jamais appelé ici'); } };
  const immich = { lot: async () => { throw new Error('jamais appelé ici'); } };
  const { url } = await demarrer(t, { actionsMaison, directSonnette, immich });
  const flux = await ouvrirFlux(url, AVEC_CLE);
  const premier = await flux.lireEvenement();
  flux.fermer();
  assert.equal(premier.donnees.simulation, true, 'les courses restent simulées : garde-fous séparés');
  assert.equal(premier.donnees.simulation_maison, false);
  assert.equal(premier.donnees.simulation_voiture, true, 'la voiture reste simulée : garde-fous séparés');
  assert.equal(premier.donnees.direct_video, true);
  assert.equal(premier.donnees.photos_configurees, true);
});

test('instantane : simulation_voiture vaut false avec ACTIONS_VOITURE=1, les courses et la maison restent simulées', async (t) => {
  const actionsVoiture = creerActionsVoiture({
    connexion: {}, voitures: [], source: { valeur: [] }, reelles: true, journal: { info() {}, error() {} },
  });
  const { url } = await demarrer(t, { actionsVoiture });
  const flux = await ouvrirFlux(url, AVEC_CLE);
  const premier = await flux.lireEvenement();
  flux.fermer();
  assert.deepEqual([premier.donnees.simulation, premier.donnees.simulation_maison, premier.donnees.simulation_voiture], [true, true, false]);
  assert.equal(premier.donnees.simulation_clim, true, 'les clims restent simulées : garde-fous séparés');
});

test('instantane : simulation_clim vaut false avec ACTIONS_CLIM=1, les trois autres restent simulés', async (t) => {
  const actionsClim = creerActionsClim({
    connexion: {}, clims: [], source: { valeur: [] }, reelles: true, journal: { info() {}, error() {} },
  });
  const { url } = await demarrer(t, { actionsClim });
  const flux = await ouvrirFlux(url, AVEC_CLE);
  const premier = await flux.lireEvenement();
  flux.fermer();
  const { donnees } = premier;
  assert.deepEqual([donnees.simulation, donnees.simulation_maison, donnees.simulation_voiture, donnees.simulation_clim], [true, true, true, false]);
});

test('menu : sa mise à jour part sous l\'événement menu, avec les données { menu } d\'une maj', async (t) => {
  const { url, sources } = await demarrer(t);
  const flux = await ouvrirFlux(url, AVEC_CLE);
  await flux.lireEvenement();
  sources.menu.publier({ version: 1, cycle: { debut: '2026-10-10', fin: '2026-10-16' } });
  const evenement = await flux.lireEvenement();
  assert.equal(evenement.nom, 'menu');
  assert.deepEqual(evenement.donnees, { menu: { version: 1, cycle: { debut: '2026-10-10', fin: '2026-10-16' } } });
  sources.menu.publier(null);
  assert.deepEqual(await flux.lireEvenement(), { nom: 'menu', retry: undefined, donnees: { menu: null }, brut: 'event: menu\ndata: {"menu":null}\n\n' });
  flux.fermer();
});

test('maj : changement d\'une source, puis bascule de l\'état de HA', async (t) => {
  const { url, sources, connexion } = await demarrer(t);
  const flux = await ouvrirFlux(url, AVEC_CLE);
  await flux.lireEvenement();
  sources.courses.publier({ articles: [{ uid: 'u1', summary: 'crème fraîche', status: 'needs_action' }] });
  const majCourses = await flux.lireEvenement();
  assert.equal(majCourses.nom, 'maj');
  assert.deepEqual(majCourses.donnees, { courses: { articles: [{ uid: 'u1', summary: 'crème fraîche', status: 'needs_action' }] } });
  connexion.etat = 'ko';
  connexion.emit('etat', 'ko');
  assert.deepEqual((await flux.lireEvenement()).donnees, { ha: 'ko' });
  flux.fermer();
});

test('ping régulier avec retry 3000 et heure_serveur', async (t) => {
  const { url } = await demarrer(t, { intervallePingMs: 100 });
  const flux = await ouvrirFlux(url, AVEC_CLE);
  await flux.lireEvenement();
  const ping = await flux.lireEvenement();
  flux.fermer();
  assert.equal(ping.nom, 'ping');
  assert.equal(ping.retry, '3000');
  assert.deepEqual(Object.keys(ping.donnees), ['heure_serveur']);
  assert.ok(Math.abs(ping.donnees.heure_serveur - Date.now()) < 5_000);
});

test('plusieurs clients reçoivent la même maj, un client parti est retiré', async (t) => {
  const { url, sources, journal } = await demarrer(t);
  const premier = await ouvrirFlux(url, AVEC_CLE);
  const second = await ouvrirFlux(url, AVEC_CLE);
  await premier.lireEvenement();
  await second.lireEvenement();

  sources.meteo.publier({ horaire: [2] });
  assert.deepEqual((await premier.lireEvenement()).donnees, { meteo: { horaire: [2] } });
  assert.deepEqual((await second.lireEvenement()).donnees, { meteo: { horaire: [2] } });

  premier.fermer();
  await attendreClients(journal, 1);
  sources.meteo.publier({ horaire: [3] });
  assert.deepEqual((await second.lireEvenement()).donnees, { meteo: { horaire: [3] } });
  second.fermer();
  await attendreClients(journal, 0);
  assert.equal(sources.meteo.listenerCount('maj'), 1, 'un seul écouteur par source, quel que soit le nombre de clients');
});

test('un client qui ne lit plus est coupé une fois 256 Ko en attente, les autres continuent', async (t) => {
  const { url, sources, journal } = await demarrer(t);
  const lecteur = await ouvrirFlux(url, AVEC_CLE);
  await lecteur.lireEvenement();
  const fige = net.connect(Number(new URL(url).port), '127.0.0.1');
  t.after(() => fige.destroy());
  fige.write(`GET /api/flux HTTP/1.1\r\nHost: test\r\nX-Cadre-Cle: ${CLE}\r\n\r\n`);
  await once(fige, 'data');
  fige.pause();

  // Le noyau absorbe d'abord quelques Mo : on publie jusqu'à la coupure (64 Mo au plus).
  const gros = 'x'.repeat(64 * 1024);
  for (let i = 0; i < 1000 && !journal().includes('ne lit plus'); i += 1) {
    sources.meteo.publier({ i, gros });
    await lecteur.lireEvenement();
    await new Promise((resoudre) => setImmediate(resoudre));
  }
  assert.ok(journal().includes('client du flux qui ne lit plus : connexion coupée'), 'client figé jamais coupé');
  await attendreClients(journal, 1);
  sources.meteo.publier({ fin: true });
  assert.deepEqual((await lecteur.lireEvenement()).donnees, { meteo: { fin: true } });
  lecteur.fermer();
});

test('app.close() termine malgré un client connecté, et retire les écouteurs des sources', async (t) => {
  const { app, url, sources } = await demarrer(t);
  const flux = await ouvrirFlux(url, AVEC_CLE);
  await flux.lireEvenement();
  const fermeture = app.close();
  await assert.rejects(flux.lireEvenement(), /flux terminé/);
  await fermeture;
  assert.equal(sources.meteo.listenerCount('maj'), 0);
});
