// tests/sources.test.js
//
// Rôle    : prouver le socle des sources (serveur/source.js) et les deux sources HA en lecture
//           (serveur/ha/meteo.js, serveur/ha/courses.js) : maj seulement sur changement, dernière valeur
//           gardée après un échec, une seule relecture en attente, nouvel essai rapproché après un échec,
//           horaire seul (le quotidien vient d'Open-Meteo), coupe à 48 h, champs projetés, statuts des
//           courses toujours passés, relecture sur changement d'entité.
// Entrées : une fausse connexion HA (EventEmitter avec etat et lire simulé) et une fausse SourceEntites.
// Sorties : node --test.
// Pièges  : les minuteries sont simulées (t.mock.timers) : tick() avance l'horloge sans attendre ; après un
//           tick, laisserFinir() vide les microtâches pour que la lecture asynchrone se termine (lire()
//           simulé ne dépend d'aucune minuterie). Node 22 signale MockTimers comme expérimental (avertissement).

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { SourceCourses } from '../serveur/ha/courses.js';
import { SourceMeteo } from '../serveur/ha/meteo.js';
import { REPRISES_MS, Source } from '../serveur/source.js';

const MINUTE = 60_000;

function journalCapture() {
  const lignes = [];
  return { lignes, info: (m) => lignes.push(m), warn: (m) => lignes.push(m), error: (m) => lignes.push(m) };
}

// Laisse les promesses en cours se résoudre (lire() simulé ne touche à aucune minuterie).
async function laisserFinir() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

// Source dont lire() rejoue une liste de réponses (une Error est levée) et compte ses appels.
class SourceEssai extends Source {
  constructor(reponses, journal = journalCapture()) {
    super('essai', journal);
    this.reponses = reponses;
    this.appels = 0;
  }

  async lire() {
    const reponse = this.reponses[Math.min(this.appels, this.reponses.length - 1)];
    this.appels += 1;
    if (reponse instanceof Error) throw reponse;
    return structuredClone(reponse);
  }
}

function compterMaj(source) {
  const maj = [];
  source.on('maj', (valeur) => maj.push(valeur));
  return maj;
}

test('Source : maj seulement quand la valeur change', async () => {
  const source = new SourceEssai([{ a: 1 }, { a: 1 }, { a: 2 }]);
  const maj = compterMaj(source);
  await source.actualiser();
  await source.actualiser();
  await source.actualiser();
  assert.deepEqual(maj, [{ a: 1 }, { a: 2 }]);
});

test('Source : un échec garde la dernière valeur et se journalise', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const journal = journalCapture();
  const source = new SourceEssai([{ a: 1 }, new Error('HA en panne')], journal);
  const maj = compterMaj(source);
  await source.actualiser();
  await source.actualiser();
  source.arreter();
  assert.deepEqual(source.valeur, { a: 1 });
  assert.equal(maj.length, 1);
  assert.match(journal.lignes.join('\n'), /essai : lecture échouée, dernière valeur gardée, nouvel essai dans 30 s \(HA en panne\)/);
});

test('Source : demandes rapprochées, une seule lecture à la fois et une seule relecture en attente', async () => {
  let liberer;
  let appels = 0;
  const source = new (class extends Source {
    async lire() {
      appels += 1;
      if (appels === 1) await new Promise((resoudre) => { liberer = resoudre; });
      return appels;
    }
  })('essai', journalCapture());
  const enCours = source.actualiser();
  source.actualiser();
  source.actualiser();
  assert.equal(appels, 1, 'pas de seconde lecture pendant la première');
  liberer();
  await enCours;
  assert.equal(appels, 2, 'les deux demandes suivantes donnent UNE relecture');
});

