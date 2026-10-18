// tests/minuteurs.test.js
//
// Rôle    : prouver la logique des minuteurs (web/src/minuteurs.js) et de leur sonnerie (web/src/sonnerie.js) :
//           fin en heure corrigée par le serveur, persistance d'un chargement à l'autre (localStorage), le plus
//           proche, sonnerie jusqu'à l'arrêt, temps de plus proposé, limites, textes, annulation rétablissable
//           5 s (la ligne garde sa place dans le tiroir), alerte à 3 lignes au plus ; WAV généré, volume remonté
//           avant de sonner, WebAudio quand son contexte tourne, sinon repli <audio>.
// Entrées : un faux localStorage (Map), une fausse horloge locale décalée de celle du « serveur », un faux
//           AudioContext et un faux pont Kiosk qui notent leurs appels.
// Sorties : node --test.
// Pièges  : la fin d'un minuteur est une heure CORRIGÉE : le test du rechargement change l'horloge locale
//           entre deux chargements sans changer l'heure du serveur, et le temps restant ne doit pas bouger.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creerHorloge } from '../web/src/heure.js';
import {
  ALERTE_LIGNES_MAX, creerMinuteurs, MINUTEURS_MAX, reglerDuree, texteDureeCourte, texteRestant, vueAlerte, vuePastille, vueTiroir,
} from '../web/src/minuteurs.js';
import { creerSonnerie, genererWav, VOLUME_SONNERIE } from '../web/src/sonnerie.js';
import { creerStockage } from '../web/src/stockage.js';

const MIN = 60000;

function fauxLocalStorage() {
  const valeurs = new Map();
  return {
    valeurs,
    getItem: (cle) => (valeurs.has(cle) ? valeurs.get(cle) : null),
    setItem: (cle, valeur) => valeurs.set(cle, String(valeur)),
    removeItem: (cle) => valeurs.delete(cle),
  };
}

test('lancer : fin = heure corrigée + durée ; en cours puis qui sonne une fois la fin atteinte', () => {
  const minuteurs = creerMinuteurs({ stockage: creerStockage(fauxLocalStorage()) });
  const pates = minuteurs.lancer({ libelle: 'Pâtes', dureeMs: 9 * MIN }, 1_000_000);
  assert.equal(pates.fin, 1_000_000 + 9 * MIN);
  assert.deepEqual(minuteurs.etat(1_000_000 + 9 * MIN - 1).enCours.map((m) => m.libelle), ['Pâtes']);
  const fini = minuteurs.etat(1_000_000 + 9 * MIN);
  assert.deepEqual([fini.enCours.length, fini.sonnants.map((m) => m.libelle)], [0, ['Pâtes']]);
  assert.equal(minuteurs.etat(1_000_000 + 30 * MIN).sonnants.length, 1, 'sonne jusqu\'à l\'arrêt');
  minuteurs.arreter(pates.id);
  const arrete = minuteurs.etat(1_000_000 + 30 * MIN);
  assert.deepEqual([arrete.sonnants.length, arrete.annules.length], [0, 0], 'sonnerie arrêtée : sans retour');
});

test('décalage serveur et rechargement : la fin survit, le temps restant ne dépend pas de l\'horloge du cadre', () => {
  const disque = fauxLocalStorage();
  let locale = 5_000;
  const horloge = creerHorloge(() => locale);
  horloge.regler(1_700_000_000_000);
  const avant = creerMinuteurs({ stockage: creerStockage(disque) });
  avant.lancer({ libelle: 'Saucisson', dureeMs: 35 * MIN, surplusMs: 5 * MIN }, horloge.maintenant());
  locale += 10 * MIN;
  const restantAvant = avant.etat(horloge.maintenant()).enCours[0].fin - horloge.maintenant();
  assert.equal(restantAvant, 25 * MIN);

  // Rechargement : nouvelle horloge locale (fausse de 3 jours), même heure serveur au même instant.
  const horlogeApres = creerHorloge(() => 3 * 86_400_000);
  horlogeApres.regler(1_700_000_000_000 + 10 * MIN);
  const apres = creerMinuteurs({ stockage: creerStockage(disque) });
  const relu = apres.etat(horlogeApres.maintenant()).enCours[0];
  assert.equal(relu.fin - horlogeApres.maintenant(), 25 * MIN);
  assert.deepEqual([relu.libelle, relu.surplusMs], ['Saucisson', 5 * MIN]);
});

