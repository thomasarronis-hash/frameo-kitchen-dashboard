// tests/repas-recette.test.js
//
// Rôle    : prouver ce que la page tire du menu, sans DOM : écran Repas (web/src/ecrans/repas-donnees.js : 7
//           jours, midis de semaine déduits des gamelles, aujourd'hui, étiquettes, « Recette à venir »), choix du
//           repas de l'Accueil (midi le week-end avant 14h, soir sinon, hors cycle, sans menu), lignes de « La
//           semaine » ; recette pas à pas (web/src/ecrans/recette-donnees.js : pages, minuteur et four d'une
//           étape, astuces, ingrédients cochés gardés et remis à zéro au changement de cycle).
// Entrées : tests/fixtures/menu-2026-10-10.json, le vrai menu du 10/10 converti à la main ; un faux localStorage.
// Sorties : node --test.
// Pièges  : les heures sont données en UTC ; le 11/10/2026, Paris est en UTC+2 (12:00 UTC = 14:00 à Paris).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  bornerPage, creerCoches, enteteRecette, nombrePages, vuePage,
} from '../web/src/ecrans/recette-donnees.js';
import {
  lignesSemaine, repasAffiche, repasDuJour, trouverRepas, vueRepas,
} from '../web/src/ecrans/repas-donnees.js';
import { creerStockage } from '../web/src/stockage.js';

const MENU = JSON.parse(readFileSync(new URL('./fixtures/menu-2026-10-10.json', import.meta.url), 'utf8'));
const utc = (texte) => Date.parse(`${texte}Z`);
const ESP = ' ';

function fauxLocalStorage() {
  const valeurs = new Map();
  return { getItem: (cle) => (valeurs.has(cle) ? valeurs.get(cle) : null), setItem: (cle, v) => valeurs.set(cle, String(v)), removeItem: (cle) => valeurs.delete(cle) };
}

test('écran Repas : les 7 jours du cycle, midi et soir, aujourd\'hui en avant', () => {
  const vue = vueRepas(MENU, utc('2026-10-11T16:00'));
  assert.equal(vue.titre, 'Du samedi 10 octobre au vendredi 16 octobre');
  assert.equal(vue.message, null);
  assert.deepEqual(vue.jours.map((jour) => jour.nom), ['Sam 10', 'Dim 11', 'Lun 12', 'Mar 13', 'Mer 14', 'Jeu 15', 'Ven 16']);
  assert.deepEqual(vue.jours.map((jour) => jour.aujourdhui), [false, true, false, false, false, false, false]);
  assert.deepEqual(vue.jours[0].midi, {
    id: '2026-10-10-midi', titre: 'Saucisson à cuire', accompagnement: 'Pommes de terre vapeur, carottes, moutarde',
    temps: '50 min', etiquettes: ['frigo seul'], recette: true, gamelle: false,
  });
  assert.equal(vue.jours[1].midi.temps, '1 h 15');
  assert.deepEqual(vue.jours[1].soir.etiquettes, ['sans viande']);
  assert.equal(vue.jours[4].soir.accompagnement, 'Œufs, jambon, petits pois, carottes');
  assert.equal(vue.jours[3].soir.accompagnement, '', 'gratin sans accompagnement');
});

test('écran Repas : midis de semaine déduits des gamelles de la veille (9 repas, pas un de plus)', () => {
  const vue = vueRepas(MENU, utc('2026-10-11T16:00'));
  assert.deepEqual(vue.jours.slice(2).map((jour) => jour.midi), [
    { gamelle: true, titre: 'Rôti de porc' },
    { gamelle: true, titre: 'Colin façon fish & chips' },
    { gamelle: true, titre: 'Gratin de pâtes au jambon et petits pois' },
    { gamelle: true, titre: 'Riz cantonais maison' },
    { gamelle: true, titre: 'Boulettes à la sauce tomate et aux courgettes' },
  ]);
  const vrais = vue.jours.reduce((n, jour) => n + [jour.midi, jour.soir].filter((c) => c && !c.gamelle).length, 0);
  assert.equal(vrais, 9);
  assert.deepEqual(repasDuJour(MENU, '2026-10-17'), { midi: null, soir: null, gamelle: null });
});