test('Source : une relecture rejouée qui réussit efface l\'échec de la précédente (pas de nouvel essai)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let liberer;
  let appels = 0;
  const journal = journalCapture();
  const source = new (class extends Source {
    async lire() {
      appels += 1;
      if (appels === 1) {
        await new Promise((resoudre) => { liberer = resoudre; });
        throw new Error('premier essai raté');
      }
      return { a: 1 };
    }
  })('essai', journal);
  const enCours = source.actualiser();
  source.actualiser();
  liberer();
  await enCours;
  t.mock.timers.tick(10 * MINUTE);
  await laisserFinir();
  assert.equal(appels, 2);
  assert.deepEqual(source.valeur, { a: 1 });
  assert.deepEqual(journal.lignes, []);
});

test('Source : après un échec, nouvel essai à 30 s, 1, 2 puis 5 min, et retour au rythme normal au succès', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const echec = new Error('Internet pas encore revenu');
  const source = new SourceEssai([echec, echec, echec, echec, echec, { a: 1 }]);
  source.repeter(60 * MINUTE);
  await source.actualiser();
  assert.deepEqual(REPRISES_MS, [30_000, MINUTE, 2 * MINUTE, 5 * MINUTE]);
  for (const [i, attente] of [...REPRISES_MS, 5 * MINUTE].entries()) {
    t.mock.timers.tick(attente - 1);
    await laisserFinir();
    assert.equal(source.appels, i + 1, `aucun essai avant ${attente} ms`);
    t.mock.timers.tick(1);
    await laisserFinir();
    assert.equal(source.appels, i + 2, `essai ${i + 2} à ${attente} ms`);
  }
  assert.deepEqual(source.valeur, { a: 1 }, 'valeur présente au bout de 13,5 min, pas d\'une heure');
  t.mock.timers.tick(46 * MINUTE);
  await laisserFinir();
  assert.equal(source.appels, 6, 'plus d\'essai rapproché après le succès (59,5 min écoulées)');
  t.mock.timers.tick(MINUTE / 2);
  await laisserFinir();
  assert.equal(source.appels, 7, 'relecture périodique normale à 60 min');
  source.arreter();
});

test('Source : le nouvel essai ne dépasse pas l\'intervalle normal et respecte la condition', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let connecte = false;
  const source = new SourceEssai([new Error('x'), { a: 1 }]);
  source.repeter(20_000, () => connecte);
  await source.actualiser();
  t.mock.timers.tick(20_000);
  await laisserFinir();
  assert.equal(source.appels, 1, 'HA non connecté : ni relecture périodique ni nouvel essai');
  connecte = true;
  t.mock.timers.tick(20_000);
  await laisserFinir();
  assert.deepEqual(source.valeur, { a: 1 });
  source.arreter();
});

test('Source : arreter() annule le nouvel essai prévu', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const source = new SourceEssai([new Error('x'), { a: 1 }]);
  await source.actualiser();
  source.arreter();
  t.mock.timers.tick(10 * MINUTE);
  await laisserFinir();
  assert.equal(source.appels, 1);
});

// Fausse connexion HA : lire() répond par service et par type, et note chaque appel.
function fausseConnexion(reponses) {
  const connexion = new EventEmitter();
  connexion.etat = 'ok';
  connexion.appels = [];
  connexion.lire = async (service, entite, donnees) => {
    connexion.appels.push({ service, entite, donnees });
    const reponse = reponses[donnees.type ?? service];
    if (reponse instanceof Error) throw reponse;
    return structuredClone(reponse);
  };
  return connexion;
}

const heure = (h) => new Date(Date.UTC(2026, 9, 11, h)).toISOString();
const HORAIRE = {
  forecast: Array.from({ length: 60 }, (_, h) => ({
    datetime: heure(h), condition: 'cloudy', temperature: 12, precipitation: 0, wind_speed: 9, wind_bearing: 200,
    humidity: 80, cloud_coverage: 90, dew_point: 8,
  })),
};

