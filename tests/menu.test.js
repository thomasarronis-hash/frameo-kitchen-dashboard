// tests/menu.test.js
//
// Rôle    : prouver le validateur partagé du menu (partage/valider-menu.js et partage/schema-menu-v1.json) :
//           le vrai menu du 10/10 converti à la main est valide, sa version de l'étape 6 (sans recettes) aussi,
//           les 3 menus cassés sont refusés avec le bon motif, et chaque règle hors schéma a son refus.
// Entrées : tests/fixtures/menu-2026-10-10.json ; tests/fixtures/menus-casses/ (créneau manquant, gamelles mal
//           placées, duree_max_s < duree_s).
// Sorties : node --test.
// Pièges  : les variantes sont faites par copie profonde de la fixture (structuredClone) : un test ne modifie
//           jamais la fixture d'un autre.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { creneauxAttendus, validerMenu } from '../partage/valider-menu.js';

const lire = (chemin) => JSON.parse(readFileSync(new URL(`./fixtures/${chemin}`, import.meta.url), 'utf8'));
const MENU = lire('menu-2026-10-10.json');
const copie = () => structuredClone(MENU);
const repas = (menu, id) => menu.repas.find((r) => r.id === id);

function refuse(menu, motif) {
  const { valide, erreurs } = validerMenu(menu);
  assert.equal(valide, false, 'menu accepté à tort');
  assert.ok(erreurs.some((erreur) => motif.test(erreur)), `aucune erreur ne correspond à ${motif} : ${JSON.stringify(erreurs)}`);
  return erreurs;
}

test('le menu du 10/10 (statut commande, 9 recettes) est valide', () => {
  assert.deepEqual(validerMenu(MENU), { valide: true, erreurs: [] });
  assert.equal(MENU.repas.filter((r) => r.recette !== null).length, 9);
  assert.equal(MENU.repas.filter((r) => r.gamelles !== null).length, 5);
});

test('sa version de l\'étape 6 (statut valide, recettes à null) est valide', () => {
  const menu = copie();
  menu.statut = 'valide';
  for (const r of menu.repas) r.recette = null;
  assert.deepEqual(validerMenu(menu), { valide: true, erreurs: [] });
});

test('les 9 créneaux attendus, du samedi midi au vendredi soir', () => {
  assert.deepEqual(creneauxAttendus('2026-10-10'), MENU.repas.map((r) => r.id));
  assert.deepEqual(creneauxAttendus('2026-12-26').slice(-2), ['2026-12-31-soir', '2027-01-01-soir']);
});

test('menu cassé 1 : créneau manquant, le créneau est nommé', () => {
  const erreurs = refuse(lire('menus-casses/creneau-manquant.json'), /^repas : créneau manquant, mardi 13\/10 soir \(2026-10-13-soir\)$/);
  assert.ok(erreurs.includes('repas : au moins 9 éléments'));
});

test('menu cassé 2 : gamelles sur samedi soir', () => {
  refuse(lire('menus-casses/gamelles-mal-placees.json'), /^repas samedi 10\/10 soir \(2026-10-10-soir\) : gamelles interdites/);
});

test('menu cassé 3 : duree_max_s inférieure à duree_s', () => {
  refuse(lire('menus-casses/duree-max-trop-courte.json'), /^repas 2026-10-10-midi, étape 2 : minuteur « Saucisson », duree_max_s \(1800\) inférieure à duree_s \(2100\)$/);
});

test('duree_max_s égale à duree_s, ou absente, est acceptée', () => {
  const menu = copie();
  const minuteur = repas(menu, '2026-10-10-midi').recette.etapes[1].minuteur;
  minuteur.duree_max_s = minuteur.duree_s;
  assert.equal(validerMenu(menu).valide, true);
  delete minuteur.duree_max_s;
  assert.equal(validerMenu(menu).valide, true);
});

test('cycle : début un samedi, fin le vendredi suivant', () => {
  const dimanche = copie();
  dimanche.cycle.debut = '2026-10-11';
  refuse(dimanche, /^cycle\.debut : 2026-10-11 est un dimanche, un samedi est attendu$/);
  const long = copie();
  long.cycle.fin = '2026-10-17';
  refuse(long, /^cycle\.fin : 2026-10-16 attendu/);
});

