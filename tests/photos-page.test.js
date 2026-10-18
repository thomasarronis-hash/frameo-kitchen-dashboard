// tests/photos-page.test.js
//
// Rôle    : prouver les règles du mode Photos côté page, sans DOM : le diaporama (web/src/photos.js) compose les
//           portraits par PAIRES, montre un portrait seul s'il n'en reste pas d'autre, ne précharge qu'une vue, passe à
//           la suivante sur une photo indisponible (l'autre portrait retrouve une paire) ou sur une vue pas prête au bout
//           de 20 s (transfert qui cale, constat du 14/10), fait une pause après 3 échecs, bascule toutes les 30 s
//           seulement quand la suivante est chargée, relit le lot toutes les 30 min (5 min après un échec), repart du
//           même lot quand la file est vide ; la décision d'entrer dans le mode Photos (web/src/pilotage.js : préparation
//           de la première vue dès 2 min sans toucher, entrée à 3 min seulement avec elle chargée, jamais pendant une
//           recette, une alerte de minuteur, le bandeau sonnette, la nuit, sans photos ni hors ligne ; sortie la nuit et
//           hors ligne) ; les pastilles (web/src/ecrans/photos-donnees.js).
// Entrées : des lots comme GET /api/photos/lot les rend, une horloge monotone en ms, des états de page.
// Sorties : node --test.
// Pièges  : les identifiants doivent être des uuid en minuscules (le diaporama écarte les autres).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ligneMinuteur, vuePhotos } from '../web/src/ecrans/photos-donnees.js';
import {
  creerDiaporama, DELAI_CHARGEMENT_MS, DUREE_PHOTO_MS, ECHECS_AVANT_PAUSE, NOUVEL_ESSAI_LOT_MS, PAUSE_APRES_ECHECS_MS, photosValides,
  RELIRE_LOT_MS, URL_PHOTO,
} from '../web/src/photos.js';
import { AVANCE_PREPARATION_MS, decisionPhotos, DELAI_PHOTOS_MS } from '../web/src/pilotage.js';

const ID = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const paysage = (n) => ({ id: ID(n), portrait: false, legende: `Lieu ${n}` });
const portrait = (n) => ({ id: ID(n), portrait: true, legende: null });
const numeros = (vue) => vue.photos.map((photo) => Number(photo.id.slice(-3)));

// Charge toutes les images de la vue suivante et bascule ; rend [disposition, numéros].
function montrerSuivante(diapo, ms) {
  const vue = diapo.aPrecharger(ms);
  if (!vue) return null;
  vue.photos.forEach((photo) => diapo.imageChargee(vue.cle, photo.id));
  assert.equal(diapo.aBasculer(ms), true, 'vue chargée : bascule permise');
  const affichee = diapo.basculer(ms);
  return [affichee.disposition, numeros(affichee)];
}

test('lot : identifiants contrôlés et dédoublonnés ; URL de la photo', () => {
  assert.deepEqual(photosValides([paysage(1), { id: '../x', portrait: true }, paysage(1), { id: ID(2).toUpperCase() }, null, { id: ID(3), portrait: 'oui', legende: 4 }]),
    [{ id: ID(1), portrait: false, legende: 'Lieu 1' }, { id: ID(3), portrait: false, legende: null }]);
  assert.deepEqual(photosValides({ photos: [] }), []);
  assert.equal(URL_PHOTO(ID(1)), `/api/photos/${ID(1)}.jpg`);
});

test('diaporama : portraits par paires (même éloignés), paysage seul, portrait isolé quand il n\'en reste pas d\'autre', () => {
  const diapo = creerDiaporama();
  assert.equal(diapo.pretes(), false);
  diapo.recevoirLot([paysage(1), portrait(2), paysage(3), paysage(4), portrait(5), portrait(6), paysage(7)], 0);
  assert.equal(diapo.pretes(), true);
  const vues = [];
  for (let i = 0; i < 5; i += 1) vues.push(montrerSuivante(diapo, i * DUREE_PHOTO_MS));
  assert.deepEqual(vues, [['paysage', [1]], ['paire', [2, 5]], ['paysage', [3]], ['paysage', [4]], ['portrait', [6]]]);
});

