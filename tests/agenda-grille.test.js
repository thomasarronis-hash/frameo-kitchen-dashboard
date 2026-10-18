// tests/agenda-grille.test.js
//
// Rôle    : prouver la semaine en grille de l'écran Agenda (décision de Thomas du 14/10) : la géométrie de
//           web/src/ecrans/agenda-grille.js (hauteur des heures selon la rangée journée, plage horaire bornée à 6 h-23 h
//           et blocs hors plage collés au bord, place et hauteur des blocs, chevauchements sur les vraies heures, « +N »
//           au-delà de deux colonnes, lignes de la rangée journée entière, ce qu'un toucher vise) et la vue de la semaine
//           de web/src/ecrans/agenda-donnees.js (vueAgenda : jours, titre, journée entière, 24 h pile, événement sur
//           deux jours, changement d'heure du 25/10/2026, navigation dans la fenêtre lue, ligne de l'heure actuelle,
//           fiches, alerte des calendriers absents ou en échec).
// Entrées : la réponse de calendar.get_events (tests/fixtures/ha-calendrier-evenements.json, titres inventés) passée
//           par la projection et la fusion du serveur (serveur/ha/agenda.js), et des rendez-vous écrits ici.
// Sorties : node --test.
// Pièges  : heures construites avec leur décalage ; le 14/10, Paris est à UTC+2, le 26/10 à UTC+1. Zone des heures
//           de 828 px sans barre de journée, 778 avec une ligne, 732 avec deux : de 7 h à 19 h sans barre, une minute
//           vaut 828 / 720 px.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fusionner, projeterEvenement } from '../serveur/ha/agenda.js';
import { vueAgenda } from '../web/src/ecrans/agenda-donnees.js';
import {
  blocTouche, caseTouchee, hauteurHeures, lignesJournee, placerBlocs, placerJournees, plageHoraire,
} from '../web/src/ecrans/agenda-grille.js';

const REPONSE = JSON.parse(readFileSync(new URL('./fixtures/ha-calendrier-evenements.json', import.meta.url), 'utf8'));
const FENETRE = { debut: '2026-10-05', fin: '2026-11-02' };
const CALENDRIERS = [
  { id: 'calendar.domicile', nom: 'Domicile', personne: 'Thomas', etat: 'ok' },
  { id: 'calendar.domicile_2', nom: 'Domicile', personne: 'Agathe', etat: 'ok' },
];
const agendaDe = (evenements, fenetre = FENETRE) => ({
  personnes: ['Thomas', 'Agathe'], fenetre, calendriers: CALENDRIERS, evenements: fusionner([evenements]),
});
const ev = (debut, fin, titre, personne = 'Thomas', lieu) => projeterEvenement({
  start: debut, end: fin, summary: titre, ...(lieu ? { location: lieu } : {}),
}, personne);
const AGENDA = agendaDe([
  ...REPONSE.events.map((e) => projeterEvenement(e, 'Thomas')),
  ev('2026-10-14T12:30:00+02:00', '2026-10-14T13:30:00+02:00', 'Déjeuner avec Paul', 'Agathe'),
]);
const MERCREDI_7H = Date.parse('2026-10-14T05:00:00Z');
const PLAGE = { debut: 7, fin: 19 };
const H = 828;
const minutes = (h, m = 0) => h * 60 + m;
const segment = (debut, fin, titre, personne = 'Thomas') => ({
  debut, fin, titre, personne, couleur: 1, initiale: personne[0], fiche: [{ titre }],
});
const resume = (blocs) => blocs.map((b) => [b.titre || b.texte, b.gauche, b.largeur]);

test('hauteur des heures : 828 px sans barre de journée, 778 avec une ligne, 732 avec deux', () => {
  assert.deepEqual([0, 1, 2].map(hauteurHeures), [828, 778, 732]);
  assert.equal(lignesJournee([]), 0);
  assert.equal(lignesJournee([{ ligne: 0 }, { ligne: 0 }]), 1);
  assert.equal(lignesJournee([{ ligne: 0 }, { ligne: 1 }]), 2);
});