test('plus proche : la pastille montre d\'abord celui qui sonne, sinon la fin la plus proche, et le nombre des autres', () => {
  const minuteurs = creerMinuteurs({ stockage: creerStockage(fauxLocalStorage()) });
  assert.equal(vuePastille(minuteurs.etat(0), 0), null);
  minuteurs.lancer({ libelle: 'Four', dureeMs: 20 * MIN }, 0);
  minuteurs.lancer({ libelle: 'Œufs', dureeMs: 9 * MIN }, 0);
  minuteurs.lancer({ libelle: 'Riz', dureeMs: 11 * MIN }, 0);
  assert.deepEqual(vuePastille(minuteurs.etat(MIN), MIN), { libelle: 'Œufs', temps: '8:00', sonne: false, autres: '+2' });
  const etat = minuteurs.etat(9 * MIN);
  assert.deepEqual(etat.enCours.map((m) => m.libelle), ['Riz', 'Four']);
  assert.deepEqual(vuePastille(etat, 9 * MIN), { libelle: 'Œufs', temps: 'Terminé', sonne: true, autres: '+2' });
});

test('ajouter 1 min, prolonger un minuteur qui sonne (temps de plus), trouver par nom', () => {
  const minuteurs = creerMinuteurs({ stockage: creerStockage(fauxLocalStorage()) });
  const m = minuteurs.lancer({ libelle: 'Potatoes', dureeMs: 35 * MIN, surplusMs: 5 * MIN }, 0);
  minuteurs.ajouter(m.id, 0);
  assert.equal(minuteurs.etat(0).enCours[0].fin, 36 * MIN);
  assert.equal(minuteurs.trouver('Potatoes').id, m.id);
  assert.equal(minuteurs.trouver('Steaks'), null);
  minuteurs.ajouter(m.id, 40 * MIN);
  assert.equal(minuteurs.etat(40 * MIN).sonnants[0].fin, 36 * MIN, '+1 min n\'agit pas sur un minuteur qui sonne');
  minuteurs.prolonger(m.id, 5 * MIN, 40 * MIN);
  const relance = minuteurs.etat(40 * MIN).enCours[0];
  assert.deepEqual([relance.fin, relance.surplusMs], [45 * MIN, 0], 'relancé, sans nouveau temps de plus');
});

test('au plus 5 minuteurs ; nom libre « Minuteur N » ; réglage borné de 1 min à 6 h', () => {
  const minuteurs = creerMinuteurs({ stockage: creerStockage(fauxLocalStorage()) });
  assert.equal(minuteurs.nomLibre(), 'Minuteur 1');
  const premier = minuteurs.lancer({ libelle: minuteurs.nomLibre(), dureeMs: MIN }, 0);
  minuteurs.lancer({ libelle: minuteurs.nomLibre(), dureeMs: MIN }, 0);
  assert.equal(minuteurs.nomLibre(), 'Minuteur 3');
  minuteurs.annuler(premier.id, 0);
  assert.equal(minuteurs.nomLibre(), 'Minuteur 1', 'le plus petit numéro libre');
  for (let i = 0; i < 10; i += 1) minuteurs.lancer({ libelle: `x${i}`, dureeMs: MIN }, 0);
  assert.equal(minuteurs.etat(0).enCours.length, MINUTEURS_MAX);
  assert.equal(minuteurs.lancer({ libelle: 'de trop', dureeMs: MIN }, 0), null);
  assert.equal(reglerDuree(5 * MIN, MIN), 6 * MIN);
  assert.equal(reglerDuree(MIN, -MIN), MIN, 'jamais sous 1 min');
  assert.equal(reglerDuree(359 * MIN, 5 * MIN), 360 * MIN, 'jamais au-delà de 6 h');
});

