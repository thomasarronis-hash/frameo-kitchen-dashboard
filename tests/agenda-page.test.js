// tests/agenda-page.test.js
//
// Rôle    : prouver les calculs de web/src/ecrans/agenda-donnees.js que partagent l'Accueil et la page Aujourd'hui
//           (personnes, rendez-vous d'un jour, ligne de rendez-vous) et la règle des deux lignes de « La semaine »
//           quand l'agenda s'y ajoute (web/src/ecrans/accueil-donnees.js). La semaine en grille de l'écran Agenda est
//           prouvée par tests/agenda-grille.test.js.
// Entrées : la réponse de calendar.get_events (tests/fixtures/ha-calendrier-evenements.json, titres inventés), passée
//           par la projection et la fusion du serveur (serveur/ha/agenda.js) : la page est testée sur la forme exacte
//           de ce que le flux lui envoie ; le menu réel du 10/10 ; la semaine Open-Meteo du 11/10.
// Sorties : node --test.
// Pièges  : heures construites en UTC ; le 14/10 Paris est à UTC+2, le 26/10 à UTC+1 (changement d'heure le 25).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fusionner, projeterEvenement } from '../serveur/ha/agenda.js';
import { analyserSemaine } from '../serveur/sources/open-meteo.js';
import { vueSemaine } from '../web/src/ecrans/accueil-donnees.js';
import {
  evenementsDuJour, ligneDeRendezVous, personnesDe,
} from '../web/src/ecrans/agenda-donnees.js';

const lire = (nom) => JSON.parse(readFileSync(new URL(`./fixtures/${nom}`, import.meta.url), 'utf8'));
const utc = (texte) => Date.parse(`${texte}Z`);
const REPONSE = lire('ha-calendrier-evenements.json');
const MENU = lire('menu-2026-10-10.json');
const CALENDRIERS = [
  { id: 'calendar.domicile', nom: 'Domicile', personne: 'Thomas', etat: 'ok' },
  { id: 'calendar.domicile_2', nom: 'Domicile', personne: 'Agathe', etat: 'ok' },
];
const agendaDe = (evenements, calendriers = CALENDRIERS) => ({
  personnes: calendriers.map((c) => c.personne).filter((p, i, t) => t.indexOf(p) === i), calendriers, evenements,
});
const AGENDA = agendaDe(fusionner([
  REPONSE.events.map((e) => projeterEvenement(e, 'Thomas')),
  [projeterEvenement({ start: '2026-10-14T12:30:00+02:00', end: '2026-10-14T13:30:00+02:00', summary: 'Déjeuner avec Paul' }, 'Agathe')],
]));
const A_7H = utc('2026-10-14T05:00');
const THOMAS = { couleur: 1, initiale: 'T', personne: 'Thomas' };
const AGATHE = { couleur: 2, initiale: 'A', personne: 'Agathe' };

test('personnes : une couleur par personne dans l\'ordre, 4 puis on recommence ; initiale, deux lettres si deux prénoms commencent pareil', () => {
  assert.deepEqual(personnesDe(AGENDA), [{ nom: 'Thomas', couleur: 1, initiale: 'T' }, { nom: 'Agathe', couleur: 2, initiale: 'A' }]);
  const six = agendaDe([], ['Thomas', 'Théo', 'agathe', 'Élise', 'Bob', 'Zoé'].map((p, i) => ({ id: `calendar.c${i}`, nom: 'C', personne: p, etat: 'ok' })));
  assert.deepEqual(personnesDe(six).map((p) => [p.couleur, p.initiale]), [[1, 'Th'], [2, 'Th'], [3, 'A'], [4, 'É'], [1, 'B'], [2, 'Z']]);
  assert.deepEqual(personnesDe(null), []);
});

test('rendez-vous d\'un jour : tout le monde mélangé, journée entière d\'abord puis par heure ; pastille de la personne', () => {
  assert.deepEqual(evenementsDuJour(AGENDA, '2026-10-14', A_7H), [
    {
      horaire: 'Journée', court: 'Sortie scolaire au musée', titre: 'Sortie scolaire au musée', lieu: null, ...THOMAS,
    },
    {
      horaire: '09:30', court: '09:30 Dentiste', titre: 'Dentiste', lieu: 'Cabinet du centre, Paris', ...THOMAS,
    },
    {
      horaire: '12:30', court: '12:30 Déjeuner avec Paul', titre: 'Déjeuner avec Paul', lieu: null, ...AGATHE,
    },
    {
      horaire: '18:00', court: '18:00 Entraînement de foot', titre: 'Entraînement de foot', lieu: null, ...THOMAS,
    },
  ]);
});

