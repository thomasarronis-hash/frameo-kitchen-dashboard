// tests/enfants-registre.test.js
//
// Rôle    : prouver les règles des points et de la boutique (serveur/enfants/registre.js), sans fichier : +1 point par
//           action (motif de la liste ou vide), point libre plafonné par journée (barème) et annulation bornée (dernier
//           point libre, 10 s, jamais deux fois), −1 d'un parent (dernier gain, solde jamais sous zéro, échanges intacts),
//           plafond de gains par journée, aucun autre retrait de points, échange refusé sans assez de points (à la demande et
//           à la validation), une demande en attente par enfant, purge douce sans changer aucun solde.
// Entrées : le vrai barème (config/enfants.json) ; des instants fixes.
// Sorties : node --test.
// Pièges  : chaque opération renvoie une COPIE du registre : les tests enchaînent les registres renvoyés (ok()).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chargerBareme } from '../serveur/enfants/bareme.js';
import * as registreModule from '../serveur/enfants/registre.js';

const {
  annulerPointLibre, deciderEchange, demandeDe, demanderEchange, donnerPoint, donnerPointLibre, FENETRE_ANNULATION_LIBRE_MS, gainsRecents,
  libresRestants, PLAFOND_POINTS_JOUR, pointsDuJour, purgerRegistre, registreVide, retirerPoint, solde,
} = registreModule;
const B = chargerBareme();
const MAINTENANT = Date.parse('2026-10-14T17:00:00+02:00');
const JOURNEE = '2026-10-14';
const refus = (code, statut) => (err) => err.code === code && (statut === undefined || err.statut === statut);

let dernier;
function ok(operation, registre, params) {
  const { registre: suivant, resultat } = operation(registre, B, { maintenant: MAINTENANT, journee: JOURNEE, ...params });
  dernier = resultat;
  return suivant;
}
function avecPoints(n, journee = JOURNEE) {
  let registre = registreVide(B);
  for (let i = 0; i < n; i += 1) registre = ok(donnerPoint, registre, { enfant: 'timo', journee: `${journee.slice(0, 8)}${String(1 + (i % 28)).padStart(2, '0')}` });
  return registre;
}

test('+1 point par action, donné avec un motif de la liste ou sans motif ; motif inconnu 400 ; Pablo n\'a pas de points', () => {
  let registre = ok(donnerPoint, registreVide(B), { enfant: 'timo', motif: 'table' });
  assert.deepEqual(dernier, { enfant: 'timo', solde: 1, aujourdhui: 1 });
  registre = ok(donnerPoint, registre, { enfant: 'timo' });
  assert.deepEqual(registre.mouvements.map(({ motif, points }) => [motif, points]), [['table', 1], [null, 1]]);
  assert.equal(registre.mouvements[0].le, '2026-10-14T15:00:00.000Z');
  assert.throws(() => ok(donnerPoint, registre, { enfant: 'timo', motif: 'a-ete-sage' }), refus('motif_inconnu', 400));
  assert.throws(() => ok(donnerPoint, registre, { enfant: 'pablo' }), refus('sans_points', 404));
  assert.throws(() => ok(donnerPoint, registre, { enfant: 'lea' }), refus('enfant_inconnu', 404));
  assert.deepEqual([solde(registre, 'timo'), pointsDuJour(registre, 'timo', JOURNEE), pointsDuJour(registre, 'timo', '2026-10-13')], [2, 2, 0]);
});

test('gains récents : les derniers d\'abord, au nombre demandé, motif ou null, sans les échanges ni l\'autre enfant', () => {
  let registre = registreVide(B);
  for (const motif of ['range', null, 'table', 'aide']) registre = ok(donnerPoint, registre, { enfant: 'timo', motif });
  registre = { ...registre, mouvements: [...registre.mouvements, { enfant: 'timo', type: 'echange', points: 1, cadeau: 'petit', le: '2026-10-14T16:00:00.000Z', journee: JOURNEE }] };
  assert.deepEqual(gainsRecents(registre, 'timo', 3).map(({ motif }) => motif), ['aide', 'table', null]);
  assert.deepEqual(gainsRecents(registre, 'timo', 3)[0], { motif: 'aide', le: '2026-10-14T15:00:00.000Z' });
  assert.deepEqual(gainsRecents(registreVide(B), 'timo', 5), []);
});