test('un minuteur fini depuis plus d\'une heure est oublié ; une entrée abîmée du stockage est ignorée', () => {
  const disque = fauxLocalStorage();
  const stockage = creerStockage(disque);
  stockage.ecrire('minuteurs', [
    { id: 'a', libelle: 'Rôti', fin: 1000 * MIN, surplusMs: 0 },
    { id: 'b', libelle: '', fin: 1000 * MIN, surplusMs: 0 },
    { id: 'c', libelle: 'Sans fin', fin: 'demain', surplusMs: 0 },
    { id: 'd', libelle: 'x'.repeat(31), fin: 1000 * MIN, surplusMs: 0 },
    null,
  ]);
  const minuteurs = creerMinuteurs({ stockage });
  assert.deepEqual(minuteurs.etat(1059 * MIN).sonnants.map((m) => m.id), ['a']);
  assert.deepEqual(minuteurs.etat(1061 * MIN).sonnants, []);
  assert.deepEqual(JSON.parse(disque.getItem('cadre.minuteurs')), [], 'oubli enregistré');
  disque.setItem('cadre.minuteurs', '{pas du json');
  assert.deepEqual(creerMinuteurs({ stockage }).etat(0), { enCours: [], sonnants: [], annules: [] });
});

test('Annuler (tiroir) : la ligne reste à sa place 5 s, « Annulé », rétablissable ; un second toucher ne touche pas au suivant', () => {
  const disque = fauxLocalStorage();
  const minuteurs = creerMinuteurs({ stockage: creerStockage(disque) });
  const court = minuteurs.lancer({ libelle: 'Minuteur 1', dureeMs: 5 * MIN }, 0);
  minuteurs.lancer({ libelle: 'Rôti au four', dureeMs: 55 * MIN }, 0);
  const lignes = (ms) => vueTiroir(minuteurs.etat(ms), ms).map((l) => `${l.libelle} ${l.temps}${l.annule ? ' (annulé)' : ''}`);
  assert.deepEqual(lignes(MIN), ['Minuteur 1 4:00', 'Rôti au four 54:00']);
  minuteurs.annuler(court.id, MIN);
  assert.deepEqual(lignes(MIN + 500), ['Minuteur 1 Annulé (annulé)', 'Rôti au four 54:00'], 'le rôti ne remonte pas sous le doigt');
  assert.deepEqual(JSON.parse(disque.getItem('cadre.minuteurs')).map((m) => m.libelle), ['Rôti au four'], 'retiré du stockage');
  assert.equal(minuteurs.retablir(court.id, MIN + 4999), true);
  assert.deepEqual(lignes(MIN + 5000), ['Minuteur 1 3:55', 'Rôti au four 53:55'], 'rétabli avec sa fin d\'origine');
  minuteurs.annuler(court.id, 2 * MIN);
  assert.equal(minuteurs.retablir(court.id, 2 * MIN + 5000), false, 'au-delà de 5 s : plus de retour');
  assert.deepEqual(lignes(2 * MIN + 5000), ['Rôti au four 52:55']);
});

test('tiroir : 5 lignes au plus ; un minuteur lancé juste après une annulation fait partir la ligne annulée', () => {
  const minuteurs = creerMinuteurs({ stockage: creerStockage(fauxLocalStorage()) });
  const ids = [1, 2, 3, 4, 5].map((n) => minuteurs.lancer({ libelle: `M${n}`, dureeMs: n * MIN }, 0).id);
  minuteurs.annuler(ids[2], 0);
  assert.equal(vueTiroir(minuteurs.etat(0), 0).length, 5);
  minuteurs.lancer({ libelle: 'M6', dureeMs: 6 * MIN }, 0);
  assert.deepEqual(vueTiroir(minuteurs.etat(0), 0).map((l) => l.libelle), ['M1', 'M2', 'M4', 'M5', 'M6']);
  assert.equal(minuteurs.retablir(ids[2], 0), false, 'déjà 5 minuteurs : pas de rétablissement');
});