test('journée entière : la fin est exclue ; un événement de plusieurs jours couvre chacun de ses jours', () => {
  assert.equal(evenementsDuJour(AGENDA, '2026-10-15', A_7H).length, 0, 'sortie du 14 : fin le 15, exclue');
  for (const date of ['2026-10-17', '2026-10-18', '2026-10-19']) {
    assert.ok(evenementsDuJour(AGENDA, date, A_7H).some((e) => e.titre === 'Week-end chez les grands-parents'), date);
  }
  assert.equal(evenementsDuJour(AGENDA, '2026-10-20', A_7H).length, 0);
});

test('à l\'heure : un rendez-vous qui passe minuit apparaît les deux jours (« fin 00:30 » le lendemain) ; fini à minuit pile, non', () => {
  assert.equal(evenementsDuJour(AGENDA, '2026-10-18', A_7H).filter((e) => e.titre === 'Retour en voiture')[0].court, '23:30 Retour en voiture');
  const lendemain = evenementsDuJour(AGENDA, '2026-10-19', A_7H).filter((e) => e.titre === 'Retour en voiture')[0];
  assert.deepEqual([lendemain.horaire, lendemain.court], ['fin 00:30', 'Retour en voiture']);
  const minuit = agendaDe([projeterEvenement({ start: '2026-10-21T22:00:00+02:00', end: '2026-10-22T00:00:00+02:00', summary: 'Veillée' }, 'Agathe')]);
  assert.equal(evenementsDuJour(minuit, '2026-10-21', A_7H).length, 1);
  assert.equal(evenementsDuJour(minuit, '2026-10-22', A_7H).length, 0);
});

test('heure de Paris recalculée (changement d\'heure du 25/10) ; un rendez-vous à l\'heure fini disparaît, la journée entière reste', () => {
  const hiver = agendaDe([projeterEvenement({ start: '2026-10-26T08:00:00Z', end: '2026-10-26T09:00:00Z', summary: 'Kiné' }, 'Thomas')]);
  assert.equal(evenementsDuJour(hiver, '2026-10-26', A_7H)[0].court, '09:00 Kiné');
  const a10h = utc('2026-10-14T08:01');
  assert.deepEqual(evenementsDuJour(AGENDA, '2026-10-14', a10h).map((e) => e.titre), ['Sortie scolaire au musée', 'Déjeuner avec Paul', 'Entraînement de foot']);
  assert.deepEqual(evenementsDuJour(null, '2026-10-14', A_7H), []);
});

test('« La semaine » : deux lignes de texte au plus par jour, repas puis agenda, pastille de chaque personne', () => {
  const semaine = analyserSemaine(lire('open-meteo-semaine.json'), '2026-10-11T14:00');
  semaine.jours.forEach((jour, i) => { jour.date = `2026-10-${String(14 + i).padStart(2, '0')}`; });
  const vue = vueSemaine(semaine, A_7H, MENU, AGENDA);
  // Mercredi 14 : un repas et 4 rendez-vous (3 de Thomas, 1 d'Agathe) -> une ligne de repas, une ligne d'agenda avec le
  // premier rendez-vous de chacun (même s'ils ne tiennent pas en entier : chacun son ellipse), +2 pour ceux de Thomas.
  assert.deepEqual(vue[0].repas, ['Riz cantonais maison']);
  assert.deepEqual(vue[0].agenda, [{ evenements: [{ texte: 'Sortie scolaire au musée', ...THOMAS }, { texte: '12:30 Déjeuner avec Paul', ...AGATHE }], plus: 2 }]);
  // Jeudi 15 : un repas, aucun rendez-vous -> comme avant (le titre peut prendre 2 lignes).
  assert.deepEqual([vue[1].repas, vue[1].agenda], [['Boulettes à la sauce tomate et aux courgettes'], []]);
  // Samedi 17 et dimanche 18 : hors du menu, rendez-vous seuls sur 2 lignes (un chacune, +N sur la seconde).
  assert.deepEqual(vue[3].agenda, [{ evenements: [{ texte: 'Week-end chez les grands-parents', ...THOMAS }], plus: 0 }]);
  assert.deepEqual(vue[4].agenda, [
    { evenements: [{ texte: 'Week-end chez les grands-parents', ...THOMAS }], plus: 0 },
    { evenements: [{ texte: '23:30 Retour en voiture', ...THOMAS }], plus: 0 },
  ]);
  for (const jour of vue) assert.ok(jour.repas.length + jour.agenda.length <= 2, jour.jour);
  assert.deepEqual(vueSemaine(semaine, A_7H, MENU, null).map((j) => j.agenda), [[], [], [], [], [], [], []], 'sans agenda : aucune ligne');
});

