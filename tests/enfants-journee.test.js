// tests/enfants-journee.test.js
//
// Rôle    : prouver les règles d'une journée du tableau des enfants (serveur/enfants/journee.js et la valeur du flux,
//           serveur/enfants/projection.js), sans fichier : journée de 4 h à 4 h aux changements d'heure, maximum de 32 min,
//           tout le matin de Timo en confiance (barème de Thomas depuis le 14/10 en fin d'après-midi), étape « parent » en
//           attente puis validée ou refusée (variante du barème, toujours permise), « Levé » jamais avant 6 h 30, annulation
//           dans les 5 s, minuteur borné aux minutes gagnées et à 20 h, minutes perdues le soir, étoiles et « Ensuite » de
//           Pablo, prochain changement sans action.
// Entrées : le vrai barème (config/enfants.json) et sa variante BP où « Levé » et « N'excite pas Pablo » attendent un
//           parent ; des instants écrits à l'heure de Paris.
// Sorties : node --test.
// Pièges  : chaque opération renvoie une COPIE : les tests enchaînent donc les journées renvoyées (ok()).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CHEMIN_BAREME, chargerBareme, validerBareme } from '../serveur/enfants/bareme.js';
import {
  annuler, cocher, completerJournee, debutJournee, decider, disponiblesS, finaliserMinuteurs, instantDansJournee,
  journeeDe, journeeVide, piloterMinuteur, prochainEvenement,
} from '../serveur/enfants/journee.js';
import { projeter } from '../serveur/enfants/projection.js';
import { registreVide } from '../serveur/enfants/registre.js';

const B = chargerBareme();
const brut = () => JSON.parse(readFileSync(CHEMIN_BAREME, 'utf8'));
// La validation « parent » reste une possibilité du barème : BP la remet sur Levé et « N'excite pas Pablo ».
const BP = (() => {
  const variante = brut();
  variante.enfants[0].etapes.filter((etape) => ['leve', 'calme'].includes(etape.id)).forEach((etape) => { etape.validation = 'parent'; });
  return validerBareme(variante);
})();
const t = (texte) => Date.parse(texte);
const H = 3_600_000;
const timo = B.enfants[0];

// Applique une opération et renvoie la nouvelle journée (le résultat est rangé dans dernier).
let dernier;
function ok(operation, jour, params, bareme = B) {
  const { jour: suivant, resultat } = operation(jour, bareme, params);
  dernier = resultat;
  return suivant;
}
const refus = (code) => (err) => err.code === code;

test('journée de 4 h à 4 h, heure de Paris, y compris aux changements d\'heure (25 h fin octobre, 23 h fin mars)', () => {
  assert.equal(journeeDe(t('2026-10-14T03:59:59+02:00')), '2026-10-13');
  assert.equal(journeeDe(t('2026-10-14T04:00:00+02:00')), '2026-10-14');
  assert.equal(journeeDe(t('2026-10-14T23:59:00+02:00')), '2026-10-14');
  assert.equal(journeeDe(t('2026-10-25T02:30:00+02:00')), '2026-10-24', 'première 2 h 30 de la nuit du 25/10');
  assert.equal(journeeDe(t('2026-10-25T02:30:00+01:00')), '2026-10-24', 'seconde 2 h 30');
  assert.equal(journeeDe(t('2026-10-25T03:59:00+01:00')), '2026-10-24');
  assert.equal(journeeDe(t('2026-10-25T04:00:00+01:00')), '2026-10-25');
  assert.equal(debutJournee('2026-10-25') - debutJournee('2026-10-24'), 25 * H);
  assert.equal(journeeDe(t('2027-03-28T03:59:00+02:00')), '2027-03-27');
  assert.equal(journeeDe(t('2027-03-28T04:00:00+02:00')), '2027-03-28');
  assert.equal(debutJournee('2027-03-28') - debutJournee('2027-03-27'), 23 * H);
  assert.equal(instantDansJournee('2026-10-25', '06:30'), t('2026-10-25T06:30:00+01:00'));
  assert.equal(instantDansJournee('2027-03-28', '20:00'), t('2027-03-28T20:00:00+02:00'));
});