test('diaporama : une seule vue préchargée (2 images au plus), bascule à 30 s et seulement une fois chargée', () => {
  const diapo = creerDiaporama();
  diapo.recevoirLot([portrait(1), portrait(2), paysage(3)], 0);
  const premiere = diapo.aPrecharger(0);
  assert.equal(diapo.aPrecharger(0), premiere, 'la même vue tant qu\'elle n\'est pas affichée');
  assert.equal(premiere.photos.length, 2);
  assert.equal(diapo.aBasculer(0), false, 'rien de chargé');
  diapo.imageChargee(premiere.cle, ID(1));
  assert.equal(diapo.aBasculer(0), false, 'une image sur deux');
  diapo.imageChargee(premiere.cle, ID(2));
  diapo.imageChargee(premiere.cle, ID(9));
  assert.equal(diapo.aBasculer(0), true, 'première vue : tout de suite');
  diapo.basculer(1000);
  const suivante = diapo.aPrecharger(1000);
  diapo.imageChargee(suivante.cle, ID(3));
  assert.equal(diapo.aBasculer(1000 + DUREE_PHOTO_MS - 1), false, '30 s par vue');
  assert.equal(diapo.aBasculer(1000 + DUREE_PHOTO_MS), true);
  diapo.imageChargee(premiere.cle, ID(3));
  assert.deepEqual(numeros(diapo.basculer(1000 + DUREE_PHOTO_MS)), [3], 'un chargement d\'une vue dépassée est ignoré');
});

test('diaporama : photo indisponible -> retirée, l\'autre portrait retrouve une paire, la vue affichée reste', () => {
  const diapo = creerDiaporama();
  diapo.recevoirLot([paysage(1), portrait(2), portrait(3), portrait(4)], 0);
  montrerSuivante(diapo, 0);
  const paire = diapo.aPrecharger(10);
  assert.deepEqual(numeros(paire), [2, 3]);
  diapo.imageChargee(paire.cle, ID(3));
  diapo.imageEchouee(paire.cle, ID(2), 20);
  assert.equal(diapo.aBasculer(DUREE_PHOTO_MS), false, 'rien de prêt : la vue affichée reste (pas d\'écran vide)');
  const reprise = diapo.aPrecharger(30);
  assert.deepEqual([reprise.disposition, numeros(reprise)], ['paire', [3, 4]]);
  diapo.imageEchouee(paire.cle, ID(3), 40);
  assert.equal(diapo.aPrecharger(40), reprise, 'un échec d\'une vue dépassée est ignoré');
  reprise.photos.forEach((photo) => diapo.imageChargee(reprise.cle, photo.id));
  assert.deepEqual(numeros(diapo.basculer(DUREE_PHOTO_MS)), [3, 4]);
  assert.deepEqual(montrerSuivante(diapo, 2 * DUREE_PHOTO_MS), ['paysage', [1]], 'la photo 2 a quitté le lot : la file repart sans elle');
  assert.deepEqual(montrerSuivante(diapo, 3 * DUREE_PHOTO_MS), ['paire', [3, 4]]);
});

test('diaporama : après 3 échecs de suite, pause d\'une minute (Immich en panne : pas 100 demandes d\'affilée) et lot redemandé', () => {
  const diapo = creerDiaporama();
  diapo.recevoirLot([1, 2, 3, 4, 5, 6].map(paysage), 0);
  for (let i = 0; i < ECHECS_AVANT_PAUSE; i += 1) {
    assert.equal(diapo.besoinDeLot(100), false, `pas de relecture avant le 3e échec (${i})`);
    const vue = diapo.aPrecharger(100);
    diapo.imageEchouee(vue.cle, vue.photos[0].id, 100);
  }
  assert.equal(diapo.besoinDeLot(100), true, 'lot redemandé tout de suite (serveur redémarré : son lot précédent n\'a plus cours)');
  assert.equal(diapo.aPrecharger(100 + PAUSE_APRES_ECHECS_MS - 1), null, 'en pause');
  assert.equal(diapo.enPanne(100), true, 'rien d\'affiché : « Photos indisponibles »');
  const apres = diapo.aPrecharger(100 + PAUSE_APRES_ECHECS_MS);
  assert.deepEqual(numeros(apres), [4]);
  apres.photos.forEach((photo) => diapo.imageChargee(apres.cle, photo.id));
  diapo.basculer(100 + PAUSE_APRES_ECHECS_MS);
  assert.equal(diapo.enPanne(100 + PAUSE_APRES_ECHECS_MS), false);
});