test('plafond de 20 gains par enfant et par journée (taille du fichier, écrit en dur), le lendemain repart', () => {
  assert.equal(PLAFOND_POINTS_JOUR, 20);
  let registre = registreVide(B);
  for (let i = 0; i < 20; i += 1) registre = ok(donnerPoint, registre, { enfant: 'timo' });
  assert.throws(() => ok(donnerPoint, registre, { enfant: 'timo' }), refus('plafond_jour', 409));
  registre = ok(donnerPoint, registre, { enfant: 'timo', journee: '2026-10-15' });
  assert.equal(solde(registre, 'timo'), 21);
});

test('échange refusé si les points manquent ; sinon demande en attente, sans rien dépenser avant la validation d\'un parent', () => {
  let registre = avecPoints(29);
  assert.throws(() => ok(demanderEchange, registre, { enfant: 'timo', cadeau: 'petit', id: 'aaaa0001' }), refus('points_insuffisants', 409));
  registre = ok(donnerPoint, registre, { enfant: 'timo' });
  registre = ok(demanderEchange, registre, { enfant: 'timo', cadeau: 'petit', id: 'aaaa0002' });
  assert.deepEqual(dernier, {
    enfant: 'timo', demande: {
      id: 'aaaa0002', enfant: 'timo', cadeau: 'petit', prix: 30, le: '2026-10-14T15:00:00.000Z',
    }, remplace: false,
  });
  assert.equal(solde(registre, 'timo'), 30, 'rien de dépensé tant qu\'un parent n\'a pas validé');
  assert.throws(() => ok(demanderEchange, registre, { enfant: 'timo', cadeau: 'licorne', id: 'aaaa0003' }), refus('cadeau_inconnu', 400));
  assert.throws(() => ok(demanderEchange, registre, { enfant: 'pablo', cadeau: 'petit', id: 'aaaa0004' }), refus('sans_points', 404));
});

test('une demande en attente par enfant : la nouvelle remplace l\'ancienne ; la décision vise l\'identifiant vu par le parent', () => {
  let registre = avecPoints(70);
  registre = ok(demanderEchange, registre, { enfant: 'timo', cadeau: 'petit', id: 'bbbb0001' });
  registre = ok(demanderEchange, registre, { enfant: 'timo', cadeau: 'moyen', id: 'bbbb0002' });
  assert.equal(dernier.remplace, true);
  assert.deepEqual(registre.demandes.map((demande) => demande.id), ['bbbb0002']);
  assert.throws(() => ok(deciderEchange, registre, { enfant: 'timo', demande: 'bbbb0001', decision: 'valider' }), refus('demande_inconnue', 404));
  assert.throws(() => ok(deciderEchange, registre, { enfant: 'pablo', demande: 'bbbb0002', decision: 'valider' }), refus('sans_points', 404));
  registre = ok(deciderEchange, registre, { enfant: 'timo', demande: 'bbbb0002', decision: 'valider' });
  assert.deepEqual(dernier, {
    enfant: 'timo', demande: 'bbbb0002', decision: 'valider', solde: 10,
  });
  assert.equal(demandeDe(registre, 'timo'), null);
  assert.deepEqual(registre.mouvements.at(-1), {
    enfant: 'timo', type: 'echange', points: 60, cadeau: 'moyen', le: '2026-10-14T15:00:00.000Z', journee: JOURNEE,
  });
});