test('plage horaire : 7 h à 19 h, élargie à l\'heure pleine, jamais avant 6 h ni après 23 h ; un segment de nuit ne l\'élargit pas', () => {
  assert.deepEqual(plageHoraire([]), { debut: 7, fin: 19 });
  assert.deepEqual(plageHoraire([segment(minutes(9), minutes(10))]), { debut: 7, fin: 19 });
  assert.deepEqual(plageHoraire([segment(minutes(6, 30), minutes(7, 15)), segment(minutes(20), minutes(21, 15))]), { debut: 6, fin: 22 });
  assert.deepEqual(plageHoraire([segment(minutes(5, 30), minutes(6, 30)), segment(minutes(22), 1440)]), { debut: 6, fin: 23 }, 'bornée à 6 h et 23 h');
  assert.deepEqual(plageHoraire([segment(0, minutes(1)), segment(minutes(23, 30), 1440)]), { debut: 7, fin: 19 }, 'retour de soirée : la nuit ne tasse plus la semaine');
  assert.deepEqual(plageHoraire([segment(minutes(20, 30), minutes(20, 30))]), { debut: 7, fin: 21 }, 'sans durée : son heure compte');
});

test('blocs : place à l\'heure, hauteur selon la durée moins 2 px, 30 px au moins, lignes de texte qui tiennent', () => {
  const blocs = placerBlocs([
    segment(minutes(14), minutes(16), 'Deux heures'),
    segment(minutes(9, 30), minutes(10, 30), 'Une heure'),
    segment(minutes(12), minutes(12, 15), 'Quart d\'heure'),
  ], PLAGE, H);
  assert.deepEqual(blocs.map((b) => b.titre), ['Une heure', 'Quart d\'heure', 'Deux heures'], 'rangés par heure de début');
  const [heure, court, deuxHeures] = blocs;
  assert.deepEqual([heure.type, heure.top, heure.hauteur, heure.lignes, heure.serre], ['bloc', 173, 67, 2, false], '150 min après 7 h ; une heure : 69 px, deux lignes (« 09:30 Une » puis « heure »)');
  assert.deepEqual([deuxHeures.top, deuxHeures.hauteur, deuxHeures.lignes], [483, 136, 4]);
  assert.deepEqual([court.hauteur, court.lignes], [30, 1], 'un quart d\'heure (17 px) est allongé à une ligne lisible');
  assert.deepEqual(placerBlocs([segment(minutes(10), minutes(11), 'Avec barre')], PLAGE, hauteurHeures(1))[0].lignes, 2, 'une ligne de barres : une heure fait encore deux lignes');
  assert.deepEqual(placerBlocs([segment(minutes(10), minutes(11), 'Deux barres')], PLAGE, hauteurHeures(2))[0].lignes, 2, 'deux lignes de barres : encore deux');
  assert.deepEqual(placerBlocs([segment(minutes(10), minutes(11), 'Plage élargie')], { debut: 7, fin: 22 }, hauteurHeures(2))[0].lignes, 1, 'deux lignes de barres et une plage élargie à 22 h : une seule');
  const [tard] = placerBlocs([segment(minutes(18, 50), minutes(19), 'Tard')], PLAGE, H);
  assert.equal(tard.top, H - 32, 'allongé, il est remonté pour ne pas sortir de la grille');
  assert.deepEqual([heure.titre, heure.gauche, heure.largeur], ['Une heure', 0, 1], 'le contenu suit, seul dans son jour : toute la largeur');
});

test('blocs hors plage : collés au bord, coupés, avec leur vraie heure', () => {
  const [nuit, soiree] = placerBlocs([
    { ...segment(0, minutes(1), 'Retour'), horaire: 'fin 01:00' },
    { ...segment(minutes(18), 1440, 'Soirée'), horaire: '18:00' },
  ], PLAGE, H);
  assert.deepEqual([nuit.top, nuit.hauteur, nuit.coupeHaut, nuit.coupeBas, nuit.horaire], [0, 30, true, false, 'fin 01:00']);
  assert.deepEqual([soiree.top, soiree.hauteur, soiree.coupeHaut, soiree.coupeBas], [759, 67, false, true], 'de 18 h au bas de la grille (19 h)');
});