test('écran Repas : « Recette à venir » (recette null au statut valide), pas de menu = état vide', () => {
  const valide = structuredClone(MENU);
  valide.statut = 'valide';
  valide.repas.forEach((repas) => { repas.recette = null; });
  assert.equal(vueRepas(valide, utc('2026-10-11T16:00')).jours[0].midi.recette, false);
  assert.deepEqual(vueRepas(null, utc('2026-10-11T16:00')), { titre: 'Repas de la semaine', message: 'Menu pas encore publié', jours: [] });
});

test('Accueil : le midi le week-end avant 14h, le soir ensuite ; le soir seulement en semaine', () => {
  const dimancheMidi = repasAffiche(MENU, utc('2026-10-11T11:59'));
  assert.deepEqual(dimancheMidi, {
    intitule: 'Ce midi', titre: 'Rôti de porc', details: '1 h 15 · Pommes de terre fondantes, haricots verts', repasId: '2026-10-11-midi', message: null,
  });
  const dimancheSoir = repasAffiche(MENU, utc('2026-10-11T12:00'));
  assert.deepEqual([dimancheSoir.intitule, dimancheSoir.titre, dimancheSoir.details], ['Ce soir', 'Tartines gratinées aux aubergines et à la mozzarella', '20 min · Salade verte']);
  const lundiMidi = repasAffiche(MENU, utc('2026-10-12T10:00'));
  assert.deepEqual([lundiMidi.intitule, lundiMidi.titre], ['Ce soir', 'Colin façon fish & chips'], 'en semaine, le midi est une gamelle');
  assert.equal(repasAffiche(MENU, utc('2026-10-13T18:00')).details, '35 min', 'sans accompagnement');
  assert.equal(repasAffiche(MENU, utc('2026-10-16T21:59')).titre, 'Quiche poireau et lardons', 'vendredi 23:59 à Paris');
});

test('Accueil : hors du cycle ou sans menu, « Menu pas encore publié » ; sans recette, pas de bouton', () => {
  const vide = { intitule: 'Ce soir', titre: null, details: '', repasId: null, message: 'Menu pas encore publié' };
  assert.deepEqual(repasAffiche(MENU, utc('2026-10-16T22:00')), vide, 'samedi 17 à 0h, nouveau cycle pas publié');
  assert.deepEqual(repasAffiche(MENU, utc('2026-10-09T12:00')), vide);
  assert.deepEqual(repasAffiche(null, utc('2026-10-11T12:00')), vide);
  const valide = structuredClone(MENU);
  valide.repas[3].recette = null;
  assert.equal(repasAffiche(valide, utc('2026-10-11T16:00')).repasId, null);
  assert.equal(repasAffiche(valide, utc('2026-10-11T16:00')).titre, 'Tartines gratinées aux aubergines et à la mozzarella');
});

test('« La semaine » : midi et soir le week-end, le soir en semaine, rien hors du menu ; aujourd\'hui après 14h, le soir seul', () => {
  const samedi9h = utc('2026-10-10T07:00');
  assert.deepEqual(lignesSemaine(MENU, '2026-10-10', samedi9h), ['Midi · Saucisson à cuire', 'Soir · Burgers maison']);
  assert.deepEqual(lignesSemaine(MENU, '2026-10-11', samedi9h), ['Midi · Rôti de porc', 'Soir · Tartines gratinées aux aubergines et à la mozzarella']);
  assert.deepEqual(lignesSemaine(MENU, '2026-10-12', samedi9h), ['Colin façon fish & chips']);
  assert.deepEqual(lignesSemaine(MENU, '2026-10-17', samedi9h), []);
  assert.deepEqual(lignesSemaine(null, '2026-10-12', samedi9h), []);
  const dimanche = (heure) => utc(`2026-10-11T${heure}`);
  assert.deepEqual(lignesSemaine(MENU, '2026-10-11', dimanche('11:59')), ['Midi · Rôti de porc', 'Soir · Tartines gratinées aux aubergines et à la mozzarella'], '13:59 à Paris');
  assert.deepEqual(lignesSemaine(MENU, '2026-10-11', dimanche('12:00')), ['Tartines gratinées aux aubergines et à la mozzarella'], '14:00 à Paris : le midi est passé');
  assert.deepEqual(lignesSemaine(MENU, '2026-10-10', dimanche('16:00')).length, 2, 'un autre jour garde ses deux repas');
});

