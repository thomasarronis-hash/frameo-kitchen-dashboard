// tests/enfants-routes.test.js
//
// Rôle    : prouver le tableau des enfants de bout en bout côté serveur (serveur/routes/enfants.js, serveur/sources/enfants.js,
//           serveur/enfants/stockage.js, serveur/enfants/mode-parent.js) : clé exigée, mode parent (jeton de 60 s, expiré
//           refusé, jamais journalisé), parcours du matin par HTTP (tout en confiance ; validation par un parent sur une
//           variante du barème), annulation, points et boutique (+1 libre sans jeton, plafond, annulation bornée, −1 avec
//           jeton, solde jamais négatif), entrées invalides et
//           limites, fichiers écrits de façon atomique, validés et plafonnés, purge de 90 jours, historique de 7 jours, et
//           l'état dans le flux SSE (instantané, maj après une action, maj toute seule à la fin du minuteur et à 20 h).
// Entrées : un dossier d'état temporaire (os.tmpdir()) ; une horloge réglable ; l'application montée par tests/aides.js.
// Sorties : node --test.
// Pièges  :
//   - La source est la même pour les routes et pour le flux (index.js la met dans les deux) : le test aussi.
//   - Les limites de débit comptent en temps réel (pas l'horloge réglable) : chaque test monte sa propre application.

import assert from 'node:assert/strict';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHEMIN_BAREME, chargerBareme, validerBareme } from '../serveur/enfants/bareme.js';
import { creerModeParent } from '../serveur/enfants/mode-parent.js';
import { TAILLE_MAX_REGISTRE } from '../serveur/enfants/stockage.js';
import { TAILLE_MAX_ETAT } from '../serveur/etat-local.js';
import { SourceEnfants } from '../serveur/sources/enfants.js';
import { CLE, monter, ouvrirFlux } from './aides.js';

const BAREME = chargerBareme();
// La validation « parent » reste permise au barème, plus utilisée par celui de Thomas : variante pour la prouver par HTTP.
const BAREME_PARENT = (() => {
  const variante = JSON.parse(readFileSync(CHEMIN_BAREME, 'utf8'));
  variante.enfants[0].etapes.find((etape) => etape.id === 'leve').validation = 'parent';
  return validerBareme(variante);
})();
const CADRE = { 'x-cadre-cle': CLE, 'content-type': 'application/json' };

function journalCapture() {
  const lignes = [];
  return {
    lignes, info: (m) => lignes.push(m), warn: (m) => lignes.push(m), error: (m) => lignes.push(m),
  };
}

function nouveauDossier(t) {
  const racine = mkdtempSync(join(tmpdir(), 'cadre-enfants-'));
  t.after(() => rmSync(racine, { recursive: true, force: true }));
  return join(racine, 'etat', 'enfants');
}

function deposer(dossier, chemin, contenu) {
  const complet = join(dossier, chemin);
  mkdirSync(join(complet, '..'), { recursive: true });
  writeFileSync(complet, typeof contenu === 'string' ? contenu : JSON.stringify(contenu));
}

async function preparer(t, quand, { dossier = nouveauDossier(t), reel = false, bareme = BAREME } = {}) {
  const depart = Date.parse(quand);
  const debutReel = Date.now();
  const horloge = { ms: depart };
  const maintenant = reel ? () => depart + (Date.now() - debutReel) : () => horloge.ms;
  const journal = journalCapture();
  const enfants = new SourceEnfants({
    dossier, bareme, journal, maintenant,
  });
  await enfants.actualiser();
  const modeParent = creerModeParent({ maintenant });
  const monte = await monter({ enfants, modeParent, sources: { enfants } });
  t.after(async () => {
    enfants.arreter();
    await monte.app.close();
  });
  return {
    ...monte, enfants, horloge, dossier, journalSource: journal,
  };
}

function post(app, chemin, corps, entetes = CADRE) {
  const sansCorps = corps === undefined;
  const headers = sansCorps ? Object.fromEntries(Object.entries(entetes).filter(([nom]) => nom !== 'content-type')) : entetes;
  return app.inject({
    method: 'POST', url: `/api/enfants${chemin}`, headers, payload: sansCorps ? undefined : JSON.stringify(corps),
  });
}
const jeton = async (app) => (await post(app, '/parent', {})).json().jeton;
const enParent = (valeur) => (valeur === undefined ? CADRE : { ...CADRE, 'x-cadre-parent': valeur });
const lireJson = (dossier, chemin) => JSON.parse(readFileSync(join(dossier, chemin), 'utf8'));

test('enfants : clé d\'appareil exigée sur toutes les routes (401), avant le mode parent', async (t) => {
  const { app } = await preparer(t, '2026-10-14T07:00:00+02:00');
  const sansCle = { 'content-type': 'application/json' };
  const routes = ['/parent', '/timo/etapes/dents', '/timo/etapes/dents/annuler', '/timo/etapes/leve/decision', '/timo/points', '/timo/points/retirer',
    '/timo/points/libre', '/timo/points/libre/annuler', '/timo/echanges', '/timo/echanges/abcd0123/decision', '/timo/minuteur'];
  for (const chemin of routes) assert.equal((await post(app, chemin, {}, sansCle)).statusCode, 401, chemin);
  assert.equal((await app.inject({ url: '/api/enfants/historique' })).statusCode, 401);
});

