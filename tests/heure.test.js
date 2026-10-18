// tests/heure.test.js
//
// Rôle    : prouver web/src/heure.js : heure et date de Paris quel que soit le fuseau de la machine,
//           minuit écrit 00:00 (jamais 24:00), changement d'heure, « 1er » du mois, format des heures
//           d'Open-Meteo, jours abrégés, durées, ajout de jours à une date, lundi de la semaine et écart en jours
//           entre deux dates, et horloge corrigée par heure_serveur (et son état « réglée »).
// Entrées : instants UTC construits à la main ; une fausse horloge locale.
// Sorties : node --test.
// Pièges  : la machine de test est elle-même à Paris : les cas proches de minuit et du 25/10 prouvent que
//           le calcul passe par Europe/Paris et non par l'heure locale. TZ=UTC npm test doit aussi passer.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ajouterJours, creerHorloge, dateParis, ecartJours, heureLocaleParis, jourAbrege, lundiDe, partiesParis, texteDate, texteDuree, texteHeure,
  texteJourIso,
} from '../web/src/heure.js';

const utc = (texte) => Date.parse(`${texte}Z`);

test('heure de Paris en été (UTC+2) et en hiver (UTC+1), sur deux chiffres', () => {
  assert.equal(texteHeure(utc('2026-10-11T13:34')), '15:34');
  assert.equal(texteHeure(utc('2026-10-11T05:05')), '07:05');
  assert.equal(texteHeure(utc('2026-12-01T12:05')), '13:05');
});

test('minuit s\'écrit 00:00, jamais 24:00', () => {
  assert.equal(texteHeure(utc('2026-10-11T22:00')), '00:00');
  assert.equal(texteHeure(utc('2026-12-31T23:00')), '00:00');
  assert.equal(partiesParis(utc('2026-10-11T22:00')).heure, 0);
});

test('changement d\'heure du 25/10/2026 : 02:30 deux fois, puis 03:00', () => {
  assert.equal(texteHeure(utc('2026-10-25T00:30')), '02:30');
  assert.equal(texteHeure(utc('2026-10-25T01:30')), '02:30');
  assert.equal(texteHeure(utc('2026-10-25T02:00')), '03:00');
});

test('date de Paris : jour, quantième (1er), mois ; elle change à minuit de Paris, pas d\'UTC', () => {
  assert.equal(texteDate(utc('2026-10-11T10:00')), 'Dimanche 11 octobre');
  assert.equal(texteDate(utc('2026-10-10T22:30')), 'Dimanche 11 octobre');
  assert.equal(texteDate(utc('2026-10-31T23:30')), 'Dimanche 1er novembre');
  assert.equal(texteDate(utc('2026-08-15T10:00')), 'Samedi 15 août');
  assert.equal(dateParis(utc('2026-10-10T22:30')), '2026-10-11');
  assert.equal(dateParis(utc('2026-10-10T21:59')), '2026-10-10');
  assert.deepEqual(partiesParis(utc('2026-10-11T13:34')), { annee: 2026, mois: 10, jour: 11, heure: 15, minute: 34, jourSemaine: 0 });
});

test('heure locale de Paris au format d\'Open-Meteo (sans décalage)', () => {
  assert.equal(heureLocaleParis(utc('2026-10-11T12:15')), '2026-10-11T14:15');
  assert.equal(heureLocaleParis(utc('2026-01-05T08:00')), '2026-01-05T09:00');
});

test('jour abrégé d\'une date seule, sans fuseau', () => {
  assert.deepEqual(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'].map(jourAbrege),
    ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']);
  assert.equal(jourAbrege('2026-10-25'), 'Dim');
});

test('durées : minutes arrondies (1 au moins), puis heures', () => {
  assert.equal(texteDuree(0), '1 min');
  assert.equal(texteDuree(45000), '1 min');
  assert.equal(texteDuree(89000), '1 min');
  assert.equal(texteDuree(90000), '2 min');
  assert.equal(texteDuree(59 * 60000), '59 min');
  assert.equal(texteDuree(60 * 60000), '1 h');
  assert.equal(texteDuree(65 * 60000), '1 h 05');
  assert.equal(texteDuree(150 * 60000), '2 h 30');
});

test('date seule en toutes lettres, sans fuseau : « samedi 10 octobre », « 1er »', () => {
  assert.equal(texteJourIso('2026-10-10'), 'samedi 10 octobre');
  assert.equal(texteJourIso('2026-11-01'), 'dimanche 1er novembre');
  assert.equal(texteJourIso('2027-01-08'), 'vendredi 8 janvier');
});

test('horloge : décalage tiré de heure_serveur, valeurs invalides ignorées, réglée au premier heure_serveur valide', () => {
  let locale = 1000;
  const horloge = creerHorloge(() => locale);
  assert.equal(horloge.maintenant(), 1000, 'sans réglage, horloge locale');
  horloge.regler('5000');
  assert.equal(horloge.estReglee(), false, 'une valeur invalide ne règle pas l\'horloge');
  horloge.regler(5000);
  assert.equal(horloge.estReglee(), true);
  assert.equal(horloge.maintenant(), 5000);
  locale = 2000;
  assert.equal(horloge.maintenant(), 6000, 'le décalage suit l\'horloge locale');
  for (const invalide of ['7000', NaN, Infinity, null, undefined]) horloge.regler(invalide);
  assert.equal(horloge.maintenant(), 6000);
  horloge.regler(1500);
  assert.equal(horloge.maintenant(), 1500, 'décalage négatif (horloge du cadre en avance)');
});

test('ajouterJours : fin de mois, fin d\'année, jour du changement d\'heure, recul', () => {
  assert.equal(ajouterJours('2026-10-31', 1), '2026-11-01');
  assert.equal(ajouterJours('2026-12-31', 1), '2027-01-01');
  assert.equal(ajouterJours('2026-10-24', 1), '2026-10-25');
  assert.equal(ajouterJours('2026-10-25', 1), '2026-10-26');
  assert.equal(ajouterJours('2026-10-14', 13), '2026-10-27');
  assert.equal(ajouterJours('2026-03-01', -1), '2026-02-28');
});

test('lundiDe et ecartJours : semaine du lundi au dimanche, fin d\'année, changement d\'heure sans effet sur des dates', () => {
  assert.equal(lundiDe('2026-10-14'), '2026-10-12');
  assert.equal(lundiDe('2026-10-12'), '2026-10-12', 'un lundi est son propre lundi');
  assert.equal(lundiDe('2026-10-18'), '2026-10-12', 'le dimanche finit la semaine');
  assert.equal(lundiDe('2027-01-01'), '2026-12-28');
  assert.equal(ecartJours('2026-10-12', '2026-10-14'), 2);
  assert.equal(ecartJours('2026-10-14', '2026-10-12'), -2);
  assert.equal(ecartJours('2026-10-19', '2026-10-26'), 7, 'semaine du changement d\'heure : 7 jours pile');
  assert.equal(ecartJours('2026-12-28', '2027-01-04'), 7);
});
