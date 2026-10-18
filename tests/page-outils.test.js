// tests/page-outils.test.js
//
// Rôle    : prouver les petits modules de la page testables sans DOM : façade du pont Kiosk
//           (web/src/kiosque.js : luminosité, volume remonté seulement s'il est plus bas), inactivité
//           (web/src/inactivite.js), mise à l'échelle
//           de la scène (web/src/scene.js), textes de connexion du menu et du bandeau hors ligne (sur l'Accueil
//           seulement), écritures du DOM faites seulement quand la valeur change (web/src/dom.js), stockage local
//           qui ne lève jamais (web/src/stockage.js) et gestes des actions (web/src/composants/appui.js :
//           tolérance de 20 px, anti-répétition de 300 ms, partagée par les lignes d'une liste, appui long).
// Entrées : faux pont, fausse horloge monotone, faux nœuds qui comptent leurs écritures.
// Sorties : node --test.
// Pièges  : menu.js et bandeau-hors-ligne.js importent dom.js, qui ne touche au document qu'à l'appel :
//           leur import sous Node prouve aussi qu'aucun module ne lit le DOM au chargement.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANTI_REPETITION_MS, creerGarde, creerGeste } from '../web/src/composants/appui.js';
import { creerBandeauHorsLigne, texteHorsLigne } from '../web/src/composants/bandeau-hors-ligne.js';
import { texteConnexion } from '../web/src/composants/menu.js';
import { ecrire, etiqueter, masquer } from '../web/src/dom.js';
import { creerInactivite } from '../web/src/inactivite.js';
import { creerKiosque } from '../web/src/kiosque.js';
import { echelleScene } from '../web/src/scene.js';
import { creerStockage } from '../web/src/stockage.js';

test('kiosque : repli silencieux sans pont ou sans méthode', () => {
  assert.doesNotThrow(() => creerKiosque(undefined).luminosite(1));
  assert.doesNotThrow(() => creerKiosque({}).luminosite(1));
});

test('kiosque : setBrightness seulement quand le niveau change, nouvel essai après une erreur', () => {
  const appels = [];
  let enPanne = false;
  const kiosque = creerKiosque({
    setBrightness(niveau) {
      if (enPanne) throw new Error('pont indisponible');
      appels.push(niveau);
    },
  });
  kiosque.luminosite(1);
  kiosque.luminosite(1);
  kiosque.luminosite(0.4);
  kiosque.luminosite(0.4);
  assert.deepEqual(appels, [1, 0.4]);
  enPanne = true;
  assert.doesNotThrow(() => kiosque.luminosite(0.05));
  enPanne = false;
  kiosque.luminosite(0.05);
  assert.deepEqual(appels, [1, 0.4, 0.05], 'le niveau raté est retenté');
});

test('kiosque : volume remonté à 80 % s\'il est plus bas, laissé s\'il est plus haut ; volume inconnu : réglé ; repli silencieux', (t) => {
  const volumes = [];
  let actuel = 30;
  const kiosque = creerKiosque({ setVolume: (v) => volumes.push(v), getVolume: () => actuel });
  kiosque.volumeAuMoins(80);
  actuel = 100;
  kiosque.volumeAuMoins(80);
  actuel = 80;
  kiosque.volumeAuMoins(80);
  actuel = 79;
  kiosque.volumeAuMoins(79.6);
  assert.deepEqual(volumes, [80, 80], 'monté à 100 pour couvrir la hotte : pas baissé');
  const sansLecture = [];
  creerKiosque({ setVolume: (v) => sansLecture.push(v) }).volumeAuMoins(80);
  assert.deepEqual(sansLecture, [80], 'vieille APK sans getVolume : réglé à 80');
  assert.doesNotThrow(() => creerKiosque(undefined).volumeAuMoins(80));
  assert.doesNotThrow(() => creerKiosque({ setBrightness() {} }).volumeAuMoins(80), 'vieille APK sans setVolume');
  t.mock.method(console, 'warn', () => {});
  assert.doesNotThrow(() => creerKiosque({ setVolume() { throw new Error('refus'); } }).volumeAuMoins(80));
  assert.doesNotThrow(() => creerKiosque({ setVolume() {}, getVolume() { throw new Error('refus'); } }).volumeAuMoins(80));
});

test('inactivité : un seul signal après 60 s sans toucher, remis à zéro par un toucher', () => {
  let temps = 0;
  const inactivite = creerInactivite({ delaiMs: 60000, monotone: () => temps });
  temps = 59999;
  assert.equal(inactivite.verifier(), false);
  temps = 60000;
  assert.equal(inactivite.verifier(), true);
  temps = 120000;
  assert.equal(inactivite.verifier(), false, 'déjà signalé pour cette période');
  inactivite.toucher();
  temps = 179999;
  assert.equal(inactivite.verifier(), false);
  temps = 180000;
  assert.equal(inactivite.verifier(), true);
  assert.equal(inactivite.inactifMs(), 60000, 'temps écoulé depuis le dernier toucher');
});

