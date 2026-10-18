// tests/draps-page.test.js
//
// Rôle    : prouver les draps côté page : les règles sans DOM (web/src/ecrans/draps-donnees.js : « il y a N jours »,
//           « prochain dans N jours », rappel dès 2 jours avant l'échéance de 15 jours, « à changer » le jour J et en
//           retard, rien pour un lit jamais noté) et les cartes sur le faux DOM (web/src/ecrans/maison-draps.js : un
//           toucher montre tout de suite « changés aujourd'hui » et « Annuler », la demande part au bout de 5 s, Annuler
//           l'arrête ; appui long d'une seconde pour « Hier » ou « Avant-hier » ; quitter l'écran envoie aussitôt ; un
//           refus du serveur se dit).
// Entrées : valeurs draps écrites ici au format du flux ; faux DOM (tests/faux-dom.js), faux client, horloge monotone
//           de la page (performance.now) et de la carte remplacées.
// Sorties : node --test.
// Pièges  : l'anti-répétition de 300 ms des gestes (appui.js) lit performance.now : le test l'avance entre deux touchers.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { alertesDraps, dateDuChangement, vueDraps } from '../web/src/ecrans/draps-donnees.js';
import { creerDraps } from '../web/src/ecrans/maison-draps.js';
import {
  appuyer, installerFauxDom, parClasse, poser, texte,
} from './faux-dom.js';

const ESP = ' ';
const LE_14 = Date.parse('2026-10-14T09:00:00+02:00');
let horloge = 0;
performance.now = () => horloge;
after(() => { delete performance.now; });

test('draps : depuis quand, prochain changement, ton et jauge, du jour même au retard ; jamais noté', () => {
  const vue = (date) => vueDraps({ timo: date, pablo: null, parents: null }, LE_14)[0];
  assert.deepEqual(vue('2026-10-14'), {
    id: 'timo', nom: 'Lit de Timo', depuis: 'changés aujourd\'hui', prochain: `prochain dans 15${ESP}jours`, progression: 0, ton: 'ok',
  });
  assert.deepEqual([vue('2026-10-13').depuis, vue('2026-10-13').prochain], ['changés hier', `prochain dans 14${ESP}jours`]);
  assert.deepEqual([vue('2026-10-02').prochain, vue('2026-10-02').ton], [`prochain dans 3${ESP}jours`, 'ok'], '12e jour : pas encore de rappel');
  assert.deepEqual([vue('2026-10-01').depuis, vue('2026-10-01').prochain, vue('2026-10-01').ton], [`changés il y a 13${ESP}jours`, `prochain dans 2${ESP}jours`, 'bientot']);
  assert.deepEqual([vue('2026-09-30').prochain, vue('2026-09-30').ton], ['prochain demain', 'bientot']);
  assert.deepEqual([vue('2026-09-29').prochain, vue('2026-09-29').ton, vue('2026-09-29').progression], ['à changer', 'alerte', 1]);
  assert.deepEqual([vue('2026-09-26').prochain, vue('2026-09-26').progression], [`à changer, 3${ESP}jours de retard`, 1]);
  assert.deepEqual([vue('2026-10-15').depuis, vue('2026-10-15').progression], ['changés aujourd\'hui', 0], 'date du serveur en avance : aujourd\'hui');
  const jamais = vueDraps(null, LE_14);
  assert.deepEqual(jamais.map((c) => [c.nom, c.depuis, c.ton]), [
    ['Lit de Timo', 'pas encore noté', 'inconnu'], ['Lit de Pablo', 'pas encore noté', 'inconnu'], ['Notre chambre', 'pas encore noté', 'inconnu'],
  ]);
});

test('alertes des draps : dès le 13e jour, le jour J et en retard, la plus urgente d\'abord ; rien avant, rien pour un lit jamais noté', () => {
  assert.deepEqual(alertesDraps({ timo: '2026-10-01', pablo: '2026-09-29', parents: '2026-09-20' }, LE_14), [
    { icone: 'i-lit', titre: 'Notre chambre', valeur: `draps, 9${ESP}jours de retard` },
    { icone: 'i-lit', titre: 'Lit de Pablo', valeur: 'draps à changer' },
    { icone: 'i-lit', titre: 'Lit de Timo', valeur: `draps dans 2${ESP}jours` },
  ]);
  assert.deepEqual(alertesDraps({ timo: '2026-09-29', pablo: '2026-09-29', parents: '2026-10-02' }, LE_14).map((a) => a.titre), ['Lit de Timo', 'Lit de Pablo'],
    'à urgence égale : l\'ordre des cartes');
  assert.deepEqual(alertesDraps({ timo: '2026-09-30', pablo: '2026-10-02', parents: null }, LE_14), [{ icone: 'i-lit', titre: 'Lit de Timo', valeur: 'draps demain' }]);
  assert.deepEqual(alertesDraps(null, LE_14), []);
});

test('date affichée avant l\'envoi : aujourd\'hui, hier, avant-hier à l\'heure de Paris', () => {
  const minuitEtDemi = Date.parse('2026-11-01T00:30:00+01:00');
  assert.deepEqual(['aujourdhui', 'hier', 'avant-hier'].map((quand) => dateDuChangement(quand, minuitEtDemi)), ['2026-11-01', '2026-10-31', '2026-10-30']);
});