test('mode parent : jeton de 60 s ; sans jeton, faux ou expiré, les routes parent répondent 403 ; le jeton n\'est jamais journalisé', async (t) => {
  const { app, horloge, journal } = await preparer(t, '2026-10-14T07:00:00+02:00');
  const reponse = await post(app, '/parent', undefined);
  assert.equal(reponse.statusCode, 200);
  const { jeton: valeur, expire_le: expire } = reponse.json();
  assert.match(valeur, /^[0-9a-f]{32}$/);
  assert.equal(Date.parse(expire) - horloge.ms, 60_000, '60 s, écrit en dur : changer la durée oblige à changer ce test');
  let valeurFournie;
  const appels = [
    () => post(app, '/timo/points', {}, enParent(valeurFournie)),
    () => post(app, '/timo/points/retirer', {}, enParent(valeurFournie)),
    () => post(app, '/timo/etapes/leve/decision', { decision: 'valider' }, enParent(valeurFournie)),
    () => app.inject({ url: '/api/enfants/historique', headers: enParent(valeurFournie) }),
  ];
  const presque = `${valeur.slice(0, -1)}${valeur.endsWith('0') ? '1' : '0'}`;
  for (valeurFournie of [undefined, '', 'faux', presque]) {
    for (const appel of appels) {
      const refus = await appel();
      assert.deepEqual([refus.statusCode, refus.json()], [403, { erreur: 'mode_parent_requis' }], String(valeurFournie));
    }
  }
  valeurFournie = valeur;
  horloge.ms += 59_999;
  assert.equal((await appels[0]()).statusCode, 200, 'encore valable à 59,999 s');
  horloge.ms += 1;
  assert.equal((await appels[1]()).statusCode, 403, 'expiré à 60 s');
  const autre = await jeton(app);
  assert.equal((await post(app, '/timo/points', {}, enParent(autre))).statusCode, 200);
  assert.equal((await post(app, '/timo/points', {}, enParent(valeur))).statusCode, 403, 'un nouveau jeton remplace l\'ancien');
  assert.ok(!journal().includes(valeur) && !journal().includes(autre), 'jeton absent du journal');
  assert.match(journal(), /"x-cadre-parent":"\[masqué\]"/);
});

test('cocher avec un en-tête parent invalide : 403 et rien d\'écrit (jamais une coche « enfant » silencieuse)', async (t) => {
  const { app, dossier } = await preparer(t, '2026-10-14T07:00:00+02:00');
  const reponse = await post(app, '/timo/etapes/calme', {}, enParent('perime'));
  assert.deepEqual([reponse.statusCode, reponse.json()], [403, { erreur: 'mode_parent_requis' }]);
  assert.equal(existsSync(join(dossier, 'journees')), false);
});

test('parcours du matin par HTTP : coches de Timo (« Levé » compris, en confiance), minuteur ; fichier de la journée écrit', async (t) => {
  const { app, horloge, dossier } = await preparer(t, '2026-10-14T07:00:00+02:00');
  const dents = await post(app, '/timo/etapes/dents', undefined);
  assert.deepEqual(dents.json(), {
    enfant: 'timo', etape: 'dents', statut: 'valide', par: 'enfant', annulable_jusqu_a: '2026-10-14T05:00:05.000Z',
  });
  assert.equal(dents.headers['cache-control'], 'no-store');
  const leve = (await post(app, '/timo/etapes/leve', {})).json();
  assert.deepEqual([leve.statut, leve.par], ['valide', 'enfant'], 'confiance : compté tout de suite, sans parent');
  const parentDirect = await post(app, '/timo/etapes/calme', {}, enParent(await jeton(app)));
  assert.deepEqual([parentDirect.json().statut, parentDirect.json().par], ['valide', 'parent']);
  const demarre = await post(app, '/timo/minuteur', { action: 'demarrer' });
  assert.deepEqual(demarre.json(), {
    enfant: 'timo', minuteur: { etat: 'en_cours', debut: '2026-10-14T05:00:00.000Z', duree_s: 1020 }, disponibles_s: 1020,
  });
  horloge.ms += 300_000;
  assert.deepEqual((await post(app, '/timo/minuteur', { action: 'pause' })).json(), { enfant: 'timo', minuteur: { etat: 'pause' }, disponibles_s: 720 });
  assert.equal((await post(app, '/pablo/etapes/chaussures', {})).json().statut, 'valide');
  assert.deepEqual(readdirSync(join(dossier, 'journees')), ['2026-10-14.json'], 'aucun fichier caché restant');
  const fichier = lireJson(dossier, 'journees/2026-10-14.json');
  assert.deepEqual(Object.keys(fichier.enfants.timo.etapes).sort(), ['calme', 'dents', 'leve']);
  assert.deepEqual([fichier.enfants.timo.gagnees, fichier.enfants.timo.utilisees_s, fichier.enfants.timo.minuteur], [17, 300, { etat: 'pause' }]);
  assert.deepEqual(fichier.enfants.pablo, {
    etapes: {
      chaussures: {
        statut: 'valide', par: 'enfant', coche_le: '2026-10-14T05:05:00.000Z', valide_le: '2026-10-14T05:05:00.000Z', valeur: 1,
      },
    },
    gagnees: 1,
  });
  assert.doesNotMatch(readFileSync(join(dossier, 'journees/2026-10-14.json'), 'utf8'), /Timo|Pablo|Cartable/, 'ni prénom ni libellé dans le fichier');
});