test('chevauchements sur les vraies heures : deux rendez-vous qui se suivent restent l\'un sous l\'autre en pleine largeur ; côte à côte sinon', () => {
  const suite = placerBlocs([segment(minutes(9), minutes(9, 30), 'Kiné'), segment(minutes(9, 30), minutes(10), 'Appel banque')], PLAGE, H);
  assert.deepEqual(resume(suite), [['Kiné', 0, 1], ['Appel banque', 0, 1]]);
  assert.deepEqual([suite[0].top, suite[0].hauteur, suite[1].top], [138, 33, 173], 'le premier ne couvre pas le second');
  const serres = placerBlocs([segment(minutes(9), minutes(9, 30), 'A'), segment(minutes(9, 30), minutes(10), 'B')], { debut: 6, fin: 23 }, hauteurHeures(2));
  assert.deepEqual([resume(serres), serres[0].hauteur, serres[0].serre], [[['A', 0, 1], ['B', 0, 1]], 20, true], 'échelle tassée : raccourci et « serré », pas côte à côte');
  assert.deepEqual(resume(placerBlocs([
    segment(minutes(9), minutes(10, 30), 'A'),
    segment(minutes(9, 30), minutes(10), 'B'),
    segment(minutes(10, 30), minutes(11), 'C'),
  ], PLAGE, H)), [['A', 0, 0.5], ['B', 0.5, 0.5], ['C', 0, 1]], 'C commence quand A finit : nouvelle grappe, toute la largeur');
  assert.deepEqual(resume(placerBlocs([segment(minutes(9), minutes(9, 15), 'D'), segment(minutes(9, 15), minutes(10), 'E')], PLAGE, H)), [['D', 0, 0.5], ['E', 0.5, 0.5]], 'moins de 30 min compte pour 30 : il ne tiendrait pas une ligne');
  assert.deepEqual(resume(placerBlocs([segment(minutes(9), minutes(12), 'A'), segment(minutes(10), minutes(11), 'B')], PLAGE, H)), [['A', 0, 0.5], ['B', 0.5, 0.5]]);
  assert.deepEqual(resume(placerBlocs([segment(minutes(9), minutes(10), 'A'), segment(minutes(9), minutes(12), 'B'), segment(minutes(11), minutes(12), 'C')], PLAGE, H)), [['B', 0, 0.5], ['A', 0.5, 0.5], ['C', 0.5, 0.5]], 'le plus long à gauche ; C reprend la colonne libre de A');
});

test('plus de deux à la fois : la première colonne, puis un seul bloc « +N » à droite avec les pastilles des personnes et la fiche en liste', () => {
  const blocs = placerBlocs([
    segment(minutes(8, 30), minutes(9, 30), 'Réunion', 'Thomas'),
    segment(minutes(8, 30), minutes(9, 30), 'Dentiste', 'Agathe'),
    segment(minutes(8, 30), minutes(9, 30), 'Orthophoniste', 'Léa'),
    segment(minutes(9), minutes(10), 'Piscine', 'Léa'),
    segment(minutes(11), minutes(12), 'Seul', 'Tom'),
  ], PLAGE, H);
  assert.deepEqual(resume(blocs), [['Réunion', 0, 0.5], ['+3', 0.5, 0.5], ['Seul', 0, 1]]);
  const plus = blocs[1];
  assert.deepEqual([plus.type, plus.top, plus.hauteur], ['plus', 103, 101], 'de 8:30 (premier du groupe) à 10:00 (dernier)');
  assert.deepEqual(plus.personnes.map((p) => p.personne), ['Agathe', 'Léa'], 'une pastille par personne');
  assert.deepEqual(plus.fiche.map((e) => e.titre), ['Dentiste', 'Orthophoniste', 'Piscine']);
  const libre = placerBlocs([
    segment(minutes(8), minutes(8, 30), 'Avant', 'Thomas'),
    segment(minutes(9), minutes(10), 'A', 'Agathe'),
    segment(minutes(9), minutes(10), 'B', 'Léa'),
    segment(minutes(9), minutes(10), 'C', 'Tom'),
  ], PLAGE, H);
  assert.deepEqual(resume(libre), [['Avant', 0, 1], ['A', 0, 0.5], ['+2', 0.5, 0.5]]);
});