test('scène : échelle 1 en 1920x1080, réduite et centrée sinon, sans déformation', () => {
  assert.deepEqual(echelleScene(1920, 1080), { echelle: 1, x: 0, y: 0 });
  assert.deepEqual(echelleScene(960, 540), { echelle: 0.5, x: 0, y: 0 });
  assert.deepEqual(echelleScene(1920, 1200), { echelle: 1, x: 0, y: 60 });
  assert.deepEqual(echelleScene(1000, 540), { echelle: 0.5, x: 20, y: 0 });
});

test('pied du menu : à jour, maison injoignable, connexion en cours, hors ligne depuis N min', () => {
  assert.deepEqual(texteConnexion({ enLigne: true, silenceMs: 3000, ha: 'ok' }), { texte: 'à jour', enLigne: true });
  assert.deepEqual(texteConnexion({ enLigne: true, silenceMs: 3000, ha: 'ko' }), { texte: 'maison injoignable', enLigne: false });
  assert.deepEqual(texteConnexion({ enLigne: true, silenceMs: 0, ha: null }), { texte: 'connexion en cours', enLigne: false });
  assert.deepEqual(texteConnexion({ enLigne: false, silenceMs: 185000, ha: 'ok' }), { texte: 'hors ligne depuis 3 min', enLigne: false });
});

test('bandeau hors ligne : rien en ligne, durée sinon', () => {
  assert.equal(texteHorsLigne({ enLigne: true, silenceMs: 10000 }), null);
  assert.equal(texteHorsLigne({ enLigne: false, silenceMs: 50000 }), 'Hors ligne depuis 1 min : les informations affichées ne sont plus à jour');
});

// Faux nœud : hidden, textContent et aria-label, chaque écriture comptée (comme une mutation du DOM).
function fauxNoeud({ hidden = false, texte = '' } = {}) {
  const valeurs = { hidden, textContent: texte, 'aria-label': null };
  const noeud = { ecritures: 0 };
  for (const nom of ['hidden', 'textContent']) {
    Object.defineProperty(noeud, nom, {
      get: () => valeurs[nom],
      set: (valeur) => { noeud.ecritures += 1; valeurs[nom] = valeur; },
    });
  }
  noeud.getAttribute = (nom) => valeurs[nom];
  noeud.setAttribute = (nom, valeur) => { noeud.ecritures += 1; valeurs[nom] = valeur; };
  return noeud;
}

test('dom : masquer, ecrire et etiqueter n\'écrivent que si la valeur change', () => {
  const noeud = fauxNoeud({ hidden: true, texte: 'a' });
  masquer(noeud, true);
  ecrire(noeud, 'a');
  assert.equal(noeud.ecritures, 0);
  masquer(noeud, false);
  ecrire(noeud, 'b');
  etiqueter(noeud, 'Couvert');
  etiqueter(noeud, 'Couvert');
  assert.equal(noeud.ecritures, 3);
  assert.deepEqual([noeud.hidden, noeud.textContent, noeud.getAttribute('aria-label')], [false, 'b', 'Couvert']);
});

test('bandeau hors ligne : appelé à chaque seconde, il ne touche au DOM qu\'aux changements', () => {
  const conteneur = fauxNoeud({ hidden: true });
  const bandeau = creerBandeauHorsLigne(conteneur);
  for (let s = 0; s < 30; s += 1) bandeau.mettreAJour({ enLigne: true, silenceMs: s * 1000, surAccueil: true });
  assert.equal(conteneur.ecritures, 0, 'en ligne, bandeau déjà masqué : aucune écriture');
  for (let s = 46; s < 80; s += 1) bandeau.mettreAJour({ enLigne: false, silenceMs: s * 1000, surAccueil: true });
  assert.equal(conteneur.hidden, false);
  assert.equal(conteneur.textContent, 'Hors ligne depuis 1 min : les informations affichées ne sont plus à jour');
  assert.equal(conteneur.ecritures, 2, 'une fois hidden, une fois le texte (« 1 min » de 46 à 79 s)');
  bandeau.mettreAJour({ enLigne: true, silenceMs: 0, surAccueil: true });
  assert.equal(conteneur.hidden, true);
});

test('bandeau hors ligne : seulement sur l\'Accueil (sa place est celle des boutons qui passent par le serveur)', () => {
  const conteneur = fauxNoeud({ hidden: true });
  const bandeau = creerBandeauHorsLigne(conteneur);
  bandeau.mettreAJour({ enLigne: false, silenceMs: 60000, surAccueil: false });
  assert.equal(conteneur.hidden, true);
  bandeau.mettreAJour({ enLigne: false, silenceMs: 60000, surAccueil: true });
  assert.equal(conteneur.hidden, false);
  bandeau.mettreAJour({ enLigne: false, silenceMs: 61000, surAccueil: false });
  assert.equal(conteneur.hidden, true, 'masqué en quittant l\'Accueil');
});