test('variante « parent » du barème par HTTP : « Levé » coché par Timo en attente, rien ne compte, puis validé par un parent', async (t) => {
  const { app, enfants } = await preparer(t, '2026-10-14T07:00:00+02:00', { bareme: BAREME_PARENT });
  assert.equal((await post(app, '/timo/etapes/leve', {})).json().statut, 'attente');
  assert.equal(enfants.valeur.enfants[0].gagnees, 0);
  const valide = await post(app, '/timo/etapes/leve/decision', { decision: 'valider' }, enParent(await jeton(app)));
  assert.deepEqual(valide.json(), { enfant: 'timo', etape: 'leve', statut: 'valide' });
  assert.equal(enfants.valeur.enfants[0].gagnees, 10);
});

test('annuler par la route : dans les 5 s (200), après (409) ; étape pas cochée 404', async (t) => {
  const { app, horloge } = await preparer(t, '2026-10-14T07:00:00+02:00');
  await post(app, '/timo/etapes/habille', {});
  horloge.ms += 3_000;
  assert.deepEqual((await post(app, '/timo/etapes/habille/annuler', {})).json(), { enfant: 'timo', etape: 'habille', statut: 'a_faire' });
  await post(app, '/timo/etapes/habille', {});
  horloge.ms += 7_000;
  assert.deepEqual((await post(app, '/timo/etapes/habille/annuler', {})).json(), { erreur: 'trop_tard' });
  assert.deepEqual((await post(app, '/timo/etapes/dents/annuler', {})).json(), { erreur: 'pas_cochee' });
});

test('correction par un parent : annuler sans délai avec le jeton, 403 avec un jeton faux (jamais une annulation d\'enfant silencieuse)', async (t) => {
  const { app, horloge, enfants } = await preparer(t, '2026-10-14T07:00:00+02:00');
  await post(app, '/timo/etapes/habille', {});
  horloge.ms += 600_000;
  const faux = await post(app, '/timo/etapes/habille/annuler', {}, enParent('faux'));
  assert.deepEqual([faux.statusCode, faux.json()], [403, { erreur: 'mode_parent_requis' }]);
  const corrige = await post(app, '/timo/etapes/habille/annuler', {}, enParent(await jeton(app)));
  assert.deepEqual([corrige.statusCode, corrige.json()], [200, { enfant: 'timo', etape: 'habille', statut: 'a_faire' }]);
  assert.deepEqual([enfants.valeur.enfants[0].gagnees, enfants.valeur.enfants[0].etapes[3].statut], [0, 'a_faire']);
});

test('flux : avatar de chaque enfant, et les 5 derniers gains de points de Timo (motif ou null), du plus récent', async (t) => {
  const { app, enfants } = await preparer(t, '2026-10-14T17:00:00+02:00');
  const cle = await jeton(app);
  for (const motif of ['range', 'table', null, 'aide', 'range', 'table']) await post(app, '/timo/points', { motif }, enParent(cle));
  const [timo, pablo] = enfants.valeur.enfants;
  assert.deepEqual([timo.avatar, pablo.avatar], ['i-renard', 'i-ourson']);
  assert.deepEqual(timo.gains.map(({ motif }) => motif), ['table', 'range', 'aide', null, 'table']);
  assert.equal(pablo.gains, null);
});

test('points et boutique par les routes : +1 en mode parent, échange refusé sans assez de points, validé par un parent', async (t) => {
  const dossier = nouveauDossier(t);
  const gains = Array.from({ length: 29 }, (_, i) => ({
    enfant: 'timo', type: 'gain', points: 1, motif: null, le: `2026-10-${String(1 + (i % 13)).padStart(2, '0')}T15:00:00.000Z`, journee: `2026-10-${String(1 + (i % 13)).padStart(2, '0')}`,
  }));
  deposer(dossier, 'registre.json', {
    version: 1, reports: { timo: 0 }, mouvements: gains, demandes: [],
  });
  const { app, enfants } = await preparer(t, '2026-10-14T17:00:00+02:00', { dossier });
  assert.deepEqual(enfants.valeur.enfants[0].points, { solde: 29, aujourdhui: 0, libres_restants: 10 });
  assert.deepEqual((await post(app, '/timo/echanges', { cadeau: 'petit' })).json(), { erreur: 'points_insuffisants' });
  const point = await post(app, '/timo/points', { motif: 'range' }, enParent(await jeton(app)));
  assert.deepEqual(point.json(), { enfant: 'timo', solde: 30, aujourdhui: 1 });
  const demande = (await post(app, '/timo/echanges', { cadeau: 'petit' })).json();
  assert.match(demande.demande.id, /^[0-9a-f]{8}$/);
  assert.deepEqual(enfants.valeur.enfants[0].demande, {
    id: demande.demande.id, cadeau: 'petit', prix: 30, le: '2026-10-14T15:00:00.000Z',
  });
  const decision = await post(app, `/timo/echanges/${demande.demande.id}/decision`, { decision: 'valider' }, enParent(await jeton(app)));
  assert.deepEqual(decision.json(), {
    enfant: 'timo', demande: demande.demande.id, decision: 'valider', solde: 0,
  });
  assert.deepEqual([enfants.valeur.enfants[0].points, enfants.valeur.enfants[0].demande], [{ solde: 0, aujourdhui: 1, libres_restants: 10 }, null]);
  assert.deepEqual((await post(app, '/pablo/points', {}, enParent(await jeton(app)))).json(), { erreur: 'sans_points' });
  assert.equal(lireJson(dossier, 'registre.json').mouvements.at(-1).type, 'echange');
});