test('rangée journée : chaque barre sur ses jours, dans la première ligne libre ; au-delà de deux lignes, la seule restante ou « +N » jour par jour', () => {
  const barre = (debut, fin, titre) => ({
    debut, fin, titre, coupeAvant: false, coupeApres: false, fiche: [{ titre }],
  });
  assert.deepEqual(placerJournees([barre(0, 7, 'Vacances'), barre(2, 3, 'Sortie')]).map((c) => [c.type, c.titre, c.debut, c.fin, c.ligne]), [
    ['barre', 'Vacances', 0, 7, 0], ['barre', 'Sortie', 2, 3, 1],
  ]);
  const deborde = placerJournees([barre(0, 7, 'A'), barre(1, 2, 'B'), barre(1, 3, 'C'), barre(4, 5, 'D')]);
  assert.deepEqual(deborde.map((c) => [c.type, c.titre || c.texte, c.debut, c.fin, c.ligne, Boolean(c.coupeAvant)]), [
    ['barre', 'A', 0, 7, 0, false],
    ['plus', '+2', 1, 2, 1, false],
    ['barre', 'C', 2, 3, 1, true],
    ['barre', 'D', 4, 5, 1, false],
  ], 'mardi : B et C restent, « +2 » ; mercredi : C seule, coupée à gauche');
  assert.deepEqual(deborde[1].fiche.map((e) => e.titre), ['C', 'B'], 'la fiche de « +2 » les liste (la plus longue d\'abord)');
  const suite = placerJournees([barre(0, 7, 'A'), barre(0, 1, 'B'), barre(0, 4, 'C')]);
  assert.deepEqual(suite.slice(1).map((c) => [c.type, c.titre || c.texte, c.debut, c.fin, Boolean(c.coupeAvant), Boolean(c.coupeApres)]), [
    ['plus', '+2', 0, 1, false, false], ['barre', 'C', 1, 4, true, false],
  ], 'jours consécutifs de la même barre réunis');
});

test('semaine : du lundi au dimanche, aujourd\'hui en avant, titre, légende ; rendez-vous à l\'heure en blocs avec la couleur de leur personne', () => {
  const vue = vueAgenda(AGENDA, MERCREDI_7H, 0);
  assert.equal(vue.etat, 'ok');
  assert.equal(vue.titre, 'Cette semaine · du 12 au 18 octobre');
  assert.deepEqual(vue.jours.map((j) => `${j.nom} ${j.numero}${j.aujourdhui ? ' *' : ''}`), ['Lun 12', 'Mar 13', 'Mer 14 *', 'Jeu 15', 'Ven 16', 'Sam 17', 'Dim 18']);
  assert.equal(vue.aujourdhui, 2);
  assert.deepEqual(vue.legende, [{ nom: 'Thomas', couleur: 1, initiale: 'T' }, { nom: 'Agathe', couleur: 2, initiale: 'A' }]);
  assert.deepEqual(vue.blocs.map((b) => [b.jour, b.horaire, b.titre, b.couleur, b.initiale]), [
    [2, '09:30', 'Dentiste', 1, 'T'],
    [2, '12:30', 'Déjeuner avec Paul', 2, 'A'],
    [2, '18:00', 'Entraînement de foot', 1, 'T'],
    [6, '23:30', 'Retour en voiture', 1, 'T'],
  ], 'mercredi : un bloc par rendez-vous, passés compris ; dimanche : le début du retour');
  assert.deepEqual([vue.lignesJournee, vue.hauteurHeures], [1, 778], 'une ligne de barres');
  assert.deepEqual(vue.graduations.slice(0, 2), [{ texte: '7 h', top: 0 }, { texte: '8 h', top: 60 }], 'le retour de 23:30 n\'élargit pas la grille : 7 h à 20 h');
  assert.equal(vue.graduations.length, 13);
  const retour = vue.blocs[3];
  assert.deepEqual([retour.top, retour.coupeBas], [778 - 32, true], 'collé en bas, coupé');
  assert.equal(vue.alerte, null);
  assert.deepEqual(vueAgenda(null, MERCREDI_7H, 0), { etat: 'attente' });
  assert.deepEqual(vueAgenda({ personnes: [], fenetre: null, calendriers: [], evenements: [] }, MERCREDI_7H, 0), { etat: 'vide' });
});