test('maximum de 32 min : tout fait = 32, une étape ne compte qu\'une fois ; un plafond plus bas borne la somme', () => {
  const maintenant = t('2026-10-14T07:00:00+02:00');
  let jour = journeeVide('2026-10-14', B);
  for (const etape of timo.etapes) jour = ok(cocher, jour, {
    enfant: 'timo', etape: etape.id, parent: true, maintenant,
  });
  assert.equal(jour.enfants.timo.gagnees, 32);
  assert.throws(() => cocher(jour, B, {
    enfant: 'timo', etape: 'dents', parent: false, maintenant,
  }), refus('deja_cochee'));
  const bas = brut();
  bas.enfants[0].plafond = 20;
  const bareme20 = validerBareme(bas);
  let autre = journeeVide('2026-10-14', bareme20);
  for (const etape of timo.etapes) autre = ok(cocher, autre, {
    enfant: 'timo', etape: etape.id, parent: true, maintenant,
  }, bareme20);
  assert.equal(autre.enfants.timo.gagnees, 20);
});

test('confiance : « Levé » et « N\'excite pas Pablo » cochés par Timo comptent tout de suite, comme les autres étapes ; un parent corrige', () => {
  const maintenant = t('2026-10-14T07:10:00+02:00');
  let jour = journeeVide('2026-10-14', B);
  for (const etape of ['leve', 'calme']) {
    jour = ok(cocher, jour, {
      enfant: 'timo', etape, parent: false, maintenant,
    });
    assert.deepEqual([dernier.statut, dernier.par], ['valide', 'enfant'], etape);
  }
  assert.equal(jour.enfants.timo.gagnees, 14, '10 + 4, sans attendre un parent');
  assert.throws(() => decider(jour, B, {
    enfant: 'timo', etape: 'calme', decision: 'refuser', maintenant,
  }), refus('pas_en_attente'), 'rien n\'attend un parent');
  const corrige = ok(annuler, jour, {
    enfant: 'timo', etape: 'calme', parent: true, maintenant: maintenant + 3600_000,
  });
  assert.deepEqual([dernier.statut, corrige.enfants.timo.gagnees], ['a_faire', 10], 'un parent décoche en mode parent');
});

test('variante « parent » du barème : étape cochée par l\'enfant en attente, rien ne compte avant la validation', () => {
  const maintenant = t('2026-10-14T07:10:00+02:00');
  let jour = ok(cocher, journeeVide('2026-10-14', BP), {
    enfant: 'timo', etape: 'dents', parent: false, maintenant,
  }, BP);
  assert.deepEqual([dernier.statut, dernier.par, jour.enfants.timo.gagnees], ['valide', 'enfant', 3]);
  jour = ok(cocher, jour, {
    enfant: 'timo', etape: 'calme', parent: false, maintenant,
  }, BP);
  assert.deepEqual([dernier.statut, jour.enfants.timo.gagnees], ['attente', 3], 'en attente : toujours 3');
  assert.equal(jour.enfants.timo.etapes.calme.valide_le, null);
  jour = ok(decider, jour, {
    enfant: 'timo', etape: 'calme', decision: 'valider', maintenant: maintenant + 60_000,
  }, BP);
  assert.deepEqual([dernier.statut, jour.enfants.timo.gagnees], ['valide', 7]);
  assert.equal(jour.enfants.timo.etapes.calme.valide_le, '2026-10-14T05:11:00.000Z');
  assert.throws(() => decider(jour, BP, {
    enfant: 'timo', etape: 'calme', decision: 'valider', maintenant,
  }), refus('pas_en_attente'), 'déjà validée');
  assert.throws(() => decider(jour, BP, {
    enfant: 'timo', etape: 'dents', decision: 'refuser', maintenant,
  }), refus('pas_en_attente'), 'une étape validée ne se refuse pas : on ne retire jamais de minutes');
});

test('variante « parent » : étape en attente refusée par un parent, retour à faire, rien de gagné ; cochée en mode parent : validée', () => {
  const maintenant = t('2026-10-14T07:10:00+02:00');
  let jour = ok(cocher, journeeVide('2026-10-14', BP), {
    enfant: 'timo', etape: 'leve', parent: false, maintenant,
  }, BP);
  jour = ok(decider, jour, {
    enfant: 'timo', etape: 'leve', decision: 'refuser', maintenant,
  }, BP);
  assert.deepEqual([dernier.statut, jour.enfants.timo.gagnees, jour.enfants.timo.etapes.leve], ['a_faire', 0, undefined]);
  jour = ok(cocher, jour, {
    enfant: 'timo', etape: 'leve', parent: true, maintenant,
  }, BP);
  assert.deepEqual([dernier.statut, dernier.par, jour.enfants.timo.gagnees], ['valide', 'parent', 10]);
});