test('alerte : jusqu\'à 3 minuteurs une ligne chacun ; au-delà, 2 lignes et les autres nommés ensemble', () => {
  const m = (libelle) => ({ id: libelle, libelle, fin: 0, surplusMs: 0 });
  assert.equal(ALERTE_LIGNES_MAX, 3);
  assert.deepEqual(vueAlerte([m('Pâtes'), m('Riz'), m('Four')]), { lignes: [m('Pâtes'), m('Riz'), m('Four')], autres: null });
  assert.deepEqual(vueAlerte([m('Pâtes'), m('Riz'), m('Four'), m('Œufs')]), { lignes: [m('Pâtes'), m('Riz')], autres: 'et 2 autres : Four, Œufs' });
  assert.deepEqual(vueAlerte([]), { lignes: [], autres: null });
});

test('sans localStorage (absent ou qui lève) : les minuteurs marchent en mémoire', (t) => {
  t.mock.method(console, 'warn', () => {});
  const stockage = creerStockage(() => { throw new Error('SecurityError'); });
  const minuteurs = creerMinuteurs({ stockage });
  minuteurs.lancer({ libelle: 'Thé', dureeMs: 4 * MIN }, 0);
  assert.equal(minuteurs.etat(0).enCours.length, 1);
});

test('textes : temps restant arrondi à la seconde supérieure, heures, durées courtes', () => {
  assert.equal(texteRestant(4 * MIN + 5000), '4:05');
  assert.equal(texteRestant(4 * MIN + 4001), '4:05');
  assert.equal(texteRestant(1), '0:01', 'jamais 0:00 avant la fin');
  assert.equal(texteRestant(0), '0:00');
  assert.equal(texteRestant(62 * MIN + 3000), '1:02:03');
  assert.equal(texteDureeCourte(35 * MIN), '35 min');
  assert.equal(texteDureeCourte(90_000), '1 min 30');
  assert.equal(texteDureeCourte(45_000), '45 s');
  assert.equal(texteDureeCourte(65 * MIN), '1 h 05');
  assert.equal(texteDureeCourte(120 * MIN), '2 h');
});

test('WAV généré : en-tête RIFF PCM 16 bits mono à 8 kHz, taille cohérente, des échantillons non nuls', () => {
  const wav = genererWav();
  const vue = new DataView(wav.buffer);
  const texte = (debut, fin) => String.fromCharCode(...wav.slice(debut, fin));
  assert.equal(texte(0, 4), 'RIFF');
  assert.equal(texte(8, 16), 'WAVEfmt ');
  assert.equal(texte(36, 40), 'data');
  assert.equal(vue.getUint32(4, true), wav.length - 8);
  assert.equal(vue.getUint32(40, true), wav.length - 44);
  assert.deepEqual([vue.getUint16(20, true), vue.getUint16(22, true), vue.getUint32(24, true), vue.getUint16(34, true)], [1, 1, 8000, 16]);
  let nonNuls = 0;
  for (let i = 44; i < wav.length; i += 2) if (vue.getInt16(i, true) !== 0) nonNuls += 1;
  assert.ok(nonNuls > 1000 && nonNuls < (wav.length - 44) / 2, 'des bips et des silences');
});

// Faux AudioContext : note chaque oscillateur (départ, arrêt) ; état suspended jusqu'à resume().
function fauxContexte() {
  const contexte = {
    state: 'suspended', currentTime: 10, destination: {}, oscillateurs: [], reprises: 0,
    resume() { contexte.reprises += 1; contexte.state = 'running'; return Promise.resolve(); },
    createGain: () => ({ gain: { value: 0 }, connect() {} }),
    createOscillator() {
      const osc = { frequency: { value: 0 }, connect() {}, start(t) { osc.debut = t; }, stop(t) { osc.arrets.push(t); }, arrets: [] };
      contexte.oscillateurs.push(osc);
      return osc;
    },
  };
  return contexte;
}

