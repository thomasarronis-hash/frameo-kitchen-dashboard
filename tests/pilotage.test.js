// tests/pilotage.test.js
//
// Rôle    : prouver les règles de la page sorties de main.js (web/src/pilotage.js) : un minuteur relu après un
//           rechargement ne sonne pas avant le premier heure_serveur, puis sonne à la bonne heure ; sans serveur,
//           il sonne quand même après 10 s ; lancer, +1 min, annuler, rétablir et prolonger en heure CORRIGÉE ; la
//           sonnerie démarre quand un minuteur sonne et s'arrête après ; retour à l'Accueil après 60 s, jamais
//           pendant l'alerte ni avec une recette ouverte, sauf recette oubliée (2 h, aucun minuteur) ; éveil au
//           passage en nuit ; report du rechargement ; la saisie au clavier compte comme une activité ; un toucher qui
//           masque le bandeau sonnette ou fait sortir du mode Photos ne va pas plus loin (rien dessous ne se déclenche).
// Entrées : un faux localStorage, une vraie horloge (heure.js) sur une fausse horloge locale, une fausse horloge
//           monotone, une fausse sonnerie qui note ses appels.
// Sorties : node --test.
// Pièges  : l'horloge locale du « cadre » est fausse d'une heure exprès : tout ce qui passerait par elle (ou par
//           Date.now()) au lieu de l'heure corrigée fait échouer ces tests.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creerHorloge } from '../web/src/heure.js';
import { creerMinuteurs } from '../web/src/minuteurs.js';
import {
  apresInactivite, creerPiloteMinuteurs, DELAI_INACTIVITE_MS, EVENEMENTS_ACTIVITE, eveilPassageNuit, RECETTE_OUBLIEE_MS,
  rechargementBloque, toucherQuiMasque,
} from '../web/src/pilotage.js';
import { creerStockage } from '../web/src/stockage.js';

const MIN = 60000;
const HEURE = 3600000;
const SERVEUR = 1_760_000_000_000;

function fauxStockage() {
  const valeurs = new Map();
  return creerStockage({ getItem: (c) => (valeurs.has(c) ? valeurs.get(c) : null), setItem: (c, v) => valeurs.set(c, String(v)), removeItem: (c) => valeurs.delete(c) });
}

function fausseSonnerie() {
  const appels = [];
  let active = false;
  return {
    appels,
    deverrouiller: () => appels.push('deverrouiller'),
    demarrer: () => { active = true; appels.push('demarrer'); },
    arreter: () => { if (active) appels.push('arreter'); active = false; },
    active: () => active,
  };
}

// Page fraîchement (re)chargée : horloge du cadre en avance d'une heure, pas encore réglée par le serveur.
function page({ stockage = fauxStockage() } = {}) {
  let locale = SERVEUR + HEURE;
  let temps = 0;
  const horloge = creerHorloge(() => locale);
  const sonnerie = fausseSonnerie();
  const minuteurs = creerMinuteurs({ stockage });
  const pilote = creerPiloteMinuteurs({ minuteurs, horloge, sonnerie, monotone: () => temps });
  return {
    pilote, horloge, sonnerie, minuteurs, stockage,
    avancer(ms) { locale += ms; temps += ms; },
    reglerSurServeur() { horloge.regler(SERVEUR + (locale - (SERVEUR + HEURE))); },
  };
}

test('rechargement : un minuteur relu ne sonne pas avant le premier heure_serveur, puis sonne à la bonne heure', () => {
  const stockage = fauxStockage();
  stockage.ecrire('minuteurs', [{ id: 'm1', libelle: 'Pâtes', fin: SERVEUR + 30_000, surplusMs: 0 }]);
  const p = page({ stockage });
  p.avancer(2000);
  assert.equal(p.pilote.evaluer(), null, 'horloge du cadre (1 h d\'avance) pas encore corrigée : rien n\'est évalué');
  assert.deepEqual(p.sonnerie.appels, [], 'aucune sonnerie sur l\'horloge fausse');
  p.reglerSurServeur();
  let evaluation = p.pilote.evaluer();
  assert.equal(evaluation.ms, SERVEUR + 2000, 'l\'instant rendu est l\'heure corrigée');
  assert.deepEqual(evaluation.etat.enCours.map((m) => m.fin - evaluation.ms), [28_000]);
  assert.deepEqual(p.sonnerie.appels, []);
  p.avancer(27_999);
  assert.equal(p.pilote.evaluer().etat.sonnants.length, 0);
  p.avancer(1);
  evaluation = p.pilote.evaluer();
  assert.deepEqual(evaluation.etat.sonnants.map((m) => m.libelle), ['Pâtes']);
  assert.deepEqual(p.sonnerie.appels, ['demarrer'], 'la sonnerie démarre à la fin, en heure corrigée');
  p.pilote.evaluer();
  assert.deepEqual(p.sonnerie.appels, ['demarrer'], 'une seule fois');
  p.pilote.arreterSonnants();
  assert.equal(p.pilote.evaluer().etat.sonnants.length, 0);
  assert.deepEqual(p.sonnerie.appels, ['demarrer', 'arreter']);
});