test('demande refusée par un parent : retirée, solde intact ; validation refusée si le solde ne suffit plus (la demande reste)', () => {
  let registre = avecPoints(40);
  registre = ok(demanderEchange, registre, { enfant: 'timo', cadeau: 'petit', id: 'cccc0001' });
  registre = ok(deciderEchange, registre, { enfant: 'timo', demande: 'cccc0001', decision: 'refuser' });
  assert.deepEqual([dernier.solde, registre.demandes.length], [40, 0]);
  const force = { ...registre, demandes: [{ id: 'cccc0002', enfant: 'timo', cadeau: 'gros', prix: 90, le: '2026-10-14T15:00:00.000Z' }] };
  assert.throws(() => ok(deciderEchange, force, { enfant: 'timo', demande: 'cccc0002', decision: 'valider' }), refus('points_insuffisants', 409));
  assert.equal(force.demandes.length, 1, 'le registre d\'origine n\'est jamais modifié');
});

test('point libre : sans motif, marqué « libre », plafonné à 10 par journée (barème), le lendemain repart ; Pablo n\'en a pas', () => {
  let registre = registreVide(B);
  registre = ok(donnerPointLibre, registre, { enfant: 'timo' });
  assert.deepEqual(dernier, {
    enfant: 'timo', solde: 1, aujourdhui: 1, libres_restants: 9, annulable_jusqu_a: '2026-10-14T15:00:05.000Z',
  });
  assert.deepEqual(registre.mouvements[0], {
    enfant: 'timo', type: 'gain', points: 1, motif: null, libre: true, le: '2026-10-14T15:00:00.000Z', journee: JOURNEE,
  });
  for (let i = 0; i < 9; i += 1) registre = ok(donnerPointLibre, registre, { enfant: 'timo' });
  assert.equal(dernier.libres_restants, 0);
  assert.throws(() => ok(donnerPointLibre, registre, { enfant: 'timo' }), refus('plafond_libre', 409));
  registre = ok(donnerPoint, registre, { enfant: 'timo', motif: 'aide' });
  assert.equal(dernier.solde, 11, 'un parent peut encore donner des points (avec ou sans motif)');
  registre = ok(donnerPointLibre, registre, { enfant: 'timo', journee: '2026-10-15' });
  assert.equal(dernier.libres_restants, 9, 'nouvelle journée (4 h à 4 h) : le compteur repart');
  assert.equal(libresRestants(registre, B, 'timo', JOURNEE), 0);
  assert.throws(() => ok(donnerPointLibre, registre, { enfant: 'pablo' }), refus('sans_points', 404));
  assert.throws(() => ok(donnerPointLibre, registre, { enfant: 'lea' }), refus('enfant_inconnu', 404));
});

test('points libres et points d\'un parent partagent le plafond de 20 gains par journée : libres_restants le suit (0 grise le « +1 »)', () => {
  let registre = registreVide(B);
  for (let i = 0; i < 12; i += 1) registre = ok(donnerPoint, registre, { enfant: 'timo', motif: 'aide' });
  assert.equal(libresRestants(registre, B, 'timo', JOURNEE), 8, '20 gains au plus : 8 places, sous les 10 du barème');
  for (let i = 0; i < 8; i += 1) registre = ok(donnerPointLibre, registre, { enfant: 'timo' });
  assert.deepEqual([dernier.libres_restants, PLAFOND_POINTS_JOUR], [0, 20], 'jamais un « +1 » annoncé que le serveur refuserait');
  assert.throws(() => ok(donnerPointLibre, registre, { enfant: 'timo' }), refus('plafond_jour', 409));
  const annule = ok(annulerPointLibre, registre, { enfant: 'timo' });
  assert.equal(dernier.libres_restants, 1, 'une place rendue par l\'annulation');
  ok(retirerPoint, annule, { enfant: 'timo' });
  assert.equal(dernier.libres_restants, 2);
});