test('point libre par la route, SANS jeton : +1 (motif vide, marqué « libre »), plafond de 10 par journée, puis bouton grisé ; un parent donne encore', async (t) => {
  const { app, enfants, dossier, horloge } = await preparer(t, '2026-10-14T17:00:00+02:00');
  const reponse = await post(app, '/timo/points/libre', undefined);
  assert.deepEqual([reponse.statusCode, reponse.headers['cache-control'], reponse.json()], [200, 'no-store', {
    enfant: 'timo', solde: 1, aujourdhui: 1, libres_restants: 9, annulable_jusqu_a: '2026-10-14T15:00:05.000Z',
  }]);
  assert.deepEqual(enfants.valeur.enfants[0].points, { solde: 1, aujourdhui: 1, libres_restants: 9 });
  assert.deepEqual(enfants.valeur.enfants[0].gains, [{ motif: null, le: '2026-10-14T15:00:00.000Z' }], '« Bravo ! +1 » dans la liste');
  for (let i = 0; i < 9; i += 1) {
    horloge.ms += 1_000;
    assert.equal((await post(app, '/timo/points/libre', {})).statusCode, 200);
  }
  assert.equal(enfants.valeur.enfants[0].points.libres_restants, 0, 'la page grise le bouton');
  const plafond = await post(app, '/timo/points/libre', {});
  assert.deepEqual([plafond.statusCode, plafond.json()], [409, { erreur: 'plafond_libre' }]);
  assert.equal((await post(app, '/timo/points', { motif: 'range' }, enParent(await jeton(app)))).json().solde, 11, 'les points d\'un parent (avec motif) restent possibles');
  const fichier = lireJson(dossier, 'registre.json');
  assert.deepEqual([fichier.mouvements.filter((m) => m.libre === true).length, fichier.mouvements.at(-1).libre], [10, undefined]);
  assert.deepEqual((await post(app, '/pablo/points/libre', {})).json(), { erreur: 'sans_points' });
  assert.deepEqual((await post(app, '/timo/points/libre', { points: 5 })).json().erreur, 'corps_invalide');
  horloge.ms = Date.parse('2026-10-15T04:00:00+02:00');
  assert.equal((await post(app, '/timo/points/libre', {})).json().libres_restants, 9, 'nouvelle journée à 4 h : le plafond repart');
});

test('point libre au plafond de 20 gains de la journée : le flux et la réponse disent 0 (bouton grisé), puis 409 plafond_jour', async (t) => {
  const dossier = nouveauDossier(t);
  const gains = Array.from({ length: 12 }, (_, i) => ({
    enfant: 'timo', type: 'gain', points: 1, motif: 'aide', le: `2026-10-14T1${String(i % 10)}:00:00.000Z`, journee: '2026-10-14',
  }));
  deposer(dossier, 'registre.json', {
    version: 1, reports: { timo: 0 }, mouvements: gains, demandes: [],
  });
  const { app, enfants, horloge } = await preparer(t, '2026-10-14T17:00:00+02:00', { dossier });
  assert.deepEqual(enfants.valeur.enfants[0].points, { solde: 12, aujourdhui: 12, libres_restants: 8 }, '20 gains au plus');
  let reponse;
  for (let i = 0; i < 8; i += 1) {
    horloge.ms += 1_000;
    reponse = await post(app, '/timo/points/libre', {});
  }
  assert.equal(reponse.json().libres_restants, 0);
  assert.deepEqual(enfants.valeur.enfants[0].points, { solde: 20, aujourdhui: 20, libres_restants: 0 }, 'la page grise le bouton');
  const refus = await post(app, '/timo/points/libre', {});
  assert.deepEqual([refus.statusCode, refus.json()], [409, { erreur: 'plafond_jour' }]);
});