test('« Levé » : refusé avant 6 h 30 (même en mode parent), accepté à 6 h 30 pile et compté tout de suite (confiance)', () => {
  const vide = journeeVide('2026-10-14', B);
  for (const parent of [false, true]) {
    assert.throws(() => cocher(vide, B, {
      enfant: 'timo', etape: 'leve', parent, maintenant: t('2026-10-14T06:29:59+02:00'),
    }), refus('trop_tot'));
  }
  const leve = ok(cocher, vide, {
    enfant: 'timo', etape: 'leve', parent: false, maintenant: t('2026-10-14T06:30:00+02:00'),
  });
  assert.deepEqual([dernier.statut, leve.enfants.timo.gagnees], ['valide', 10]);
  ok(cocher, journeeVide('2026-10-14', BP), {
    enfant: 'timo', etape: 'leve', parent: false, maintenant: t('2026-10-14T06:30:00+02:00'),
  }, BP);
  assert.equal(dernier.statut, 'attente', 'variante « parent » : en attente');
  const projection = projeter({
    bareme: B, jour: vide, registre: registreVide(B), maintenant: t('2026-10-14T09:00:00+02:00'),
  });
  assert.deepEqual(projection.enfants[0].etapes[0], {
    id: 'leve', libelle: 'Levé', picto: 'i-reveil', valeur: 10, validation: 'enfant', apres: '06:30', statut: 'a_faire', par: null, coche_le: null, annulable_jusqu_a: null,
  });
  assert.equal(projection.enfants[0].gagnees, 0);
});

test('annulation : possible 5 s après la coche (plus 1 s de marge réseau), refusée après ; une étape pas cochée : 404', () => {
  const coche = t('2026-10-14T07:00:00+02:00');
  const jour = ok(cocher, journeeVide('2026-10-14', B), {
    enfant: 'timo', etape: 'habille', parent: false, maintenant: coche,
  });
  assert.equal(dernier.annulable_jusqu_a, '2026-10-14T05:00:05.000Z');
  for (const delai of [4_900, 5_500, 6_000]) {
    const annulee = ok(annuler, jour, { enfant: 'timo', etape: 'habille', maintenant: coche + delai });
    assert.deepEqual([dernier.statut, annulee.enfants.timo.gagnees], ['a_faire', 0], `${delai} ms`);
  }
  assert.throws(() => annuler(jour, B, { enfant: 'timo', etape: 'habille', maintenant: coche + 6_001 }), refus('trop_tard'));
  assert.throws(() => annuler(jour, B, { enfant: 'timo', etape: 'dents', maintenant: coche }), (err) => err.code === 'pas_cochee' && err.statut === 404);
});

test('routine du matin : un enfant ne coche plus à partir de 9 h (8 h 59 59 encore permis), un parent si ; projection routine_finie', () => {
  const vide = journeeVide('2026-10-14', B);
  ok(cocher, vide, {
    enfant: 'timo', etape: 'dents', parent: false, maintenant: t('2026-10-14T08:59:59+02:00'),
  });
  assert.equal(dernier.statut, 'valide');
  for (const [enfant, etape] of [['timo', 'dents'], ['timo', 'leve'], ['pablo', 'chaussures']]) {
    assert.throws(() => cocher(vide, B, {
      enfant, etape, parent: false, maintenant: t('2026-10-14T09:00:00+02:00'),
    }), (err) => err.code === 'routine_finie' && err.statut === 409, `${enfant} ${etape}`);
  }
  assert.throws(() => cocher(vide, B, {
    enfant: 'timo', etape: 'habille', parent: false, maintenant: t('2026-10-14T19:30:00+02:00'),
  }), refus('routine_finie'), 'les minutes ne se gagnent plus le soir');
  ok(cocher, vide, {
    enfant: 'timo', etape: 'calme', parent: true, maintenant: t('2026-10-14T11:00:00+02:00'),
  });
  assert.deepEqual([dernier.statut, dernier.par], ['valide', 'parent']);
  const vue = (quand) => projeter({
    bareme: B, jour: vide, registre: registreVide(B), maintenant: t(quand),
  });
  assert.deepEqual([vue('2026-10-14T08:59:59+02:00').routine_finie, vue('2026-10-14T09:00:00+02:00').routine_finie], [false, true]);
  assert.equal(vue('2026-10-14T09:00:00+02:00').fin_routine, '09:00');
});