test('alerte : un calendrier absent de HA ou en échec est dit en clair, plusieurs séparés par « · »', () => {
  const calendriers = [...CALENDRIERS, { id: 'calendar.travail', nom: 'calendar.travail', personne: 'Thomas', etat: 'absent' }, { id: 'calendar.ecole', nom: 'École', personne: 'Agathe', etat: 'erreur' }];
  assert.equal(vueAgenda({ ...AGENDA, calendriers }, MERCREDI_7H, 0).alerte,
    'calendar.travail (Thomas) : introuvable dans Home Assistant · École (Agathe) : lecture en échec, dernière version gardée');
});

test('journée entière et événement sur deux jours : barre sur ses jours coupée au bord de la semaine, rendez-vous de nuit coupé à minuit', () => {
  const cette = vueAgenda(AGENDA, MERCREDI_7H, 0);
  assert.deepEqual(cette.journee.map((c) => [c.titre, c.debut, c.fin, c.ligne, c.coupeAvant, c.coupeApres]), [
    ['Sortie scolaire au musée', 2, 3, 0, false, false],
    ['Week-end chez les grands-parents', 5, 7, 0, false, true],
  ], 'le week-end (17 au 19) continue la semaine suivante');
  const prochaine = vueAgenda(AGENDA, MERCREDI_7H, 1);
  assert.deepEqual(prochaine.journee.map((c) => [c.titre, c.debut, c.fin, c.coupeAvant, c.coupeApres]), [['Week-end chez les grands-parents', 0, 1, true, false]]);
  assert.deepEqual(prochaine.blocs.map((b) => [b.jour, b.horaire, b.titre, b.top, b.coupeHaut]), [[0, 'fin 00:30', 'Retour en voiture', 0, true]], 'lundi 19 : la fin du retour, collée en haut d\'une grille qui commence toujours à 7 h');
  assert.deepEqual(prochaine.graduations[0], { texte: '7 h', top: 0 });
  const long = vueAgenda(agendaDe([ev('2026-10-12T09:00:00+02:00', '2026-10-14T17:00:00+02:00', 'Séminaire')]), MERCREDI_7H, 0);
  assert.deepEqual([long.blocs.length, long.journee.map((c) => [c.titre, c.debut, c.fin])], [0, [['Séminaire', 0, 3]]], 'plus de 24 h à l\'heure : en barre, comme une journée entière');
  const pile = vueAgenda(agendaDe([ev('2026-10-15T09:00:00+02:00', '2026-10-16T09:00:00+02:00', 'Garde de 24 h')]), MERCREDI_7H, 0);
  assert.deepEqual([pile.blocs.length, pile.journee.map((c) => [c.titre, c.debut, c.fin])], [0, [['Garde de 24 h', 3, 5]]], '24 h pile : en barre aussi');
  const presque = vueAgenda(agendaDe([ev('2026-10-15T09:00:00+02:00', '2026-10-16T08:59:00+02:00', 'Presque')]), MERCREDI_7H, 0);
  assert.deepEqual([presque.blocs.length, presque.journee.length, presque.lignesJournee, presque.hauteurHeures], [2, 0, 0, 828], 'moins de 24 h : deux blocs, pas de rangée journée');
});