test('annuler un point libre par la route, sans jeton : le dernier seulement, dans les 10 s, jamais deux fois', async (t) => {
  const { app, enfants, horloge } = await preparer(t, '2026-10-14T17:00:00+02:00');
  await post(app, '/timo/points/libre', {});
  horloge.ms += 2_000;
  await post(app, '/timo/points/libre', {});
  horloge.ms += 10_000;
  const annule = await post(app, '/timo/points/libre/annuler', undefined);
  assert.deepEqual([annule.statusCode, annule.json()], [200, {
    enfant: 'timo', solde: 1, aujourdhui: 1, libres_restants: 9,
  }], '10 s pile après le second point');
  const encore = await post(app, '/timo/points/libre/annuler', {});
  assert.deepEqual([encore.statusCode, encore.json()], [409, { erreur: 'rien_a_annuler' }], 'jamais deux fois : le premier point reste');
  await post(app, '/timo/points/libre', {});
  horloge.ms += 10_001;
  assert.deepEqual((await post(app, '/timo/points/libre/annuler', {})).json(), { erreur: 'trop_tard' });
  assert.equal(enfants.valeur.enfants[0].points.solde, 2);
});

test('−1 en mode parent : jeton exigé, retire le dernier gain, solde jamais négatif, échange de la boutique intact', async (t) => {
  const dossier = nouveauDossier(t);
  const gains = Array.from({ length: 30 }, (_, i) => ({
    enfant: 'timo', type: 'gain', points: 1, motif: null, le: `2026-10-${String(1 + (i % 13)).padStart(2, '0')}T15:00:00.000Z`, journee: `2026-10-${String(1 + (i % 13)).padStart(2, '0')}`,
  }));
  deposer(dossier, 'registre.json', {
    version: 1, reports: { timo: 0 }, mouvements: gains, demandes: [],
  });
  const { app, enfants } = await preparer(t, '2026-10-14T17:00:00+02:00', { dossier });
  const sans = await post(app, '/timo/points/retirer', {});
  assert.deepEqual([sans.statusCode, sans.json()], [403, { erreur: 'mode_parent_requis' }]);
  const cle = await jeton(app);
  await post(app, '/timo/points', { motif: 'aide' }, enParent(cle));
  const retire = await post(app, '/timo/points/retirer', undefined, enParent(cle));
  assert.deepEqual([retire.statusCode, retire.json()], [200, {
    enfant: 'timo', solde: 30, aujourdhui: 0, libres_restants: 10,
  }]);
  const demande = (await post(app, '/timo/echanges', { cadeau: 'petit' })).json().demande;
  await post(app, `/timo/echanges/${demande.id}/decision`, { decision: 'valider' }, enParent(cle));
  const refus = await post(app, '/timo/points/retirer', {}, enParent(cle));
  assert.deepEqual([refus.statusCode, refus.json()], [409, { erreur: 'points_depenses' }], 'à 0 : jamais sous zéro');
  assert.equal(enfants.valeur.enfants[0].points.solde, 0);
  const fichier = lireJson(dossier, 'registre.json');
  assert.deepEqual([fichier.mouvements.length, fichier.mouvements.at(-1)], [31, {
    enfant: 'timo', type: 'echange', points: 30, cadeau: 'petit', le: '2026-10-14T15:00:00.000Z', journee: '2026-10-14',
  }], 'l\'échange reste dans le registre');
  assert.deepEqual((await post(app, '/pablo/points/retirer', {}, enParent(cle))).json(), { erreur: 'sans_points' });
});

test('registre avec un point libre abîmé (« libre » qui ne vaut pas vrai) : mis de côté avant le +1 suivant, comme tout registre non conforme', async (t) => {
  const dossier = nouveauDossier(t);
  const original = JSON.stringify({
    version: 1,
    reports: { timo: 3 },
    mouvements: [{
      enfant: 'timo', type: 'gain', points: 1, motif: null, libre: false, le: '2026-10-13T16:00:00.000Z', journee: '2026-10-13',
    }],
    demandes: [],
    annulations: { timo: '2026-10-13T16:00:05.000Z' },
  });
  deposer(dossier, 'registre.json', original);
  const { app } = await preparer(t, '2026-10-14T18:00:00+02:00', { dossier });
  assert.equal((await post(app, '/timo/points/libre', {})).json().solde, 1, 'reparti de zéro');
  const copies = readdirSync(dossier).filter((f) => f.startsWith('registre.json.abime-'));
  assert.equal(copies.length, 1);
  assert.equal(readFileSync(join(dossier, copies[0]), 'utf8'), original, 'récupérable à la main');
});