test('SourceMeteo : hourly seulement sur weather.forecast_maison (pas de daily), coupe à 48 h, champs projetés seulement', async () => {
  const connexion = fausseConnexion({ hourly: HORAIRE, daily: new Error('le quotidien ne doit pas être lu') });
  const meteo = new SourceMeteo(connexion, new EventEmitter(), journalCapture());
  await meteo.actualiser();
  assert.deepEqual(connexion.appels, [
    { service: 'weather.get_forecasts', entite: 'weather.forecast_maison', donnees: { type: 'hourly' } },
  ]);
  assert.deepEqual(Object.keys(meteo.valeur), ['horaire']);
  assert.equal(meteo.valeur.horaire.length, 48);
  assert.deepEqual(meteo.valeur.horaire[0], { datetime: heure(0), condition: 'cloudy', temperature: 12, precipitation: 0, wind_speed: 9, wind_bearing: 200 });
  assert.equal(meteo.valeur.horaire[47].datetime, heure(47));
});

test('SourceMeteo : réponse de forme inattendue rejetée, valeur inchangée', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const journal = journalCapture();
  const connexion = fausseConnexion({ hourly: { forecast: [{ datetime: 'demain', temperature: '12' }] } });
  const meteo = new SourceMeteo(connexion, new EventEmitter(), journal);
  await meteo.actualiser();
  meteo.arreter();
  assert.equal(meteo.valeur, null);
  assert.match(journal.lignes.join('\n'), /météo : lecture échouée.*réponse inattendue/);
});

test('SourceMeteo : relue quand weather.forecast_maison apparaît ou change, pas pour les autres entités', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const connexion = fausseConnexion({ hourly: HORAIRE });
  const entites = new EventEmitter();
  const meteo = new SourceMeteo(connexion, entites, journalCapture());
  meteo.demarrer();
  entites.emit('maj', { 'sun.sun': { state: 'above_horizon', last_changed: heure(7), attributes: {} } });
  entites.emit('maj', { 'weather.forecast_maison': null });
  await laisserFinir();
  assert.equal(connexion.appels.length, 0);
  entites.emit('maj', { 'weather.forecast_maison': { state: 'cloudy', last_changed: heure(9), attributes: {} } });
  await laisserFinir();
  assert.equal(connexion.appels.length, 1);
  assert.equal(meteo.valeur.horaire.length, 48);
  meteo.arreter();
});

test('SourceCourses : status needs_action ET completed toujours passés, uid, summary et status seulement', async () => {
  const connexion = fausseConnexion({
    'todo.get_items': {
      items: [
        { uid: 'u1', summary: 'crème fraîche', status: 'needs_action', description: 'entière', due: '2026-10-12' },
        { uid: 'u2', summary: 'crème fraîche', status: 'completed' },
      ],
    },
  });
  const courses = new SourceCourses(connexion, new EventEmitter(), journalCapture());
  await courses.actualiser();
  assert.deepEqual(connexion.appels, [
    { service: 'todo.get_items', entite: 'todo.shopping_list', donnees: { status: ['needs_action', 'completed'] } },
  ]);
  assert.deepEqual(courses.valeur, {
    articles: [
      { uid: 'u1', summary: 'crème fraîche', status: 'needs_action' },
      { uid: 'u2', summary: 'crème fraîche', status: 'completed' },
    ],
  });
});

test('SourceCourses : relue au changement de todo.shopping_list, pas pour les autres entités', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const connexion = fausseConnexion({ 'todo.get_items': { items: [] } });
  const entites = new EventEmitter();
  const courses = new SourceCourses(connexion, entites, journalCapture());
  courses.demarrer();
  entites.emit('maj', { 'sun.sun': { state: 'below_horizon', last_changed: heure(18), attributes: {} } });
  await laisserFinir();
  assert.equal(connexion.appels.length, 0);
  entites.emit('maj', { 'todo.shopping_list': { state: '3', last_changed: heure(18), attributes: {} } });
  await laisserFinir();
  assert.equal(connexion.appels.length, 1);
  assert.deepEqual(courses.valeur, { articles: [] });
  courses.arreter();
});