test('changement d\'heure du 25/10/2026 : place à l\'heure de l\'horloge, avant et après', () => {
  const agenda = agendaDe([
    ev('2026-10-25T01:30:00+02:00', '2026-10-25T03:30:00+01:00', 'Nuit du changement'),
    ev('2026-10-24T09:00:00+02:00', '2026-10-24T10:00:00+02:00', 'Samedi été'),
    ev('2026-10-26T08:00:00Z', '2026-10-26T09:00:00Z', 'Kiné'),
  ]);
  const semaine = vueAgenda(agenda, MERCREDI_7H, 1);
  assert.equal(semaine.titre, 'Semaine prochaine · du 19 au 25 octobre');
  const nuit = semaine.blocs.filter((b) => b.titre === 'Nuit du changement')[0];
  assert.deepEqual([nuit.jour, nuit.debut, nuit.fin, nuit.horaire, nuit.top, nuit.coupeHaut], [6, minutes(1, 30), minutes(3, 30), '01:30', 0, true], 'dimanche 25 : 01:30 à 03:30 à l\'horloge (trois heures écoulées), collé en haut');
  assert.equal(nuit.fiche[0].horaire, 'Dimanche 25 octobre, de 01:30 à 03:30');
  assert.equal(semaine.graduations[0].texte, '7 h');
  const samedi = semaine.blocs.filter((b) => b.titre === 'Samedi été')[0];
  assert.equal(samedi.top, Math.round((minutes(9) - minutes(7)) * (H / 720)), 'samedi 9 h (UTC+2) reste à 9 h');
  const apres = vueAgenda(agenda, MERCREDI_7H, 2);
  assert.equal(apres.titre, 'Dans 2 semaines · du 26 octobre au 1er novembre');
  assert.deepEqual(apres.blocs.map((b) => [b.jour, b.horaire, b.debut]), [[0, '09:00', minutes(9)]], 'lundi 26 : 08:00 UTC est 9 h à Paris (UTC+1)');
});

test('navigation : semaines de la fenêtre lue seulement (la précédente et les deux suivantes), decalage ramené au bord ; au passage du lundi', () => {
  const nav = (vue) => [vue.decalage, vue.navigation.precedente, vue.navigation.cetteSemaine, vue.navigation.suivante];
  assert.deepEqual(nav(vueAgenda(AGENDA, MERCREDI_7H, 0)), [0, true, false, true]);
  assert.deepEqual(nav(vueAgenda(AGENDA, MERCREDI_7H, -1)), [-1, false, true, true]);
  assert.deepEqual(nav(vueAgenda(AGENDA, MERCREDI_7H, 2)), [2, true, true, false]);
  assert.deepEqual(nav(vueAgenda(AGENDA, MERCREDI_7H, 5)), [2, true, true, false], 'au-delà : la dernière semaine lue');
  assert.deepEqual(nav(vueAgenda(AGENDA, MERCREDI_7H, -3)), [-1, false, true, true]);
  assert.equal(vueAgenda(AGENDA, MERCREDI_7H, -1).titre, 'Semaine dernière · du 5 au 11 octobre');
  const lundiMinuit = Date.parse('2026-10-18T22:05:00Z');
  const enRetard = vueAgenda(AGENDA, lundiMinuit, -5);
  assert.deepEqual([nav(enRetard), enRetard.titre], [[-2, false, true, true], 'Il y a 2 semaines · du 5 au 11 octobre'], 'lundi 19 à 00:05, fenêtre de la veille : deux semaines en arrière');
  assert.equal(vueAgenda(AGENDA, lundiMinuit, 5).decalage, 1, 'et une seule en avant, jusqu\'à la relecture du serveur');
  assert.equal(vueAgenda(agendaDe([], { debut: '2026-12-21', fin: '2027-01-18' }), Date.parse('2026-12-29T10:00:00Z'), 0).titre, 'Cette semaine · du 28 décembre au 3 janvier');
});

test('ligne de l\'heure actuelle : dans la colonne d\'aujourd\'hui, à sa minute, seulement cette semaine et dans la plage', () => {
  const agenda = agendaDe([ev('2026-10-13T10:00:00+02:00', '2026-10-13T11:00:00+02:00', 'Mardi')]);
  assert.deepEqual(vueAgenda(agenda, Date.parse('2026-10-14T08:15:00Z'), 0).maintenant, { jour: 2, top: Math.round(minutes(3, 15) * (H / 720)) });
  assert.equal(vueAgenda(agenda, Date.parse('2026-10-14T08:15:00Z'), 1).maintenant, null, 'une autre semaine');
  assert.equal(vueAgenda(agenda, Date.parse('2026-10-14T18:30:00Z'), 0).maintenant, null, '20:30, hors de 7 h à 19 h');
  assert.equal(vueAgenda(agenda, Date.parse('2026-10-14T18:30:00Z'), 0).aujourdhui, 2, 'la colonne reste en avant');
  assert.equal(vueAgenda(agenda, Date.parse('2026-10-14T18:30:00Z'), 1).aujourdhui, -1);
});