test('entrées invalides : enfant, étape ou demande inconnus 404, corps faux 400, trop gros 413, JSON mal formé 400 ; rien d\'écrit', async (t) => {
  const { app, dossier } = await preparer(t, '2026-10-14T07:00:00+02:00');
  const parent = enParent(await jeton(app));
  const cas = [
    ['/lea/etapes/dents', {}, CADRE, 404, 'enfant_inconnu'],
    ['/timo/etapes/vaisselle', {}, CADRE, 404, 'etape_inconnue'],
    ['/timo/etapes/dents', { minutes: 30 }, CADRE, 400, 'corps_invalide'],
    ['/timo/etapes/dents', { date: '2026-10-01' }, CADRE, 400, 'corps_invalide'],
    ['/timo/etapes/leve/decision', { decision: 'peut-etre' }, parent, 400, 'corps_invalide'],
    ['/timo/points', { motif: 'Table' }, parent, 400, 'corps_invalide'],
    ['/timo/points', { motif: 'table', points: 50 }, parent, 400, 'corps_invalide'],
    ['/timo/points', { motif: 'sage' }, parent, 400, 'motif_inconnu'],
    ['/timo/echanges', {}, CADRE, 400, 'corps_invalide'],
    ['/timo/echanges', { cadeau: 'licorne' }, CADRE, 400, 'cadeau_inconnu'],
    ['/timo/echanges/00000000/decision', { decision: 'valider' }, parent, 404, 'demande_inconnue'],
    ['/timo/minuteur', { action: 'avancer' }, CADRE, 400, 'corps_invalide'],
    ['/timo/minuteur', { action: 'demarrer', duree_s: 3600 }, CADRE, 400, 'corps_invalide'],
    ['/pablo/minuteur', { action: 'demarrer' }, CADRE, 404, 'sans_minutes'],
  ];
  for (const [chemin, corps, entetes, statut, erreur] of cas) {
    const reponse = await post(app, chemin, corps, entetes);
    assert.deepEqual([reponse.statusCode, reponse.json().erreur], [statut, erreur], `${chemin} ${JSON.stringify(corps)}`);
  }
  const gros = await post(app, '/timo/echanges', { cadeau: 'x'.repeat(300) });
  assert.equal(gros.statusCode, 413);
  const malForme = await app.inject({
    method: 'POST', url: '/api/enfants/timo/minuteur', headers: CADRE, payload: '{ action',
  });
  assert.equal(malForme.statusCode, 400);
  assert.equal(existsSync(dossier), false, 'dossier jamais créé : rien d\'écrit');
});

test('limites : 60 touchers par minute pour toutes les routes des enfants (compteur partagé), 10 jetons parent par minute', async (t) => {
  const { app } = await preparer(t, '2026-10-14T07:00:00+02:00');
  for (let i = 0; i < 10; i += 1) assert.equal((await post(app, '/parent', {})).statusCode, 200);
  assert.equal((await post(app, '/parent', {})).statusCode, 429);
  const routes = ['/timo/etapes/dents', '/timo/minuteur', '/pablo/etapes/dents/annuler'];
  for (let i = 0; i < 60; i += 1) {
    const reponse = await post(app, routes[i % 3], routes[i % 3].endsWith('minuteur') ? { action: 'pause' } : {});
    assert.notEqual(reponse.statusCode, 429, `toucher ${i + 1}`);
  }
  assert.equal((await post(app, '/timo/etapes/habille', {})).statusCode, 429);
});

test('fichiers relus au démarrage ; abîmés, non conformes, trop gros ou d\'une autre journée : mis de côté (jamais écrasés), on repart de zéro', async (t) => {
  const dossier = nouveauDossier(t);
  const etape = {
    statut: 'valide', par: 'enfant', coche_le: '2026-10-14T05:00:00.000Z', valide_le: '2026-10-14T05:00:00.000Z', valeur: 3,
  };
  const bonneJournee = {
    version: 1, journee: '2026-10-14', enfants: { timo: { etapes: { dents: etape }, gagnees: 3, utilisees_s: 0, minuteur: null }, pablo: { etapes: {}, gagnees: 0 } },
  };
  const lire = async () => {
    const journal = journalCapture();
    const source = new SourceEnfants({
      dossier, bareme: BAREME, journal, maintenant: () => Date.parse('2026-10-14T07:00:00+02:00'),
    });
    await source.actualiser();
    return { source, timo: source.valeur.enfants[0], journal: journal.lignes.join('\n') };
  };
  const misDeCote = (sousDossier, nom) => readdirSync(join(dossier, sousDossier)).filter((f) => f.startsWith(`${nom}.abime-`));
  deposer(dossier, 'journees/2026-10-14.json', bonneJournee);
  assert.equal((await lire()).timo.gagnees, 3, 'journée relue');
  const abimes = [
    '{ abîmé',
    JSON.stringify({ ...bonneJournee, journee: '2026-10-13' }),
    JSON.stringify({ ...bonneJournee, enfants: { timo: { ...bonneJournee.enfants.timo, gagnees: 9999 } } }),
    JSON.stringify({ ...bonneJournee, enfants: { timo: { ...bonneJournee.enfants.timo, etapes: { dents: { ...etape, statut: 'presque' } } } } }),
    JSON.stringify({ ...bonneJournee, enfants: { timo: { etapes: {}, gagnees: 0, utilisees_s: 0 } } }),
    'x'.repeat(TAILLE_MAX_ETAT + 1),
  ];
  for (const abime of abimes) {
    rmSync(join(dossier, 'journees'), { recursive: true, force: true });
    deposer(dossier, 'journees/2026-10-14.json', abime);
    const { timo, journal } = await lire();
    assert.equal(timo.gagnees, 0, abime.slice(0, 60));
    assert.match(journal, /2026-10-14\.json abîmé \(.+\) : mis de côté sous 2026-10-14\.json\.abime-\d{8}-\d{6}/);
    const copies = misDeCote('journees', '2026-10-14.json');
    assert.equal(copies.length, 1, abime.slice(0, 60));
    assert.equal(readFileSync(join(dossier, 'journees', copies[0]), 'utf8'), abime, 'contenu d\'origine gardé');
  }
  deposer(dossier, 'registre.json', 'x'.repeat(TAILLE_MAX_REGISTRE + 1));
  const { timo, journal } = await lire();
  assert.deepEqual(timo.points, { solde: 0, aujourdhui: 0, libres_restants: 10 });
  assert.match(journal, /registre\.json abîmé \(262145 octets, plus de 262144\) : mis de côté/);
  assert.equal(misDeCote('.', 'registre.json').length, 1);
});