test('annulation sans jeton : seulement une coche de l\'enfant ; une étape cochée par un parent ne se défait qu\'en mode parent', () => {
  const coche = t('2026-10-14T07:00:00+02:00');
  const jour = ok(cocher, journeeVide('2026-10-14', B), {
    enfant: 'timo', etape: 'leve', parent: true, maintenant: coche,
  });
  assert.throws(() => annuler(jour, B, { enfant: 'timo', etape: 'leve', maintenant: coche + 1_000 }), (err) => err.code === 'mode_parent_requis' && err.statut === 403);
  ok(annuler, jour, {
    enfant: 'timo', etape: 'leve', parent: true, maintenant: coche + 1_000,
  });
  assert.equal(dernier.statut, 'a_faire');
});

test('correction d\'un parent : il décoche une étape cochée par erreur sans délai ; les minutes disponibles ne deviennent jamais négatives', () => {
  const debut = t('2026-10-14T07:00:00+02:00');
  let jour = ok(cocher, journeeVide('2026-10-14', B), {
    enfant: 'timo', etape: 'habille', parent: false, maintenant: debut,
  });
  jour = ok(piloterMinuteur, jour, { enfant: 'timo', action: 'demarrer', maintenant: debut + 1_000 });
  jour = ok(piloterMinuteur, jour, { enfant: 'timo', action: 'pause', maintenant: debut + 241_000 });
  const plusTard = debut + 3600_000;
  assert.throws(() => annuler(jour, B, { enfant: 'timo', etape: 'habille', maintenant: plusTard }), refus('trop_tard'), 'sans mode parent : 5 s seulement');
  const corrige = ok(annuler, jour, {
    enfant: 'timo', etape: 'habille', parent: true, maintenant: plusTard,
  });
  assert.deepEqual([dernier.statut, corrige.enfants.timo.gagnees, corrige.enfants.timo.etapes.habille], ['a_faire', 0, undefined]);
  assert.equal(disponiblesS(B.enfants[0], corrige.enfants.timo, '2026-10-14', B, plusTard), 0, '4 min déjà utilisées : 0, jamais moins');
});

test('enfant ou étape inconnus : 404 ; Pablo n\'a pas de minuteur', () => {
  const jour = journeeVide('2026-10-14', B);
  const maintenant = t('2026-10-14T07:00:00+02:00');
  assert.throws(() => cocher(jour, B, {
    enfant: 'lea', etape: 'dents', parent: false, maintenant,
  }), (err) => err.code === 'enfant_inconnu' && err.statut === 404);
  assert.throws(() => cocher(jour, B, {
    enfant: 'pablo', etape: 'leve', parent: false, maintenant,
  }), (err) => err.code === 'etape_inconnue' && err.statut === 404);
  assert.throws(() => piloterMinuteur(jour, B, { enfant: 'pablo', action: 'demarrer', maintenant }), refus('sans_minutes'));
});