test('annuler un point libre : le dernier de cet enfant, dans les 10 s, jamais deux fois ; un nouveau point se réannule', () => {
  const a = MAINTENANT;
  let registre = ok(donnerPointLibre, registreVide(B), { enfant: 'timo', maintenant: a });
  registre = ok(donnerPointLibre, registre, { enfant: 'timo', maintenant: a + 1_000 });
  const annule = ok(annulerPointLibre, registre, { enfant: 'timo', maintenant: a + 1_000 + FENETRE_ANNULATION_LIBRE_MS });
  assert.equal(FENETRE_ANNULATION_LIBRE_MS, 10_000, 'écrit en dur : la page montre « Annuler » 5 s, le serveur accepte 10 s');
  assert.deepEqual(dernier, {
    enfant: 'timo', solde: 1, aujourdhui: 1, libres_restants: 9,
  });
  assert.deepEqual(annule.mouvements.map((mouvement) => mouvement.le), ['2026-10-14T15:00:00.000Z'], 'seulement le dernier');
  assert.deepEqual(annule.annulations, { timo: '2026-10-14T15:00:01.000Z' }, 'le « le » du point annulé');
  assert.throws(() => ok(annulerPointLibre, annule, { enfant: 'timo', maintenant: a + 1_000 + FENETRE_ANNULATION_LIBRE_MS }), refus('rien_a_annuler', 409),
    'jamais deux fois : le point plus ancien reste');
  assert.throws(() => ok(annulerPointLibre, registre, { enfant: 'timo', maintenant: a + 1_001 + FENETRE_ANNULATION_LIBRE_MS }), refus('trop_tard', 409));
  const nouveau = ok(donnerPointLibre, annule, { enfant: 'timo', maintenant: a + 20_000 });
  ok(annulerPointLibre, nouveau, { enfant: 'timo', maintenant: a + 25_000 });
  assert.equal(dernier.solde, 1, 'un nouveau point libre s\'annule à son tour');
  assert.throws(() => ok(annulerPointLibre, ok(donnerPoint, registreVide(B), { enfant: 'timo' }), { enfant: 'timo' }), refus('rien_a_annuler', 409),
    'un point d\'un parent ne s\'annule pas sans mode parent');
  assert.throws(() => ok(annulerPointLibre, registreVide(B), { enfant: 'pablo' }), refus('sans_points', 404));
});

test('annuler un point libre déjà échangé : refusé, le solde ne descend jamais sous zéro et l\'échange reste', () => {
  let registre = ok(donnerPointLibre, avecPoints(29), { enfant: 'timo' });
  registre = ok(demanderEchange, registre, { enfant: 'timo', cadeau: 'petit', id: 'ffff0001' });
  registre = ok(deciderEchange, registre, { enfant: 'timo', demande: 'ffff0001', decision: 'valider' });
  assert.throws(() => ok(annulerPointLibre, registre, { enfant: 'timo', maintenant: MAINTENANT + 5_000 }), refus('points_depenses', 409));
  assert.deepEqual([solde(registre, 'timo'), registre.mouvements.at(-1).type], [0, 'echange']);
});

test('−1 d\'un parent : retire le dernier gain (libre ou non), jamais sous zéro, jamais un échange ; rien à retirer : aucun_point', () => {
  let registre = ok(donnerPoint, registreVide(B), { enfant: 'timo', motif: 'table' });
  registre = ok(donnerPointLibre, registre, { enfant: 'timo' });
  registre = ok(retirerPoint, registre, { enfant: 'timo' });
  assert.deepEqual(dernier, {
    enfant: 'timo', solde: 1, aujourdhui: 1, libres_restants: 10,
  });
  assert.deepEqual(registre.mouvements.map(({ motif }) => motif), ['table'], 'le point libre, le plus récent, est parti');
  registre = ok(retirerPoint, registre, { enfant: 'timo' });
  assert.deepEqual([dernier.solde, registre.mouvements.length], [0, 0]);
  assert.throws(() => ok(retirerPoint, registre, { enfant: 'timo' }), refus('aucun_point', 409));
  let echange = ok(demanderEchange, avecPoints(30), { enfant: 'timo', cadeau: 'petit', id: 'ffff0002' });
  echange = ok(deciderEchange, echange, { enfant: 'timo', demande: 'ffff0002', decision: 'valider' });
  assert.throws(() => ok(retirerPoint, echange, { enfant: 'timo' }), refus('points_depenses', 409), 'les 30 points ont servi au petit cadeau');
  assert.equal(echange.mouvements.filter((mouvement) => mouvement.type === 'echange').length, 1);
  assert.throws(() => ok(retirerPoint, registre, { enfant: 'pablo' }), refus('sans_points', 404));
});