test('recette : en-tête, pages des étapes puis des astuces, bornes, boutons Précédent et Suivant', () => {
  const saucisson = trouverRepas(MENU, '2026-10-10-midi');
  assert.deepEqual(enteteRecette(saucisson), { titre: 'Saucisson à cuire', details: '2 adultes et 2 enfants · préparation 10 min · cuisson 40 min' });
  const recette = saucisson.recette;
  assert.equal(nombrePages(recette), 6, '5 étapes + astuces');
  const premiere = vuePage(recette, 0);
  assert.deepEqual([premiere.numero, premiere.precedent, premiere.suivant, premiere.minuteur], ['Étape 1/5', false, true, null]);
  const derniere = vuePage(recette, 4);
  assert.deepEqual([derniere.numero, derniere.suivant], ['Étape 5/5', true], 'les astuces viennent après');
  const astuces = vuePage(recette, 5);
  assert.deepEqual([astuces.numero, astuces.suivant, astuces.precedent, astuces.astuces.length], ['Astuces', false, true, 2]);
  assert.equal(bornerPage(recette, 99), 5);
  assert.equal(bornerPage(recette, -3), 0);
  const sansAstuces = { ...recette, astuces: [] };
  assert.equal(nombrePages(sansAstuces), 5);
  assert.equal(vuePage(sansAstuces, 4).suivant, false);
  assert.equal(trouverRepas(MENU, 'inconnu'), null);
  assert.equal(trouverRepas(null, '2026-10-10-midi'), null);
});

test('recette : minuteur d\'étape « Lancer Saucisson 35 min » avec 5 min de plus proposées, four et gril', () => {
  const saucisson = trouverRepas(MENU, '2026-10-10-midi').recette;
  assert.deepEqual(vuePage(saucisson, 1).minuteur, { libelle: 'Saucisson', dureeMs: 2_100_000, surplusMs: 300_000, texte: 'Lancer Saucisson 35 min' });
  const burgers = trouverRepas(MENU, '2026-10-10-soir').recette;
  assert.equal(vuePage(burgers, 0).four, `Four 210${ESP}°C`);
  assert.deepEqual(vuePage(burgers, 3).minuteur, { libelle: 'Cheddar', dureeMs: 60_000, surplusMs: 0, texte: 'Lancer Cheddar 1 min' });
  const tartines = trouverRepas(MENU, '2026-10-11-soir').recette;
  assert.equal(vuePage(tartines, 0).four, `Gril 220${ESP}°C`);
  assert.equal(vuePage(tartines, 2).four, null);
});

test('ingrédients cochés : gardés par recette d\'un chargement à l\'autre, remis à zéro au changement de cycle', () => {
  const disque = fauxLocalStorage();
  const coches = creerCoches({ stockage: creerStockage(disque) });
  assert.deepEqual(coches.lire('2026-10-10', '2026-10-10-midi'), []);
  coches.basculer('2026-10-10', '2026-10-10-midi', 2);
  coches.basculer('2026-10-10', '2026-10-10-midi', 0);
  coches.basculer('2026-10-10', '2026-10-10-soir', 1);
  assert.deepEqual(coches.basculer('2026-10-10', '2026-10-10-midi', 2), [0], 'décoché');
  const apres = creerCoches({ stockage: creerStockage(disque) });
  assert.deepEqual(apres.lire('2026-10-10', '2026-10-10-midi'), [0]);
  assert.deepEqual(apres.lire('2026-10-10', '2026-10-10-soir'), [1]);
  assert.deepEqual(apres.lire('2026-10-17', '2026-10-10-soir'), [], 'autre cycle');
  apres.basculer('2026-10-17', '2026-10-17-midi', 3);
  assert.deepEqual(apres.lire('2026-10-10', '2026-10-10-midi'), [], 'l\'ancien cycle est effacé');
  disque.setItem('cadre.ingredients', JSON.stringify({ cycle: '2026-10-17', recettes: { r: [1, 'x', -2, 2.5, 4] } }));
  assert.deepEqual(apres.lire('2026-10-17', 'r'), [1, 4], 'entrées abîmées ignorées');
});