test('créneaux : midi de semaine inattendu, créneau en double, ordre, dates hors cycle', () => {
  const midi = copie();
  Object.assign(repas(midi, '2026-10-16-soir'), { id: '2026-10-12-midi', date: '2026-10-12', creneau: 'midi' });
  refuse(midi, /^repas\.8 : créneau inattendu \(2026-10-12-midi\)/);
  refuse(midi, /^repas : créneau manquant, vendredi 16\/10 soir/);

  const double = copie();
  Object.assign(double.repas[8], { id: '2026-10-15-soir', date: '2026-10-15' });
  refuse(double, /^repas\.8 : créneau en double, jeudi 15\/10 soir/);

  const desordre = copie();
  [desordre.repas[0], desordre.repas[1]] = [desordre.repas[1], desordre.repas[0]];
  refuse(desordre, /^repas : ordre attendu, du samedi midi au vendredi soir$/);

  const autreSemaine = copie();
  Object.assign(autreSemaine.repas[8], { id: '2026-10-23-soir', date: '2026-10-23' });
  refuse(autreSemaine, /créneau inattendu \(2026-10-23-soir\)/);
});

test('ids : égal à date-créneau, unique', () => {
  const menu = copie();
  menu.repas[2].id = '2026-10-11-soir';
  const erreurs = refuse(menu, /^repas\.2\.id : 2026-10-11-midi attendu \(date-créneau\), 2026-10-11-soir reçu$/);
  assert.ok(erreurs.some((erreur) => /^repas\.3\.id : id en double \(2026-10-11-soir\)$/.test(erreur)), JSON.stringify(erreurs));
});

test('gamelles : pour = le lendemain, un seul repas par jour de gamelles, dimanche soir permis, vendredi soir refusé', () => {
  const pour = copie();
  repas(pour, '2026-10-12-soir').gamelles.pour = '2026-10-14';
  refuse(pour, /^repas 2026-10-12-soir : gamelles\.pour doit être le lendemain \(2026-10-13\), 2026-10-14 reçu$/);

  const deux = copie();
  repas(deux, '2026-10-11-soir').gamelles = { portions: 2, pour: '2026-10-12' };
  refuse(deux, /^repas 2026-10-11-soir : les gamelles du 2026-10-12 viennent déjà de 2026-10-11-midi$/);

  const dimancheSoir = copie();
  repas(dimancheSoir, '2026-10-11-midi').gamelles = null;
  repas(dimancheSoir, '2026-10-11-soir').gamelles = { portions: 2, pour: '2026-10-12' };
  assert.equal(validerMenu(dimancheSoir).valide, true);

  const vendredi = copie();
  repas(vendredi, '2026-10-16-soir').gamelles = { portions: 2, pour: '2026-10-17' };
  refuse(vendredi, /^repas vendredi 16\/10 soir \(2026-10-16-soir\) : gamelles interdites/);
});

test('rappels : repas_id existant, date dans le cycle', () => {
  const inconnu = copie();
  inconnu.rappels[0].repas_id = '2026-10-12-midi';
  refuse(inconnu, /^rappels\.0 : repas_id inconnu \(2026-10-12-midi\)$/);
  const hors = copie();
  hors.rappels[1].date = '2026-10-09';
  refuse(hors, /^rappels\.1 : 2026-10-09 hors du cycle \(2026-10-10 au 2026-10-16\)$/);
});

test('schéma : champ non prévu, statut inconnu, étiquette inconnue, texte trop long, format de date, messages en français', () => {
  const champ = copie();
  champ.panier = [];
  refuse(champ, /^menu : champ non prévu : panier$/);

  const statut = copie();
  statut.statut = 'brouillon';
  refuse(statut, /^statut : valeur attendue parmi "valide", "commande"$/);

  const tag = copie();
  tag.repas[0].tags = ['epice'];
  refuse(tag, /^repas\.0\.tags\.0 : valeur attendue parmi/);

  const long = copie();
  long.repas[0].titre = 'x'.repeat(81);
  refuse(long, /^repas\.0\.titre : au plus 80 caractères$/);

  const date = copie();
  date.repas[0].gamelles = { portions: 2, pour: '2026-02-30' };
  refuse(date, /^repas\.0\.gamelles\.pour : format attendu : date$/);

  const etape = copie();
  etape.repas[1].recette.etapes[0].four.temperature_c = 400;
  refuse(etape, /^repas\.1\.recette\.etapes\.0\.four\.temperature_c : au plus 300$/);
});

test('ce qui n\'est pas un menu est refusé sans lever d\'exception', () => {
  for (const valeur of [null, 'menu', 42, [], {}]) {
    const { valide, erreurs } = validerMenu(valeur);
    assert.equal(valide, false, JSON.stringify(valeur));
    assert.ok(erreurs.length > 0);
  }
  const invalide = copie();
  invalide.cycle.debut = '2026-02-30';
  refuse(invalide, /^cycle\.debut : format attendu : date$/);
});
