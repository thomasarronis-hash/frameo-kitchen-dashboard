// tests/ha-demo.test.js
//
// Rôle    : prouver le faux Home Assistant de démonstration (serveur/sources/ha-demo.js) et ses garde-fous de
//           configuration : fixtures recalées par semaines entières, états et lectures au format de la bibliothèque,
//           aucune écriture possible, HA_DEMO refusé hors développement et avec un garde-fou ACTIONS_* à 1.
// Entrées : les fixtures des tests (via ha-demo.js) ; une ConnexionHA branchée sur connecterDemo.
// Sorties : node --test.
// Pièges  : les dates attendues dépendent du jour : elles sont calculées ici avec les mêmes règles, jamais écrites en dur.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chargerConfig, lireClims, lireVoitures } from '../serveur/config.js';
import { projeterClims } from '../serveur/ha/clims.js';
import { ConnexionHA } from '../serveur/ha/connexion.js';
import { LISTE_BLANCHE, projeter } from '../serveur/ha/entites.js';
import { projeterVoitures } from '../serveur/ha/voitures.js';
import {
  CLIMS_DEMO, VOITURES_DEMO, connecterDemo, decalageSemaines, decalerDates,
} from '../serveur/sources/ha-demo.js';

const journal = { info() {}, warn() {}, error() {} };
const fixture = (nom) => new URL(`./fixtures/config/${nom}`, import.meta.url).pathname;
const ENV = {
  HA_JETON_FICHIER: fixture('jeton-factice'), CLE_CADRE_FICHIER: fixture('cle-factice'), CLE_CLEVO_FICHIER: fixture('cle-clevo-factice'),
};

test('décalage : des semaines entières, du samedi (menu) ou du lundi (agenda)', () => {
  assert.equal(decalageSemaines('2026-10-10'), 0);
  assert.equal(decalageSemaines('2026-10-16'), 0, 'vendredi : même cycle de menu');
  assert.equal(decalageSemaines('2026-10-17'), 7, 'samedi : cycle suivant');
  assert.equal(decalageSemaines('2026-10-18', '2026-10-12'), 0, 'dimanche : même semaine d\'agenda');
  assert.equal(decalageSemaines('2026-10-19', '2026-10-12'), 7);
  assert.equal(decalerDates('{"debut": "2026-10-10", "id": "2026-10-10-midi", "t": "2026-10-14T09:30:00+02:00"}', 7),
    '{"debut": "2026-10-17", "id": "2026-10-17-midi", "t": "2026-10-21T09:30:00+02:00"}');
  assert.equal(decalerDates('"2026-10-31"', 1), '"2026-11-01"', 'changement de mois');
});

test('faux HA : états au format de subscribe_entities, liste blanche, voiture et clims de la démo projetées', async () => {
  const conn = await connecterDemo();
  const recus = await new Promise((resoudre) => conn.subscribeMessage(resoudre, { type: 'subscribe_entities' }));
  const etats = Object.fromEntries(Object.entries(recus.a).map(([id, { s, a, lc }]) => [id, {
    entity_id: id, state: s, attributes: a, last_changed: new Date(lc * 1000).toISOString(),
  }]));
  const vus = Object.keys(projeter(etats, LISTE_BLANCHE));
  assert.ok(vus.includes('alarm_control_panel.alarme_maison') && vus.includes('weather.forecast_maison'), vus.join(', '));
  const [voiture] = projeterVoitures(etats, lireVoitures({ VOITURES: VOITURES_DEMO }));
  assert.equal(voiture.batterie, 62);
  assert.deepEqual(voiture.commandes, ['charger', 'clim']);
  assert.deepEqual(projeterClims(etats, lireClims({ CLIMS: CLIMS_DEMO })).map((clim) => [clim.nom, clim.mode]), [['Salon', 'heat'], ['Chambre', 'off']]);
});

test('faux HA : lectures météo, courses et agenda par une vraie ConnexionHA ; rien d\'autre', async () => {
  const connexion = new ConnexionHA({ url: 'http://127.0.0.1:8123', jeton: 'jeton-factice', journal, connecter: connecterDemo });
  await connexion.demarrer();
  const { forecast } = await connexion.lire('weather.get_forecasts', 'weather.forecast_maison', { type: 'hourly' });
  assert.ok(forecast.length >= 24);
  assert.ok(Date.parse(forecast[0].datetime) <= Date.now() && Date.now() - Date.parse(forecast[0].datetime) < 3_600_000, 'la météo part de l\'heure en cours');
  const { items } = await connexion.lire('todo.get_items', 'todo.shopping_list', { status: ['needs_action', 'completed'] });
  assert.ok(items.some((article) => article.status === 'needs_action'));
  const famille = await connexion.lire('calendar.get_events', 'calendar.famille', {});
  const ecole = await connexion.lire('calendar.get_events', 'calendar.ecole', {});
  assert.ok(famille.events.length > 0 && ecole.events.length > 0, 'les rendez-vous se partagent entre les deux calendriers');
  await assert.rejects(connexion.ecrire('todo.add_item', 'todo.shopping_list', { item: 'x' }), /refus|simul|ACTIONS/i);
  connexion.arreter();
});

test('HA_DEMO : développement seulement, jamais avec un garde-fou ACTIONS_* à 1', () => {
  assert.equal(chargerConfig({ ...ENV, NODE_ENV: 'development', HA_DEMO: '1' }).haDemo, true);
  assert.equal(chargerConfig(ENV).haDemo, false);
  assert.throws(() => chargerConfig({ ...ENV, HA_DEMO: '1' }), /HA_DEMO=1 n'existe qu'en développement/);
  for (const garde of ['ACTIONS_REELLES', 'ACTIONS_MAISON', 'ACTIONS_VOITURE', 'ACTIONS_CLIM']) {
    assert.throws(() => chargerConfig({ ...ENV, NODE_ENV: 'development', HA_DEMO: '1', [garde]: '1' }), new RegExp(`retirer ${garde}`));
  }
  assert.throws(() => chargerConfig({ ...ENV, NODE_ENV: 'development', HA_DEMO: 'oui' }), /HA_DEMO : 1 ou vide/);
});