test('diaporama : toutes les photos du lot indisponibles -> plus rien de prêt, lot redemandé 5 min plus tard', () => {
  const diapo = creerDiaporama();
  diapo.recevoirLot([paysage(1)], 0);
  diapo.imageEchouee(diapo.aPrecharger(0).cle, ID(1), 1000);
  assert.deepEqual([diapo.pretes(), diapo.enPanne(1000)], [false, true]);
  assert.equal(diapo.besoinDeLot(1000 + NOUVEL_ESSAI_LOT_MS - 1), false);
  assert.equal(diapo.besoinDeLot(1000 + NOUVEL_ESSAI_LOT_MS), true);
});

test('lot : demandé tout de suite, relu toutes les 30 min, 5 min après un échec ; un échec garde l\'ancien lot', () => {
  const diapo = creerDiaporama();
  assert.equal(diapo.besoinDeLot(0), true);
  diapo.lotDemande();
  assert.equal(diapo.besoinDeLot(0), false, 'une seule demande à la fois');
  diapo.echecLot(0);
  assert.equal(diapo.pretes(), false);
  assert.equal(diapo.besoinDeLot(NOUVEL_ESSAI_LOT_MS - 1), false);
  assert.equal(diapo.besoinDeLot(NOUVEL_ESSAI_LOT_MS), true);
  diapo.lotDemande();
  diapo.recevoirLot([paysage(1), paysage(2)], NOUVEL_ESSAI_LOT_MS);
  assert.equal(diapo.besoinDeLot(NOUVEL_ESSAI_LOT_MS + RELIRE_LOT_MS - 1), false);
  assert.equal(diapo.besoinDeLot(NOUVEL_ESSAI_LOT_MS + RELIRE_LOT_MS), true, 'relu au bout de 30 min');
  diapo.lotDemande();
  diapo.echecLot(NOUVEL_ESSAI_LOT_MS + RELIRE_LOT_MS);
  assert.equal(diapo.pretes(), true, 'l\'ancien lot continue');
  diapo.recevoirLot([], 0);
  assert.equal(diapo.pretes(), false);
});

test('lot neuf : sans les photos affichée et préchargée ; file vide avant la relecture : on repart du même lot sans la vue affichée', () => {
  const diapo = creerDiaporama();
  diapo.recevoirLot([paysage(1), paysage(2)], 0);
  montrerSuivante(diapo, 0);
  diapo.aPrecharger(DUREE_PHOTO_MS - 20);
  diapo.recevoirLot([paysage(1), paysage(2), paysage(3)], DUREE_PHOTO_MS - 10);
  assert.deepEqual(montrerSuivante(diapo, DUREE_PHOTO_MS), ['paysage', [2]], 'la vue déjà préchargée passe');
  assert.deepEqual(montrerSuivante(diapo, 2 * DUREE_PHOTO_MS), ['paysage', [3]], '1 et 2 ne reviennent pas tout de suite');
  assert.deepEqual(montrerSuivante(diapo, 3 * DUREE_PHOTO_MS), ['paysage', [1]], 'file vide : le lot recommence, sans la 3 affichée');
  const unique = creerDiaporama();
  unique.recevoirLot([paysage(1)], 0);
  montrerSuivante(unique, 0);
  assert.equal(unique.aPrecharger(DUREE_PHOTO_MS), null, 'une seule photo : elle reste à l\'écran');
});

test('arreter : la vue préchargée revient en tête de file, rien n\'est affiché', () => {
  const diapo = creerDiaporama();
  diapo.recevoirLot([paysage(1), paysage(2), paysage(3)], 0);
  montrerSuivante(diapo, 0);
  diapo.aPrecharger(10);
  diapo.arreter();
  assert.deepEqual(montrerSuivante(diapo, 20), ['paysage', [2]]);
});