test('Timo ne perd jamais de points par punition : seuls un échange validé, l\'annulation d\'un point libre et le −1 d\'un parent en retirent', () => {
  let registre = avecPoints(35);
  const soldes = [solde(registre, 'timo')];
  const etapes = [
    [donnerPoint, { enfant: 'timo', motif: 'aide' }],
    [demanderEchange, { enfant: 'timo', cadeau: 'petit', id: 'dddd0001' }],
    [deciderEchange, { enfant: 'timo', demande: 'dddd0001', decision: 'refuser' }],
    [demanderEchange, { enfant: 'timo', cadeau: 'petit', id: 'dddd0002' }],
    [deciderEchange, { enfant: 'timo', demande: 'dddd0002', decision: 'valider' }],
    [donnerPoint, { enfant: 'timo' }],
  ];
  for (const [operation, params] of etapes) {
    registre = ok(operation, registre, params);
    soldes.push(solde(registre, 'timo'));
  }
  assert.deepEqual(soldes, [35, 36, 36, 36, 36, 6, 7]);
  assert.deepEqual(Object.keys(registreModule).sort(), [
    'FENETRE_ANNULATION_LIBRE_MS', 'PLAFOND_POINTS_JOUR', 'annulerPointLibre', 'completerRegistre', 'deciderEchange', 'demandeDe', 'demanderEchange',
    'donnerPoint', 'donnerPointLibre', 'gainsRecents', 'libresRestants', 'pointsDuJour', 'purgerRegistre', 'registreVide', 'retirerPoint', 'solde',
  ], 'aucune autre opération sur les points (ni retrait automatique, ni punition)');
});

test('purge douce après 90 jours : vieux mouvements repliés dans reports sans changer le solde, vieilles demandes retirées', () => {
  let registre = registreVide(B);
  registre = ok(donnerPoint, registre, { enfant: 'timo', journee: '2026-07-01' });
  registre = ok(donnerPoint, registre, { enfant: 'timo', journee: '2026-07-02' });
  registre = ok(donnerPoint, registre, { enfant: 'timo', journee: '2026-10-14' });
  registre = { ...registre, demandes: [{ id: 'eeee0001', enfant: 'timo', cadeau: 'petit', prix: 30, le: '2026-07-01T10:00:00.000Z' }] };
  const purge = purgerRegistre(registre, '2026-07-17');
  assert.deepEqual(purge.reports, { timo: 2 });
  assert.deepEqual(purge.mouvements.map((mouvement) => mouvement.journee), ['2026-10-14']);
  assert.deepEqual(purge.demandes, []);
  assert.equal(solde(purge, 'timo'), solde(registre, 'timo'));
  assert.equal(purgerRegistre(purge, '2026-07-17'), purge, 'rien à purger : même objet, aucune écriture');
  const borne = purgerRegistre(ok(donnerPoint, registreVide(B), { enfant: 'timo', journee: '2026-07-17' }), '2026-07-17');
  assert.deepEqual([borne.mouvements.length, borne.reports.timo], [1, 0], 'la journée de la limite exacte est gardée');
});