test('sans serveur : après 10 s, les minuteurs sont évalués sur l\'horloge du cadre (une sonnerie vaut mieux qu\'aucune)', () => {
  const p = page();
  p.avancer(10_000);
  assert.equal(p.pilote.evaluer(), null);
  p.avancer(1);
  assert.notEqual(p.pilote.evaluer(), null);
});

test('lancer, +1 min, prolonger : en heure corrigée ; lancer déverrouille le son', () => {
  const p = page();
  p.reglerSurServeur();
  assert.equal(p.pilote.lancer({ libelle: 'Riz', dureeMs: 11 * MIN, surplusMs: 0 }), true);
  assert.deepEqual(p.sonnerie.appels, ['deverrouiller']);
  const [riz] = p.pilote.evaluer().etat.enCours;
  assert.equal(riz.fin, SERVEUR + 11 * MIN, 'fin = heure du serveur + durée, pas l\'heure du cadre');
  p.pilote.ajouter(riz.id);
  assert.equal(p.pilote.evaluer().etat.enCours[0].fin, SERVEUR + 12 * MIN);
  p.avancer(12 * MIN);
  p.pilote.prolonger(riz.id, 2 * MIN);
  assert.equal(p.pilote.evaluer().etat.enCours[0].fin, SERVEUR + 14 * MIN);
  for (let i = 0; i < 4; i += 1) p.pilote.lancer({ libelle: `M${i}`, dureeMs: MIN, surplusMs: 0 });
  assert.equal(p.pilote.lancer({ libelle: 'de trop', dureeMs: MIN, surplusMs: 0 }), false);
  assert.equal(p.pilote.actifs(), true);
});

test('annuler puis rétablir dans les 5 s (heure corrigée) ; arreterSonnants ne laisse rien à rétablir', () => {
  const p = page();
  p.reglerSurServeur();
  p.pilote.lancer({ libelle: 'Four', dureeMs: 20 * MIN, surplusMs: 0 });
  const [four] = p.pilote.evaluer().etat.enCours;
  p.pilote.annuler(four.id);
  assert.deepEqual(p.pilote.evaluer().etat.annules.map((m) => m.libelle), ['Four']);
  p.avancer(4000);
  assert.equal(p.pilote.retablir(four.id), true);
  assert.equal(p.pilote.evaluer().etat.enCours[0].fin, SERVEUR + 20 * MIN);
  p.avancer(20 * MIN);
  p.pilote.arreterSonnants();
  const apres = p.pilote.evaluer().etat;
  assert.deepEqual([apres.sonnants.length, apres.annules.length, p.pilote.actifs()], [0, 0, false]);
});

test('inactivité : Accueil au signal des 60 s ; jamais pendant l\'alerte ; recette ouverte gardée, sauf oubliée 2 h sans minuteur', () => {
  const base = { signal: true, inactifMs: DELAI_INACTIVITE_MS, recetteOuverte: false, alerteVisible: false, minuteursActifs: false };
  assert.equal(apresInactivite(base), 'accueil');
  assert.equal(apresInactivite({ ...base, signal: false }), 'rien');
  assert.equal(apresInactivite({ ...base, alerteVisible: true }), 'rien');
  assert.equal(apresInactivite({ ...base, recetteOuverte: true }), 'rien', 'on cuisine : la recette reste');
  assert.equal(apresInactivite({ ...base, signal: false, recetteOuverte: true, inactifMs: RECETTE_OUBLIEE_MS - 1 }), 'rien');
  assert.equal(apresInactivite({ ...base, signal: false, recetteOuverte: true, inactifMs: RECETTE_OUBLIEE_MS }), 'fermer-recette');
  assert.equal(apresInactivite({ ...base, signal: false, recetteOuverte: true, inactifMs: 5 * HEURE, minuteursActifs: true }), 'rien', 'un minuteur tourne : la recette reste');
  assert.equal(apresInactivite({ ...base, recetteOuverte: true, inactifMs: 5 * HEURE, alerteVisible: true }), 'rien');
  assert.equal(RECETTE_OUBLIEE_MS, 2 * HEURE);
});