test('registre des points non conforme (un champ en trop) : mis de côté AVANT le +1 suivant, les 45 points d\'origine restent sur le disque', async (t) => {
  const dossier = nouveauDossier(t);
  const mouvements = Array.from({ length: 45 }, (_, i) => ({
    enfant: 'timo', type: 'gain', points: 1, motif: null, le: `2026-10-${String(1 + (i % 13)).padStart(2, '0')}T16:00:00.000Z`, journee: `2026-10-${String(1 + (i % 13)).padStart(2, '0')}`,
  }));
  mouvements[7].note = 'corrigé à la main';
  const original = JSON.stringify({ version: 1, reports: { timo: 0 }, mouvements, demandes: [] });
  deposer(dossier, 'registre.json', original);
  const { app } = await preparer(t, '2026-10-14T18:00:00+02:00', { dossier });
  const reponse = await post(app, '/timo/points', {}, enParent(await jeton(app)));
  assert.deepEqual([reponse.statusCode, reponse.json().solde], [200, 1]);
  const copies = readdirSync(dossier).filter((f) => f.startsWith('registre.json.abime-'));
  assert.equal(copies.length, 1);
  assert.equal(readFileSync(join(dossier, copies[0]), 'utf8'), original, 'les 45 points sont récupérables');
  assert.equal(lireJson(dossier, 'registre.json').mouvements.length, 1);
});

test('registre illisible pour une raison d\'accès (droits) : rien n\'est remis à zéro ni écrasé, l\'action échoue, la suivante relit', async (t) => {
  const dossier = nouveauDossier(t);
  const original = JSON.stringify({
    version: 1, reports: { timo: 12 }, mouvements: [], demandes: [],
  });
  deposer(dossier, 'registre.json', original);
  chmodSync(join(dossier, 'registre.json'), 0o000);
  const journal = journalCapture();
  const source = new SourceEnfants({
    dossier, bareme: BAREME, journal, maintenant: () => Date.parse('2026-10-14T18:00:00+02:00'),
  });
  await source.actualiser();
  assert.equal(source.valeur, null, 'aucune valeur inventée');
  await assert.rejects(source.donnerPoint('timo', null), (err) => err.code === 'EACCES');
  chmodSync(join(dossier, 'registre.json'), 0o600);
  assert.equal(readFileSync(join(dossier, 'registre.json'), 'utf8'), original, 'fichier intact');
  assert.equal((await source.donnerPoint('timo', null)).solde, 13, 'relu après réparation : 12 + 1');
  assert.equal(readdirSync(dossier).filter((f) => f.includes('.abime-')).length, 0);
});

test('purge douce à la bascule de journée : journées de plus de 90 jours retirées, points repliés sans changer le solde', async (t) => {
  const dossier = nouveauDossier(t);
  const vide = (journee) => ({ version: 1, journee, enfants: { timo: { etapes: {}, gagnees: 0, utilisees_s: 0, minuteur: null }, pablo: { etapes: {}, gagnees: 0 } } });
  for (const journee of ['2026-07-15', '2026-07-16', '2026-07-17', '2026-10-13']) deposer(dossier, `journees/${journee}.json`, vide(journee));
  deposer(dossier, 'journees/notes.txt', 'à garder');
  deposer(dossier, 'registre.json', {
    version: 1,
    reports: { timo: 5 },
    mouvements: [
      {
        enfant: 'timo', type: 'gain', points: 1, motif: null, le: '2026-07-16T15:00:00.000Z', journee: '2026-07-16',
      },
      {
        enfant: 'timo', type: 'gain', points: 1, motif: 'aide', le: '2026-10-13T15:00:00.000Z', journee: '2026-10-13',
      },
    ],
    demandes: [],
  });
  const { enfants, horloge } = await preparer(t, '2026-10-14T07:00:00+02:00', { dossier });
  assert.deepEqual(readdirSync(join(dossier, 'journees')).sort(), ['2026-07-17.json', '2026-10-13.json', 'notes.txt'], 'avant le 17/07 retiré, le reste gardé');
  const registre = lireJson(dossier, 'registre.json');
  assert.deepEqual([registre.reports, registre.mouvements.length, enfants.valeur.enfants[0].points.solde], [{ timo: 6 }, 1, 7]);
  horloge.ms = Date.parse('2026-10-15T04:00:00+02:00');
  await enfants.actualiser();
  assert.equal(enfants.valeur.journee, '2026-10-15');
  assert.ok(!readdirSync(join(dossier, 'journees')).includes('2026-07-17.json'), 'la purge repasse à la journée suivante');
});