test('ligne de rendez-vous : le premier toujours, les suivants seulement s\'ils tiennent en entier, au plus max', () => {
  const rdv = (court, pastille = THOMAS) => ({ court, ...pastille });
  // Coûts : longueur + 3 par pastille, + 2 par « · » à partir du deuxième.
  assert.deepEqual(ligneDeRendezVous([rdv('09:30 Dentiste'), rdv('18:00 Foot')], 2, 34), {
    evenements: [{ texte: '09:30 Dentiste', ...THOMAS }, { texte: '18:00 Foot', ...THOMAS }], plus: 0,
  }, '17 + 15 = 32 : les deux tiennent');
  assert.equal(ligneDeRendezVous([rdv('09:30 Dentiste'), rdv('18:00 Footing')], 2, 34).evenements.length, 1, '17 + 18 = 35 > 34');
  const long = ligneDeRendezVous([rdv('Un titre beaucoup trop long pour une seule ligne de la colonne'), rdv('A')], 2, 34);
  assert.deepEqual([long.evenements.length, long.plus], [1, 1], 'le premier est montré même trop long (ellipse)');
  assert.deepEqual(ligneDeRendezVous(['A', 'B', 'C', 'D'].map((c) => rdv(c)), 3, 42).plus, 1, '3 au plus');
  assert.deepEqual(ligneDeRendezVous([], 2, 34), { evenements: [], plus: 0 });
});

test('ligne de rendez-vous : le premier de CHAQUE personne est toujours montré, même s\'il ne tient pas en entier', () => {
  const rdv = (court, pastille) => ({ court, ...pastille });
  const journee = [rdv('08:30 Dentiste Léa', AGATHE), rdv('12:30 Déjeuner avec Paul', THOMAS), rdv('17:00 Piscine', AGATHE), rdv('18:30 Foot', THOMAS)];
  assert.deepEqual(ligneDeRendezVous(journee, 2, 34), {
    evenements: [{ texte: '08:30 Dentiste Léa', ...AGATHE }, { texte: '12:30 Déjeuner avec Paul', ...THOMAS }], plus: 2,
  }, 'Agathe a rendez-vous plus tôt : Thomas reste visible (21 + 29 > 34, chacun sa part et son ellipse)');
  assert.deepEqual(ligneDeRendezVous([rdv('09:30 Dentiste', THOMAS), rdv('18:00 Footing', AGATHE)], 2, 34).evenements.length, 2);
  const troisPersonnes = [rdv('08:00 Bus', AGATHE), rdv('09:00 Réunion', THOMAS), rdv('10:00 École', { couleur: 3, initiale: 'L', personne: 'Léa' })];
  assert.deepEqual(ligneDeRendezVous(troisPersonnes, 2, 34).evenements.map((e) => e.personne), ['Agathe', 'Thomas'], 'au plus max personnes');
});

test('« La semaine » sans repas : une ligne par personne quand deux personnes ont rendez-vous ce jour-là', () => {
  const semaine = analyserSemaine(lire('open-meteo-semaine.json'), '2026-10-11T14:00');
  semaine.jours.forEach((jour, i) => { jour.date = `2026-10-${String(17 + i).padStart(2, '0')}`; });
  const ev = (debut, fin, titre, personne) => projeterEvenement({ start: `2026-10-17T${debut}:00+02:00`, end: `2026-10-17T${fin}:00+02:00`, summary: titre }, personne);
  const agenda = agendaDe(fusionner([[ev('12:30', '13:30', 'Déjeuner', 'Thomas'), ev('18:30', '19:30', 'Foot', 'Thomas')], [ev('08:30', '09:00', 'Dentiste', 'Agathe'), ev('17:00', '18:00', 'Piscine', 'Agathe')]]));
  const samedi = vueSemaine(semaine, utc('2026-10-17T05:00'), MENU, agenda)[0];
  assert.deepEqual(samedi.repas, [], 'samedi 17 : hors du menu');
  assert.deepEqual(samedi.agenda, [
    { evenements: [{ texte: '08:30 Dentiste', ...AGATHE }], plus: 1 },
    { evenements: [{ texte: '12:30 Déjeuner', ...THOMAS }], plus: 1 },
  ]);
});

test('« La semaine » : un jour de week-end avec midi, soir et rendez-vous garde le soir', () => {
  const semaine = analyserSemaine(lire('open-meteo-semaine.json'), '2026-10-11T14:00');
  semaine.jours.forEach((jour, i) => { jour.date = `2026-10-${String(10 + i).padStart(2, '0')}`; });
  const agenda = agendaDe([projeterEvenement({ start: '2026-10-10T15:00:00+02:00', end: '2026-10-10T17:00:00+02:00', summary: 'Anniversaire' }, 'Agathe')]);
  const samedi = vueSemaine(semaine, utc('2026-10-10T07:00'), MENU, agenda)[0];
  assert.deepEqual(samedi.repas, ['Soir · Burgers maison']);
  assert.deepEqual(samedi.agenda, [{ evenements: [{ texte: '15:00 Anniversaire', ...AGATHE }], plus: 0 }]);
});