test('diaporama : vue pas prête 20 s après sa composition (transfert qui cale) -> remplacée ; la photo chargée revient en tête, l\'autre quitte le lot', () => {
  assert.equal(DELAI_CHARGEMENT_MS, 20000);
  const diapo = creerDiaporama();
  diapo.recevoirLot([portrait(1), portrait(2), paysage(3), paysage(4)], 0);
  const paire = diapo.aPrecharger(1000);
  assert.deepEqual([paire.disposition, numeros(paire)], ['paire', [1, 2]]);
  diapo.imageChargee(paire.cle, ID(1));
  assert.equal(diapo.vuePrete(), false, 'une image sur deux : pas prête');
  assert.equal(diapo.aPrecharger(1000 + 20000 - 1), paire, 'la même vue jusqu\'à 20 s');
  const suivante = diapo.aPrecharger(1000 + 20000);
  assert.notEqual(suivante.cle, paire.cle, 'nouvelle vue : la page remplace les src, le transfert calé est abandonné');
  assert.deepEqual([suivante.disposition, numeros(suivante)], ['portrait', [1]], 'la 1, chargée, revient en tête ; la 2 n\'est plus là pour la paire');
  assert.equal(diapo.vuePrete(), false);
  diapo.imageChargee(suivante.cle, ID(1));
  assert.equal(diapo.vuePrete(), true, 'toutes ses images chargées');
  assert.equal(diapo.aPrecharger(1000 + 60000), suivante, 'une vue prête n\'est jamais abandonnée, même longtemps après');
  const montrees = [];
  for (let i = 0; i < 6; i += 1) montrees.push(...montrerSuivante(diapo, 61000 + i * DUREE_PHOTO_MS)[1]);
  assert.ok(!montrees.includes(2), `la 2 ne revient pas (${montrees})`);
});

test('diaporama : trois vues trop lentes de suite -> pause d\'une minute et lot redemandé, comme trois photos indisponibles', () => {
  const diapo = creerDiaporama();
  diapo.recevoirLot([paysage(1), paysage(2), paysage(3), paysage(4), paysage(5)], 0);
  let t = 0;
  for (let i = 0; i < ECHECS_AVANT_PAUSE; i += 1) {
    assert.ok(diapo.aPrecharger(t), `vue ${i + 1} composée`);
    t += DELAI_CHARGEMENT_MS;
  }
  assert.equal(diapo.aPrecharger(t), null, '3e vue abandonnée : pause, plus rien de demandé');
  assert.equal(diapo.besoinDeLot(t), true, 'lot redemandé tout de suite');
  assert.equal(diapo.enPanne(t), true, 'rien d\'affiché');
  assert.equal(diapo.aPrecharger(t + PAUSE_APRES_ECHECS_MS - 1), null);
  assert.deepEqual(numeros(diapo.aPrecharger(t + PAUSE_APRES_ECHECS_MS)), [4], 'reprise après la pause, sans les 3 photos trop lentes');
});

const CALME = {
  enPhotos: false, inactifMs: DELAI_PHOTOS_MS, recetteOuverte: false, alerteVisible: false, sonnetteVisible: false, nuit: false, photosPretes: true, vuePrete: true, enLigne: true, ecranRetenu: false,
};

test('mode Photos : entrée après 3 min sans toucher ; jamais pendant une recette, une alerte, le bandeau sonnette, la nuit, sans photos, hors ligne ni écran retenu', () => {
  assert.equal(decisionPhotos(CALME), 'entrer');
  assert.equal(decisionPhotos({ ...CALME, minuteursActifs: true }), 'entrer', 'un minuteur qui tourne s\'affiche dans le mode Photos, seule son alerte l\'empêche');
  assert.equal(DELAI_PHOTOS_MS, 180000);
  assert.equal(decisionPhotos({ ...CALME, inactifMs: DELAI_PHOTOS_MS - 1 }), 'preparer', 'vue déjà prête, mais pas encore 3 min');
  for (const cle of ['recetteOuverte', 'alerteVisible', 'sonnetteVisible', 'nuit', 'ecranRetenu', 'minuteurEcran']) {
    assert.equal(decisionPhotos({ ...CALME, [cle]: true }), 'rien', cle);
  }
  for (const cle of ['photosPretes', 'enLigne']) {
    assert.equal(decisionPhotos({ ...CALME, [cle]: false }), 'rien', cle);
  }
});