test('minuteur : jamais au-delà des minutes gagnées ; pause, reprise, fin toute seule, puis plus rien à regarder', () => {
  let maintenant = t('2026-10-14T07:00:00+02:00');
  let jour = journeeVide('2026-10-14', B);
  assert.throws(() => piloterMinuteur(jour, B, { enfant: 'timo', action: 'demarrer', maintenant }), refus('aucune_minute'));
  assert.throws(() => piloterMinuteur(jour, B, { enfant: 'timo', action: 'finir', maintenant }), refus('aucun_minuteur'));
  jour = ok(cocher, jour, {
    enfant: 'timo', etape: 'leve', parent: true, maintenant,
  });
  jour = ok(cocher, jour, {
    enfant: 'timo', etape: 'dents', parent: false, maintenant,
  });
  jour = ok(piloterMinuteur, jour, { enfant: 'timo', action: 'demarrer', maintenant });
  assert.deepEqual(dernier.minuteur, { etat: 'en_cours', debut: '2026-10-14T05:00:00.000Z', duree_s: 780 });
  assert.throws(() => piloterMinuteur(jour, B, { enfant: 'timo', action: 'demarrer', maintenant }), refus('deja_en_cours'));
  maintenant += 120_000;
  jour = ok(piloterMinuteur, jour, { enfant: 'timo', action: 'pause', maintenant });
  assert.deepEqual([dernier.minuteur, jour.enfants.timo.utilisees_s, dernier.disponibles_s], [{ etat: 'pause' }, 120, 660]);
  assert.throws(() => piloterMinuteur(jour, B, { enfant: 'timo', action: 'pause', maintenant }), refus('pas_en_cours'));
  maintenant += 600_000;
  jour = ok(piloterMinuteur, jour, { enfant: 'timo', action: 'demarrer', maintenant });
  assert.equal(dernier.minuteur.duree_s, 660, 'la reprise ne donne que le reste');
  assert.equal(finaliserMinuteurs(jour, maintenant + 659_000), jour, 'pas encore fini : même journée');
  jour = finaliserMinuteurs(jour, maintenant + 700_000);
  assert.deepEqual(jour.enfants.timo.minuteur, { etat: 'termine', fin_le: '2026-10-14T05:23:00.000Z' });
  assert.equal(jour.enfants.timo.utilisees_s, 780, 'jamais plus que les 13 min gagnées, même lu 40 s après la fin');
  assert.throws(() => piloterMinuteur(jour, B, { enfant: 'timo', action: 'demarrer', maintenant: maintenant + 700_000 }), refus('aucune_minute'));
  jour = ok(piloterMinuteur, jour, { enfant: 'timo', action: 'finir', maintenant: maintenant + 710_000 });
  assert.equal(jour.enfants.timo.minuteur, null);
});

test('minuteur : une étape validée pendant qu\'il tourne l\'allonge, une annulation le raccourcit, finir garde le reste', () => {
  const debut = t('2026-10-14T07:30:00+02:00');
  let jour = ok(cocher, journeeVide('2026-10-14', B), {
    enfant: 'timo', etape: 'dents', parent: false, maintenant: debut - 60_000,
  });
  jour = ok(piloterMinuteur, jour, { enfant: 'timo', action: 'demarrer', maintenant: debut });
  assert.equal(jour.enfants.timo.minuteur.duree_s, 180);
  jour = ok(cocher, jour, {
    enfant: 'timo', etape: 'habille', parent: false, maintenant: debut + 2_000,
  });
  assert.equal(jour.enfants.timo.minuteur.duree_s, 480);
  jour = ok(annuler, jour, { enfant: 'timo', etape: 'habille', maintenant: debut + 4_000 });
  assert.equal(jour.enfants.timo.minuteur.duree_s, 180);
  jour = ok(piloterMinuteur, jour, { enfant: 'timo', action: 'finir', maintenant: debut + 60_000 });
  assert.deepEqual([dernier.minuteur, jour.enfants.timo.utilisees_s, dernier.disponibles_s], [null, 60, 120]);
});