test('sonnerie WebAudio : volume à 80 % par le pont AVANT les bips, trois bips à chaque seconde, arrêt net', () => {
  const ordre = [];
  const contexte = fauxContexte();
  const origine = contexte.createOscillator;
  contexte.createOscillator = () => { ordre.push('bip'); return origine(); };
  const sonnerie = creerSonnerie({
    creerContexte: () => contexte,
    creerAudio: () => assert.fail('pas de repli quand WebAudio existe'),
    kiosque: { volumeAuMoins: (v) => ordre.push(`volume ${v}`) },
  });
  sonnerie.entretenir();
  assert.equal(contexte.oscillateurs.length, 0, 'rien tant que la sonnerie n\'est pas lancée');
  sonnerie.demarrer();
  assert.deepEqual(ordre, [`volume ${VOLUME_SONNERIE}`, 'bip', 'bip', 'bip']);
  assert.equal(contexte.reprises, 1, 'contexte suspendu repris');
  assert.deepEqual(contexte.oscillateurs.map((o) => Math.round((o.debut - 10) * 100)), [2, 27, 52]);
  sonnerie.demarrer();
  assert.equal(contexte.oscillateurs.length, 3, 'demarrer deux fois ne double pas');
  contexte.currentTime = 11;
  sonnerie.entretenir();
  assert.equal(contexte.oscillateurs.length, 6);
  sonnerie.arreter();
  assert.ok(contexte.oscillateurs.slice(3).every((o) => o.arrets.length === 2), 'bips planifiés coupés');
  sonnerie.entretenir();
  assert.equal(contexte.oscillateurs.length, 6);
  assert.equal(sonnerie.active(), false);
});

test('sonnerie sans WebAudio : repli <audio> sur le WAV généré ; pont absent ou qui lève sans effet', () => {
  const lectures = [];
  const audio = { currentTime: 3, play() { lectures.push(audio.currentTime); return Promise.resolve(); }, pause() { lectures.push('pause'); } };
  let octetsRecus = null;
  const sonnerie = creerSonnerie({
    creerContexte: () => null,
    creerAudio: (octets) => { octetsRecus = octets; return audio; },
    kiosque: { volumeAuMoins() {} },
  });
  sonnerie.demarrer();
  sonnerie.entretenir();
  sonnerie.arreter();
  assert.deepEqual(lectures, [0, 0, 'pause']);
  assert.equal(String.fromCharCode(...octetsRecus.slice(0, 4)), 'RIFF');

  const sansContexte = creerSonnerie({ creerContexte: () => { throw new Error('interdit'); }, creerAudio: () => audio, kiosque: { volumeAuMoins() {} } });
  assert.doesNotThrow(() => sansContexte.demarrer());
});

test('sonnerie : contexte WebAudio resté suspendu (rechargement, aucun toucher) : <audio> sonne, WebAudio reprend une fois déverrouillé', () => {
  const contexte = fauxContexte();
  contexte.resume = () => Promise.resolve();
  const lectures = [];
  const audio = { currentTime: 0, play() { lectures.push('wav'); return Promise.resolve(); }, pause() {} };
  const sonnerie = creerSonnerie({ creerContexte: () => contexte, creerAudio: () => audio, kiosque: { volumeAuMoins() {} } });
  sonnerie.demarrer();
  sonnerie.entretenir();
  assert.deepEqual(lectures, ['wav', 'wav']);
  assert.equal(contexte.oscillateurs.length, 0, 'rien planifié sur un contexte suspendu (muet)');
  contexte.state = 'running';
  sonnerie.entretenir();
  assert.equal(contexte.oscillateurs.length, 3);
  assert.deepEqual(lectures, ['wav', 'wav']);
});