test('mode Photos : première vue préparée dès 2 min sans toucher ; entrée à 3 min seulement si elle est chargée (sinon l\'Accueil reste)', () => {
  assert.equal(AVANCE_PREPARATION_MS, 60000);
  const pasPrete = { ...CALME, vuePrete: false };
  assert.equal(decisionPhotos({ ...pasPrete, inactifMs: 120000 - 1 }), 'rien', 'avant 2 min : rien de chargé');
  assert.equal(decisionPhotos({ ...pasPrete, inactifMs: 120000 }), 'preparer');
  assert.equal(decisionPhotos(pasPrete), 'preparer', '3 min, vue pas encore chargée : pas d\'écran vide, on attend');
  assert.equal(decisionPhotos({ ...pasPrete, inactifMs: 3600000 }), 'preparer', 'Wi-Fi qui ne revient pas : l\'Accueil reste, la préparation continue');
  assert.equal(decisionPhotos({ ...pasPrete, vuePrete: undefined }), 'preparer', 'vuePrete absent : jamais d\'entrée');
  for (const cle of ['recetteOuverte', 'alerteVisible', 'sonnetteVisible', 'nuit', 'ecranRetenu', 'minuteurEcran']) {
    assert.equal(decisionPhotos({ ...pasPrete, inactifMs: 150000, [cle]: true }), 'rien', `${cle} : préparation arrêtée`);
  }
  for (const cle of ['photosPretes', 'enLigne']) {
    assert.equal(decisionPhotos({ ...pasPrete, inactifMs: 150000, [cle]: false }), 'rien', cle);
  }
});

test('mode Photos : on y reste (minuteur, bandeau sonnette et alerte passent par-dessus) ; sortie la nuit ou hors ligne', () => {
  const dedans = { ...CALME, enPhotos: true };
  assert.equal(decisionPhotos(dedans), 'rien');
  assert.equal(decisionPhotos({ ...dedans, sonnetteVisible: true, alerteVisible: true, inactifMs: 0 }), 'rien');
  assert.equal(decisionPhotos({ ...dedans, photosPretes: false }), 'rien', 'la vue affichée reste, rien n\'est vide');
  assert.equal(decisionPhotos({ ...dedans, nuit: true }), 'sortir', '23h : la nuit reste l\'horloge seule');
  assert.equal(decisionPhotos({ ...dedans, enLigne: false }), 'sortir', 'le bandeau hors ligne de l\'Accueil doit se voir');
});

test('pastilles : heure et date de Paris, météo de HA, « Ce soir » du menu (rien sans menu), ligne du minuteur', () => {
  const ms = Date.parse('2026-10-13T18:42:00Z');
  const donnees = {
    entites: { 'weather.forecast_maison': { state: 'cloudy', attributes: { temperature: 14.2, temperature_unit: '°C' } } },
    pluie: null,
    menu: null,
  };
  const vue = vuePhotos(donnees, ms);
  assert.equal(vue.heure, '20:42');
  assert.equal(vue.date, 'Mardi 13 octobre');
  assert.equal(vue.meteo.temperature, '14°');
  assert.equal(vue.soir, null, 'pas de « Menu pas encore publié » sur une photo');
  assert.equal(vuePhotos({ entites: {}, pluie: null, menu: null }, ms).meteo, null);
  assert.equal(ligneMinuteur(null), null);
  assert.deepEqual(ligneMinuteur({ temps: '4:32', libelle: 'Minuteur 1', autres: '+1', sonne: false }), { temps: '4:32', libelle: 'Minuteur 1 +1' });
  assert.deepEqual(ligneMinuteur({ temps: '0:05', libelle: 'Saucisson', autres: '', sonne: false }), { temps: '0:05', libelle: 'Saucisson' });
});