test('fiches : titre complet, horaire en toutes lettres, lieu, personne ; une par bloc et par barre', () => {
  const vue = vueAgenda(AGENDA, MERCREDI_7H, 0);
  const fiche = (titre) => vue.blocs.concat(vue.journee).filter((x) => x.titre === titre)[0].fiche;
  assert.deepEqual(fiche('Dentiste'), [{
    titre: 'Dentiste', horaire: 'Mercredi 14 octobre, de 09:30 à 10:00', lieu: 'Cabinet du centre, Paris', personne: 'Thomas', couleur: 1, initiale: 'T',
  }]);
  assert.equal(fiche('Sortie scolaire au musée')[0].horaire, 'Mercredi 14 octobre, toute la journée');
  assert.equal(fiche('Week-end chez les grands-parents')[0].horaire, 'Du samedi 17 octobre au lundi 19 octobre');
  assert.equal(fiche('Retour en voiture')[0].horaire, 'Du dimanche 18 octobre à 23:30 au lundi 19 octobre à 00:30');
  assert.equal(fiche('Déjeuner avec Paul')[0].personne, 'Agathe');
  const rappel = vueAgenda(agendaDe([ev('2026-10-15T09:00:00+02:00', '2026-10-15T09:00:00+02:00', 'Rappel')]), MERCREDI_7H, 0);
  assert.equal(rappel.blocs[0].fiche[0].horaire, 'Jeudi 15 octobre, à 09:00', 'sans durée');
  const seminaire = vueAgenda(agendaDe([ev('2026-10-12T09:00:00+02:00', '2026-10-14T17:00:00+02:00', 'Séminaire')]), MERCREDI_7H, 0);
  assert.equal(seminaire.journee[0].fiche[0].horaire, 'Du lundi 12 octobre à 09:00 au mercredi 14 octobre à 17:00');
});

test('toucher : le bloc sous le doigt, sinon le plus proche de sa colonne à 40 px au plus ; case de la rangée journée visée ou seule du jour', () => {
  const blocs = [
    {
      titre: 'A', jour: 2, top: 100, hauteur: 49, gauche: 0, largeur: 0.5,
    },
    {
      titre: 'B', jour: 2, top: 100, hauteur: 36, gauche: 0.5, largeur: 0.5,
    },
    {
      titre: 'C', jour: 2, top: 300, hauteur: 36, gauche: 0, largeur: 1,
    },
  ];
  const vise = (jour, x, y) => (blocTouche(blocs, jour, x, y) || { titre: null }).titre;
  assert.equal(vise(2, 0.25, 120), 'A');
  assert.equal(vise(2, 0.75, 110), 'B');
  assert.equal(vise(2, 0.25, 185), 'A', '36 px sous A');
  assert.equal(vise(2, 0.25, 200), null, '51 px sous A, 100 au-dessus de C');
  assert.equal(vise(2, 0.6, 270), 'C', '30 px au-dessus de C');
  assert.equal(vise(3, 0.25, 120), null, 'autre jour');
  const cases = [
    {
      type: 'barre', titre: 'Sortie', debut: 2, fin: 3, ligne: 0,
    },
    {
      type: 'barre', titre: 'Week-end', debut: 5, fin: 7, ligne: 1,
    },
    {
      type: 'plus', texte: '+2', debut: 1, fin: 2, ligne: 1,
    },
  ];
  const caseVisee = (jour, ligne) => {
    const c = caseTouchee(cases, jour, ligne);
    return c ? c.titre || c.texte : null;
  };
  assert.deepEqual([caseVisee(2, 0), caseVisee(2, 1), caseVisee(6, 1), caseVisee(6, 0), caseVisee(1, 1), caseVisee(0, 0)], ['Sortie', 'Sortie', 'Week-end', 'Week-end', '+2', null]);
});