function monter() {
  const { conteneur } = installerFauxDom();
  const envois = [];
  let reponse = { ok: true, donnees: {} };
  const client = {
    poster: (chemin, corps) => {
      envois.push({ chemin, corps });
      return Promise.resolve(reponse);
    },
  };
  const draps = creerDraps(conteneur, { client, monotone: () => horloge });
  draps.mettreAJour({ timo: '2026-10-01', pablo: null, parents: '2026-10-10' }, LE_14);
  const carte = (i) => parClasse(conteneur, 'draps-carte')[i];
  const un = (i, classe) => parClasse(carte(i), classe)[0];
  return {
    draps, envois, carte, un, refuser: () => { reponse = { ok: false, statut: 500, message: 'Le serveur a refusé' }; },
  };
}

const avancer = (ms) => { horloge += ms; };
const laisserFinir = () => new Promise((resoudre) => setImmediate(resoudre));

test('carte : un toucher montre « changés aujourd\'hui » et Annuler ; la demande part au bout de 5 s, avec le seul mot « aujourdhui »', async () => {
  const {
    draps, envois, carte, un,
  } = monter();
  assert.deepEqual([texte(un(0, 'draps-depuis')), texte(un(0, 'draps-prochain'))], [`changés il y a 13${ESP}jours`, `prochain dans 2${ESP}jours`]);
  assert.ok(carte(0).classList.contains('draps-bientot'));
  avancer(1000);
  appuyer(un(0, 'draps-changer'));
  assert.equal(texte(un(0, 'draps-depuis')), 'changés aujourd\'hui');
  assert.deepEqual([un(0, 'draps-changer').hidden, un(0, 'draps-annuler').hidden], [true, false]);
  avancer(4999);
  draps.entretenir();
  assert.deepEqual(envois, [], 'encore annulable');
  avancer(1);
  draps.entretenir();
  assert.deepEqual(envois, [{ chemin: '/api/draps/timo', corps: { quand: 'aujourdhui' } }]);
  assert.equal(un(0, 'draps-annuler').hidden, true, 'envoyé : plus annulable');
  await laisserFinir();
  draps.mettreAJour({ timo: '2026-10-14', pablo: null, parents: '2026-10-10' }, LE_14);
  assert.deepEqual([texte(un(0, 'draps-depuis')), un(0, 'draps-changer').hidden], ['changés aujourd\'hui', false]);
});

test('carte : Annuler dans les 5 s, rien ne part et la date du serveur revient', () => {
  const { draps, envois, un } = monter();
  avancer(1000);
  appuyer(un(2, 'draps-changer'));
  avancer(400);
  appuyer(un(2, 'draps-annuler'));
  assert.equal(texte(un(2, 'draps-depuis')), `changés il y a 4${ESP}jours`);
  avancer(10_000);
  draps.entretenir();
  assert.deepEqual(envois, []);
});

test('carte : appui long d\'une seconde, « Hier » ou « Avant-hier » pendant 10 s, puis la même annulation de 5 s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { draps, envois, un } = monter();
  avancer(1000);
  poser(un(1, 'draps-changer'));
  t.mock.timers.tick(1000);
  un(1, 'draps-changer').declencher('pointerup', { clientX: 10, clientY: 10 });
  assert.deepEqual([un(1, 'draps-changer').hidden, un(1, 'draps-choix').hidden], [true, false]);
  assert.deepEqual(parClasse(un(1, 'draps-choix'), 'draps-jour').map(texte), ['Hier', 'Avant-hier']);
  avancer(400);
  appuyer(parClasse(un(1, 'draps-choix'), 'draps-jour')[0]);
  assert.equal(texte(un(1, 'draps-depuis')), 'changés hier');
  avancer(5000);
  draps.entretenir();
  assert.deepEqual(envois, [{ chemin: '/api/draps/pablo', corps: { quand: 'hier' } }]);
  await laisserFinir();
  avancer(400);
  poser(un(1, 'draps-changer'));
  t.mock.timers.tick(1000);
  avancer(10_000);
  draps.entretenir();
  assert.deepEqual([un(1, 'draps-changer').hidden, un(1, 'draps-choix').hidden], [false, true], 'choix refermé au bout de 10 s');
});

test('carte : quitter l\'écran envoie aussitôt ce qui attendait ; un refus du serveur se dit 30 s', async () => {
  const {
    draps, envois, un, refuser,
  } = monter();
  refuser();
  avancer(1000);
  appuyer(un(0, 'draps-changer'));
  draps.quitter();
  assert.deepEqual(envois, [{ chemin: '/api/draps/timo', corps: { quand: 'aujourdhui' } }]);
  await laisserFinir();
  assert.deepEqual([un(0, 'draps-message').hidden, texte(un(0, 'draps-message'))], [false, 'Pas noté, réessayer']);
  assert.equal(texte(un(0, 'draps-depuis')), `changés il y a 13${ESP}jours`, 'la date du serveur revient');
  avancer(30_000);
  draps.entretenir();
  assert.equal(un(0, 'draps-message').hidden, true);
});