test('stockage : JSON préfixé « cadre. », null si absent ou illisible, jamais d\'exception', (t) => {
  const valeurs = new Map();
  const disque = { getItem: (c) => (valeurs.has(c) ? valeurs.get(c) : null), setItem: (c, v) => valeurs.set(c, v), removeItem: (c) => valeurs.delete(c) };
  const stockage = creerStockage(disque);
  stockage.ecrire('drive_pret_le', '2026-10-11T16:00:00.000Z');
  assert.equal(valeurs.get('cadre.drive_pret_le'), '"2026-10-11T16:00:00.000Z"');
  assert.equal(stockage.lire('drive_pret_le'), '2026-10-11T16:00:00.000Z');
  assert.equal(stockage.lire('absent'), null);
  valeurs.set('cadre.abime', '{');
  assert.equal(stockage.lire('abime'), null);
  stockage.retirer('drive_pret_le');
  assert.equal(stockage.lire('drive_pret_le'), null);
  t.mock.method(console, 'warn', () => {});
  const plein = creerStockage({ getItem() { throw new Error('refus'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('refus'); } });
  assert.equal(plein.lire('x'), null);
  assert.doesNotThrow(() => plein.ecrire('x', 1));
  assert.doesNotThrow(() => plein.retirer('x'));
});

test('geste : appui court au lever, dans les 20 px, pas deux fois en 300 ms ; doigt qui glisse ou défilement annulés', () => {
  let temps = 1000;
  const geste = creerGeste({ monotone: () => temps });
  geste.poser(100, 100);
  assert.equal(geste.lever(119, 81), true, '19 px : compte');
  temps += ANTI_REPETITION_MS - 1;
  geste.poser(100, 100);
  assert.equal(geste.lever(100, 100), false, 'touche fantôme 299 ms après');
  temps += 1;
  geste.poser(100, 100);
  assert.equal(geste.lever(100, 100), true, '300 ms après : compte');
  temps += 1000;
  geste.poser(100, 100);
  assert.equal(geste.bouger(105, 110), false);
  assert.equal(geste.bouger(100, 121), true, 'au-delà de 20 px : annulé');
  assert.equal(geste.lever(100, 100), false, 'même revenu au point de départ');
  geste.poser(100, 100);
  assert.equal(geste.lever(130, 100), false, 'levé à 30 px');
  geste.poser(100, 100);
  geste.annuler();
  assert.equal(geste.lever(100, 100), false, 'pointercancel (défilement)');
  assert.equal(geste.lever(100, 100), false, 'lever sans poser');
});

test('geste : une garde partagée par les lignes d\'une liste bloque la touche fantôme sur la ligne voisine', () => {
  let temps = 1000;
  const garde = creerGarde();
  const ligne1 = creerGeste({ monotone: () => temps, garde });
  const ligne2 = creerGeste({ monotone: () => temps, garde });
  const seule = creerGeste({ monotone: () => temps });
  ligne1.poser(10, 10);
  assert.equal(ligne1.lever(10, 10), true);
  temps += 150;
  ligne2.poser(10, 10);
  assert.equal(ligne2.lever(10, 10), false, 'la ligne qui a pris la place, 150 ms après : ignorée');
  seule.poser(10, 10);
  assert.equal(seule.lever(10, 10), true, 'un geste hors de la liste a sa propre anti-répétition');
  temps += ANTI_REPETITION_MS;
  ligne2.poser(10, 10);
  assert.equal(ligne2.lever(10, 10), true);
});

test('geste : appui long une seule fois, puis le lever ne compte pas comme un appui court', () => {
  let temps = 0;
  const geste = creerGeste({ monotone: () => temps });
  geste.poser(50, 50);
  temps = 1000;
  assert.equal(geste.long(), true);
  assert.equal(geste.long(), false, 'une seule fois');
  temps = 1400;
  assert.equal(geste.lever(50, 50), false);
  geste.poser(50, 50);
  geste.bouger(90, 50);
  assert.equal(geste.long(), false, 'doigt parti : pas d\'appui long');
  geste.lever(90, 50);
  assert.equal(geste.long(), false, 'doigt levé avant la seconde : pas d\'appui long');
});

test('geste : tolérance réglable (40 px pour le geste parent, composants/geste-parent.js)', () => {
  const geste = creerGeste({ monotone: () => 0, tolerancePx: 40 });
  geste.poser(100, 100);
  assert.equal(geste.bouger(140, 60), false, '40 px : toléré');
  assert.equal(geste.long(), true);
  geste.poser(100, 100);
  assert.equal(geste.bouger(141, 100), true, 'au-delà de 40 px : annulé');
  assert.equal(geste.long(), false);
});