test('historique de 7 jours (mode parent) : faites, minutes gagnées et utilisées, points par journée ; minuteur resté en cours compté fini', async (t) => {
  const dossier = nouveauDossier(t);
  const valide = (valeur) => ({
    statut: 'valide', par: 'enfant', coche_le: '2026-10-12T05:00:00.000Z', valide_le: '2026-10-12T05:00:00.000Z', valeur,
  });
  deposer(dossier, 'journees/2026-10-12.json', {
    version: 1,
    journee: '2026-10-12',
    enfants: {
      timo: {
        etapes: { dents: valide(3), habille: valide(5), leve: { ...valide(10), statut: 'attente', valide_le: null } },
        gagnees: 8,
        utilisees_s: 60,
        minuteur: { etat: 'en_cours', debut: '2026-10-12T16:00:00.000Z', duree_s: 120 },
      },
      pablo: { etapes: { dents: valide(1) }, gagnees: 1 },
    },
  });
  deposer(dossier, 'registre.json', {
    version: 1,
    reports: { timo: 0 },
    mouvements: [{
      enfant: 'timo', type: 'gain', points: 1, motif: 'table', le: '2026-10-12T17:00:00.000Z', journee: '2026-10-12',
    }],
    demandes: [],
  });
  const { app } = await preparer(t, '2026-10-14T07:00:00+02:00', { dossier });
  const reponse = await app.inject({ url: '/api/enfants/historique', headers: enParent(await jeton(app)) });
  assert.equal(reponse.statusCode, 200);
  const { jours, enfants } = reponse.json();
  assert.deepEqual(jours, ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
  assert.deepEqual(enfants.map(({
    id, type, total,
  }) => [id, type, total]), [['timo', 'minutes', 6], ['pablo', 'etoiles', 3]]);
  assert.deepEqual(enfants[0].jours[4], {
    journee: '2026-10-12', faites: 2, gagnees: 8, utilisees_s: 180, points: 1,
  });
  assert.deepEqual(enfants[0].jours[5], {
    journee: '2026-10-13', faites: 0, gagnees: 0, utilisees_s: 0, points: 0,
  });
  assert.deepEqual(enfants[1].jours[4], {
    journee: '2026-10-12', faites: 1, gagnees: 1, utilisees_s: null, points: null,
  });
});

test('flux : l\'instantané porte « enfants », chaque action pousse une maj complète', async (t) => {
  const { app } = await preparer(t, '2026-10-14T07:00:00+02:00');
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  const flux = await ouvrirFlux(`${adresse}/api/flux`, { 'x-cadre-cle': CLE });
  t.after(() => flux.fermer());
  const instantane = (await flux.lireEvenement()).donnees.enfants;
  assert.deepEqual([instantane.journee, instantane.depart, instantane.minutes_perdues], ['2026-10-14', '08:10', '20:00']);
  assert.deepEqual(instantane.enfants.map((enfant) => [enfant.id, enfant.gagnees]), [['timo', 0], ['pablo', 0]]);
  assert.deepEqual(instantane.boutique.map((cadeau) => cadeau.prix), [30, 60, 90]);
  assert.equal(instantane.motifs.length, 3);
  await post(app, '/timo/etapes/cartable', {});
  const maj = await flux.lireEvenement();
  assert.equal(maj.nom, 'maj');
  assert.deepEqual(Object.keys(maj.donnees), ['enfants']);
  assert.deepEqual([maj.donnees.enfants.enfants[0].gagnees, maj.donnees.enfants.enfants[0].etapes[4].statut], [5, 'valide']);
});

test('minuteur : fini tout seul et minutes perdues à 20 h, poussés dans le flux sans aucune action', async (t) => {
  const dossier = nouveauDossier(t);
  const { app, enfants } = await preparer(t, '2026-10-14T19:59:58.000+02:00', { dossier, reel: true });
  enfants.demarrer();
  assert.equal((await post(app, '/timo/etapes/dents', {}, enParent(await jeton(app)))).json().statut, 'valide', 'coché par un parent après 10 h 30');
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  const flux = await ouvrirFlux(`${adresse}/api/flux`, { 'x-cadre-cle': CLE });
  t.after(() => flux.fermer());
  await flux.lireEvenement();
  const demarre = (await post(app, '/timo/minuteur', { action: 'demarrer' })).json();
  assert.ok(demarre.minuteur.duree_s >= 1 && demarre.minuteur.duree_s <= 2, `borné à 20 h : ${demarre.minuteur.duree_s} s`);
  assert.equal((await flux.lireEvenement()).donnees.enfants.enfants[0].minuteur.etat, 'en_cours');
  const fin = (await flux.lireEvenement()).donnees.enfants.enfants[0];
  assert.deepEqual([fin.minuteur.etat, fin.minutes.utilisees_s, fin.minutes.perdues], ['termine', demarre.minuteur.duree_s, false]);
  const soir = (await flux.lireEvenement()).donnees.enfants.enfants[0];
  assert.deepEqual([soir.minutes.perdues, soir.minutes.disponibles_s], [true, 0]);
  assert.equal(lireJson(dossier, 'journees/2026-10-14.json').enfants.timo.minuteur.etat, 'termine', 'fin écrite dans le fichier');
});