test('minutes perdues le soir : le minuteur s\'arrête à 20 h, plus rien après, et le lendemain repart de zéro', () => {
  let jour = journeeVide('2026-10-14', B);
  for (const etape of timo.etapes) jour = ok(cocher, jour, {
    enfant: 'timo', etape: etape.id, parent: true, maintenant: t('2026-10-14T07:00:00+02:00'),
  });
  jour = ok(piloterMinuteur, jour, { enfant: 'timo', action: 'demarrer', maintenant: t('2026-10-14T19:55:00+02:00') });
  assert.equal(dernier.minuteur.duree_s, 300, '5 min jusqu\'à 20 h, pas 32');
  const vingtHeures = t('2026-10-14T20:00:00+02:00');
  jour = finaliserMinuteurs(jour, vingtHeures);
  assert.deepEqual(jour.enfants.timo.minuteur, { etat: 'termine', fin_le: '2026-10-14T18:00:00.000Z' });
  assert.equal(disponiblesS(timo, jour.enfants.timo, '2026-10-14', B, vingtHeures - 1), 32 * 60 - 300);
  assert.equal(disponiblesS(timo, jour.enfants.timo, '2026-10-14', B, vingtHeures), 0);
  assert.throws(() => piloterMinuteur(jour, B, { enfant: 'timo', action: 'demarrer', maintenant: vingtHeures + 1_000 }), refus('minutes_perdues'));
  const soir = projeter({
    bareme: B, jour, registre: registreVide(B), maintenant: vingtHeures,
  });
  assert.deepEqual(soir.enfants[0].minutes, {
    plafond: 32, utilisees_s: 300, disponibles_s: 0, perdues: true,
  });
  const lendemain = journeeVide(journeeDe(t('2026-10-15T04:00:00+02:00')), B);
  assert.deepEqual([lendemain.journee, lendemain.enfants.timo.gagnees, lendemain.enfants.timo.utilisees_s], ['2026-10-15', 0, 0]);
});

test('prochain changement sans action : fin de la routine à 9 h, 20 h, la fin d\'un minuteur qui tourne, puis 4 h le lendemain (heure d\'hiver comprise)', () => {
  let jour = ok(cocher, journeeVide('2026-10-24', B), {
    enfant: 'timo', etape: 'dents', parent: false, maintenant: t('2026-10-24T07:00:00+02:00'),
  });
  assert.equal(prochainEvenement(jour, B, t('2026-10-24T07:00:00+02:00')), t('2026-10-24T09:00:00+02:00'));
  assert.equal(prochainEvenement(jour, B, t('2026-10-24T09:00:00+02:00')), t('2026-10-24T20:00:00+02:00'));
  jour = ok(piloterMinuteur, jour, { enfant: 'timo', action: 'demarrer', maintenant: t('2026-10-24T07:10:00+02:00') });
  assert.equal(prochainEvenement(jour, B, t('2026-10-24T07:10:00+02:00')), t('2026-10-24T07:13:00+02:00'));
  assert.equal(prochainEvenement(journeeVide('2026-10-24', B), B, t('2026-10-24T21:00:00+02:00')), t('2026-10-25T04:00:00+01:00'));
});

test('Pablo : une étoile par étape, « Ensuite » débloqué seulement quand tout est fait ; ni minutes ni points', () => {
  const maintenant = t('2026-10-14T07:20:00+02:00');
  let jour = journeeVide('2026-10-14', B);
  const vue = () => projeter({
    bareme: B, jour, registre: registreVide(B), maintenant,
  }).enfants[1];
  for (const etape of ['petit-dejeuner', 'dents']) jour = ok(cocher, jour, {
    enfant: 'pablo', etape, parent: false, maintenant,
  });
  assert.deepEqual([vue().gagnees, vue().ensuite], [2, { libelle: 'Une histoire', picto: 'i-livre', debloque: false }]);
  jour = ok(cocher, jour, {
    enfant: 'pablo', etape: 'chaussures', parent: false, maintenant,
  });
  assert.deepEqual([vue().type, vue().gagnees, vue().ensuite.debloque], ['etoiles', 3, true]);
  assert.deepEqual([vue().minutes, vue().minuteur, vue().points, vue().demande], [null, null, null, null]);
});

test('valeur recopiée à la coche : un barème changé ensuite ne change pas ce qui a été gagné ; enfant ajouté au barème complété', () => {
  const maintenant = t('2026-10-14T07:00:00+02:00');
  let jour = ok(cocher, journeeVide('2026-10-14', B), {
    enfant: 'timo', etape: 'dents', parent: false, maintenant,
  });
  const change = brut();
  change.enfants[0].etapes[2].valeur = 4;
  jour = ok(cocher, jour, {
    enfant: 'timo', etape: 'habille', parent: false, maintenant,
  }, validerBareme(change));
  assert.equal(jour.enfants.timo.gagnees, 3 + 5);
  const sansPablo = { version: 1, journee: '2026-10-14', enfants: { timo: jour.enfants.timo } };
  assert.deepEqual(completerJournee(sansPablo, B).enfants.pablo, { etapes: {}, gagnees: 0 });
  assert.equal(completerJournee(jour, B), jour, 'rien à compléter : même objet');
});
