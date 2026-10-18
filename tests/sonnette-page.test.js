// tests/sonnette-page.test.js
//
// Rôle    : prouver les règles de la sonnette côté page, sans DOM (web/src/sonnette.js) : le bandeau s'ouvre sur un
//           NOUVEAU coup de sonnette (binary_sensor.doorbell_ringing à on, last_changed jamais vu), pas sur les messages
//           suivants du même coup ni sur un coup déjà vieux ; il dit l'heure du coup, ne montre QUE la photo de ce coup
//           (« Photo en cours… », puis la photo et son heure, ou « Pas de photo de ce coup »), propose « Voir le direct »
//           seulement avec un flux vidéo, se masque au bout de 2 min ou au toucher, et un second coup le relance ; la
//           légende de la photo de l'onglet Sonnette ; le direct : vidéo demandée APRÈS l'accord de la maison, un
//           nouvel essai, puis arrêt (jamais une photo fixe présentée comme un direct).
// Entrées : des entités projetées comme le serveur les envoie ({ state, last_changed, attributes }), des heures en ms.
// Sorties : node --test.
// Pièges  : l'heure affichée est celle de Paris (le 14/10/2026, UTC+2).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ATTENTE_VIDEO_MS, creerDirect, creerVeilleSonnette, DELAI_VIDEO_MS, DUREE_BANDEAU_MS, DUREE_DIRECT_MS, photoDuSuivi,
} from '../web/src/sonnette.js';

const T0 = Date.parse('2026-10-14T17:41:00Z'); // 19:41 à Paris
const sonnerie = (state, quand) => ({ state, last_changed: new Date(quand).toISOString(), attributes: {} });

test('bandeau : un coup de sonnette l\'ouvre, « On a sonné · 19:41 », « Photo en cours… » tant que la photo de CE coup n\'est pas là', () => {
  const veille = creerVeilleSonnette();
  assert.equal(veille.vue(T0, null, true), null);
  assert.equal(veille.observer(sonnerie('off', T0 - 60000), T0), false);
  const coup = sonnerie('on', T0);
  assert.equal(veille.observer(coup, T0 + 800), true, 'arrivée par le flux 0,8 s après');
  assert.deepEqual(veille.vue(T0 + 800, null, true), {
    texte: 'On a sonné · 19:41', photo: null, legende: 'Photo en cours…', direct: true,
  }, 'suivi pas encore reçu');
  const ancien = { dernier_coup: '2026-10-14T04:14:55.000Z', photo: 'du_coup', photo_le: '2026-10-14T04:15:02.000Z' };
  assert.equal(veille.vue(T0 + 800, ancien, true).photo, null, 'la photo d\'un coup précédent n\'est JAMAIS montrée sous « On a sonné »');
  const enCours = { dernier_coup: coup.last_changed, photo: 'en_cours', photo_le: null };
  assert.equal(veille.vue(T0 + 2000, enCours, true).legende, 'Photo en cours…');
  const arrivee = Date.parse('2026-10-14T17:41:09Z');
  const duCoup = { dernier_coup: coup.last_changed, photo: 'du_coup', photo_le: new Date(arrivee).toISOString() };
  assert.deepEqual(veille.vue(T0 + 10000, duCoup, true), {
    texte: 'On a sonné · 19:41', photo: `/api/sonnette.jpg?n=${arrivee}`, legende: 'Photo de 19:41', direct: true,
  });
  assert.equal(veille.vue(T0 + 60000, duCoup, true).photo, `/api/sonnette.jpg?n=${arrivee}`, 'une seule demande : l\'URL ne change plus');
  const avant = { dernier_coup: coup.last_changed, photo: 'avant_coup', photo_le: null };
  assert.deepEqual([veille.vue(T0 + 50000, avant, true).photo, veille.vue(T0 + 50000, avant, true).legende], [null, 'Pas de photo de ce coup de sonnette']);
});

test('bandeau : « Voir le direct » seulement avec un flux vidéo (une photo fixe n\'est pas un direct)', () => {
  const veille = creerVeilleSonnette();
  veille.observer(sonnerie('on', T0), T0);
  assert.equal(veille.vue(T0, null, false).direct, false);
  assert.equal(veille.vue(T0, null, undefined).direct, false);
  assert.equal(veille.vue(T0, null, true).direct, true);
});

test('bandeau : les messages suivants du même coup ne le rouvrent pas ; masqué après 2 min ; un second coup le relance', () => {
  const veille = creerVeilleSonnette();
  veille.observer(sonnerie('on', T0), T0);
  assert.equal(veille.observer(sonnerie('on', T0), T0 + 3000), false, 'même last_changed : même coup');
  assert.equal(veille.observer(sonnerie('off', T0 + 10000), T0 + 10000), false, 'fin de la sonnerie (10 s) : rien');
  assert.notEqual(veille.vue(T0 + DUREE_BANDEAU_MS - 1, null, true), null);
  assert.equal(veille.vue(T0 + DUREE_BANDEAU_MS, null, true), null, '2 min : masqué');
  const second = T0 + DUREE_BANDEAU_MS + 30000;
  assert.equal(veille.observer(sonnerie('on', second), second + 500), true);
  assert.equal(veille.vue(second + 500, null, true).texte, 'On a sonné · 19:43');
  assert.equal(veille.vue(second + 500 + DUREE_BANDEAU_MS - 1, null, true).texte, 'On a sonné · 19:43', '2 min de plus depuis le second coup');
});