test('inactivité : écran Maison retenu (direct de la sonnette, Wi-Fi affiché), puis retour à la fin si personne n\'a touché', () => {
  const base = { signal: true, inactifMs: DELAI_INACTIVITE_MS, recetteOuverte: false, alerteVisible: false, minuteursActifs: false };
  assert.equal(apresInactivite({ ...base, ecranRetenu: true }), 'rien', 'un invité scanne le QR sans toucher');
  assert.equal(apresInactivite({ ...base, signal: false, inactifMs: 3 * MIN, retenuFini: true }), 'accueil', 'fin du direct, 3 min sans toucher');
  assert.equal(apresInactivite({ ...base, signal: false, inactifMs: 20000, retenuFini: true }), 'rien', 'on vient de toucher « Masquer »');
  assert.equal(apresInactivite({ ...base, signal: false, inactifMs: 3 * MIN, retenuFini: false }), 'rien', 'un seul retour par période');
  assert.equal(apresInactivite({ ...base, ecranRetenu: true, alerteVisible: true }), 'rien');
});

test('passage en nuit : éveillé si on vient de toucher ou si une recette est ouverte, sinon horloge seule', () => {
  assert.equal(eveilPassageNuit({ inactifMs: 8000, recetteOuverte: false }), true, 'toucher à 22:59:52');
  assert.equal(eveilPassageNuit({ inactifMs: 20 * MIN, recetteOuverte: true }), true, 'recette ouverte');
  assert.equal(eveilPassageNuit({ inactifMs: DELAI_INACTIVITE_MS, recetteOuverte: false }), false);
});

test('rechargement de 4h : reporté par une recette ouverte ou un minuteur qui tourne ou sonne', () => {
  const vide = { enCours: [], sonnants: [], annules: [] };
  assert.equal(rechargementBloque({ recetteOuverte: false, etatMinuteurs: vide }), false);
  assert.equal(rechargementBloque({ recetteOuverte: true, etatMinuteurs: vide }), true);
  assert.equal(rechargementBloque({ recetteOuverte: false, etatMinuteurs: { ...vide, enCours: [{}] } }), true);
  assert.equal(rechargementBloque({ recetteOuverte: false, etatMinuteurs: { ...vide, sonnants: [{}] } }), true);
  assert.equal(rechargementBloque({ recetteOuverte: false, etatMinuteurs: { ...vide, annules: [{}] } }), false, 'un annulé ne bloque rien');
});

test('activité : toucher ET taper au clavier (keydown, input) remettent l\'inactivité à zéro', () => {
  assert.deepEqual(EVENEMENTS_ACTIVITE.slice().sort(), ['input', 'keydown', 'pointerdown']);
});

test('toucher qui masque le bandeau sonnette ou fait sortir du mode Photos : consommé (le bouton dessous ne voit rien), sauf « Voir le direct »', () => {
  assert.deepEqual(toucherQuiMasque({ enPhotos: false, bandeauVisible: true, surDirect: false }), { sortirPhotos: false, masquerBandeau: true, consomme: true });
  assert.deepEqual(toucherQuiMasque({ enPhotos: true, bandeauVisible: false, surDirect: false }), { sortirPhotos: true, masquerBandeau: false, consomme: true });
  assert.deepEqual(toucherQuiMasque({ enPhotos: true, bandeauVisible: true, surDirect: true }), { sortirPhotos: false, masquerBandeau: false, consomme: false }, '« Voir le direct » passe');
  assert.deepEqual(toucherQuiMasque({ enPhotos: false, bandeauVisible: false, surDirect: false }).consomme, false, 'toucher ordinaire : il atteint son bouton');
});