test('bandeau : au toucher, masqué ; il ne revient qu\'avec un nouveau coup', () => {
  const veille = creerVeilleSonnette();
  veille.observer(sonnerie('on', T0), T0);
  veille.fermer();
  assert.equal(veille.vue(T0 + 1000, null, true), null);
  assert.equal(veille.observer(sonnerie('on', T0), T0 + 2000), false, 'le même coup ne le rouvre pas');
  assert.equal(veille.observer(sonnerie('on', T0 + 20000), T0 + 20000), true, 'un nouveau coup, si');
});

test('bandeau : un coup vieux de plus de 2 min (page rechargée bien après) ou une heure illisible n\'ouvrent rien', () => {
  const veille = creerVeilleSonnette();
  assert.equal(veille.observer(sonnerie('on', T0), T0 + DUREE_BANDEAU_MS + 1), false);
  assert.equal(veille.vue(T0 + DUREE_BANDEAU_MS + 1, null, true), null);
  assert.equal(veille.observer({ state: 'on', last_changed: '', attributes: {} }, T0), false);
  assert.equal(veille.observer(undefined, T0), false);
  assert.equal(veille.observer(sonnerie('unavailable', T0), T0), false);
});

test('onglet Sonnette : légende de la photo selon le suivi ; rien de demandé pendant l\'attente de la photo d\'un coup', () => {
  assert.deepEqual(photoDuSuivi(null), { charger: true, cle: 'inconnue', legende: 'Dernière photo enregistrée (heure inconnue)' });
  assert.deepEqual(photoDuSuivi({ dernier_coup: 'x', photo: 'en_cours', photo_le: null }).charger, false);
  assert.deepEqual(photoDuSuivi({ dernier_coup: 'x', photo: 'du_coup', photo_le: '2026-10-14T17:41:09.000Z' }), {
    charger: true, cle: '2026-10-14T17:41:09.000Z', legende: 'Photo du dernier coup de sonnette, prise à 19:41',
  });
  assert.equal(photoDuSuivi({ dernier_coup: 'x', photo: 'avant_coup', photo_le: null }).legende, 'Photo prise avant le dernier coup de sonnette');
});

test('direct : la vidéo n\'est demandée qu\'APRÈS l\'accord de la maison (+3 s), 3 min en tout, temps restant ; arrêt', () => {
  const direct = creerDirect();
  assert.equal(direct.vue(T0), null);
  direct.lancer(T0);
  assert.deepEqual(direct.vue(T0), {
    etape: 'lancement', restant: '3:00', source: null, image: false,
  }, 'action envoyée, pas encore de vidéo');
  direct.accepte(T0 + 600);
  assert.equal(direct.vue(T0 + 600 + DELAI_VIDEO_MS - 1).source, null, 'le flux P2P s\'ouvre');
  assert.equal(direct.vue(T0 + 600 + DELAI_VIDEO_MS).source, `/api/sonnette.mjpeg?n=${T0}-1`);
  direct.imageRecue();
  assert.deepEqual(direct.vue(T0 + 19500), {
    etape: 'video', restant: '2:41', source: `/api/sonnette.mjpeg?n=${T0}-1`, image: true,
  });
  assert.equal(direct.verifier(T0 + 60000), null, 'images reçues : rien à vérifier');
  assert.equal(direct.vue(T0 + DUREE_DIRECT_MS - 1).restant, '0:01');
  assert.equal(direct.vue(T0 + DUREE_DIRECT_MS), null, 'fin au bout de 3 min');
  direct.lancer(T0);
  direct.arreter();
  assert.equal(direct.vue(T0 + 1000), null);
});

test('direct : vidéo muette (10 s sans image) ou en erreur -> un nouvel essai, puis le direct s\'arrête ; coupée après des images -> arrêt', () => {
  const muet = creerDirect();
  muet.lancer(T0);
  assert.equal(muet.verifier(T0 + 60000), null, 'pas de délai avant l\'accord de la maison');
  muet.accepte(T0);
  const demande = T0 + DELAI_VIDEO_MS;
  assert.equal(muet.verifier(demande + ATTENTE_VIDEO_MS - 1), null);
  assert.equal(muet.verifier(demande + ATTENTE_VIDEO_MS), 'nouvel_essai');
  const relance = muet.vue(demande + ATTENTE_VIDEO_MS + 1000);
  assert.equal(relance.source, `/api/sonnette.mjpeg?n=${T0}-2`, 'nouvelle URL pour le second essai');
  assert.equal(muet.echecVideo(demande + ATTENTE_VIDEO_MS + 2000), 'muette');
  assert.equal(muet.vue(demande + ATTENTE_VIDEO_MS + 2000), null, 'arrêté : aucune photo fixe ne prend sa place');

  const coupe = creerDirect();
  coupe.lancer(T0);
  coupe.accepte(T0);
  coupe.imageRecue();
  assert.equal(coupe.echecVideo(T0 + 30000), 'coupee');
  assert.equal(coupe.vue(T0 + 30000), null);

  const refuse = creerDirect();
  refuse.lancer(T0);
  assert.equal(refuse.echecVideo(T0 + 1000), null, 'pas de vidéo demandée avant l\'accord : rien à compter');
  refuse.arreter();
  assert.equal(refuse.vue(T0 + 1000), null);
});
