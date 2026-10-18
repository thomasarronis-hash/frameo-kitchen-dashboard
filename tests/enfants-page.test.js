// tests/enfants-page.test.js
//
// Rôle    : prouver les règles des écrans des enfants côté page, sans DOM (partie 4 des choix de Thomas du 14/10) : visages
//           et case du matin de l'Accueil (5 h à 10 h 30, étoile seulement quand la routine est finie), pastille et fin du
//           minuteur d'écran, chemin de la quête de Timo (cases, avatar, coffre, « 6 h 30 », barre du temps, annulation),
//           bourse et minuteur (modes, décompte, minutes perdues), points et boutique, « +1 » libre (grisé au plafond, retour
//           de 5 s), « D'abord, ensuite » de Pablo, mode parent côté page (session de 60 s, envois avec ou sans jeton, −1,
//           vue, historique d'un seul enfant), sons doux,
//           géométrie du chemin et secteur du disque, et les règles de pilotage (90 s, mode Photos, rechargement).
// Entrées : valeurs enfants au format du flux (tests/enfants-valeur.js) ; faux client et faux contexte audio.
// Sorties : node --test.
// Pièges  : heures construites avec leur décalage (+02:00, Paris en octobre avant le 25). ESP est l'espace insécable.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vueBoutique, vuePlusUn } from '../web/src/ecrans/boutique-donnees.js';
import { secteur } from '../web/src/ecrans/enfants-bourse.js';
import {
  caseAccueil, creerVeilleFin, minuteurEcranEnCours, restantMinuteurS, routineFinie, texteMinutes, vueEntree, vuePastilleEcran,
} from '../web/src/ecrans/enfants-donnees.js';
import { positions, trace } from '../web/src/ecrans/enfants-quete.js';
import { vuePablo } from '../web/src/ecrans/pablo-donnees.js';
import { creerEnvois, creerSessionParent, vueParent } from '../web/src/ecrans/parent-donnees.js';
import { FIN_MONTREE_MS, vueBourse, vueQuete } from '../web/src/ecrans/quete-donnees.js';
import {
  apresInactivite, decisionPhotos, DELAI_ENFANTS_MS, enfantsRetenu, rechargementVersionBloque,
} from '../web/src/pilotage.js';
import { creerSonsEnfants, SONS, VOLUME_MAX } from '../web/src/sons-enfants.js';
import {
  ETAPES_PABLO, ETAPES_TIMO, iso, paris, valeurEnfants,
} from './enfants-valeur.js';

const ESP = '\u00a0';

const tout = (liste, statut = 'valide') => Object.fromEntries(liste.map(([id]) => [id, statut]));
const timo = (valeur) => valeur.enfants[0];
const pablo = (valeur) => valeur.enfants[1];
const quete = (valeur, ms) => vueQuete(timo(valeur), valeur, ms);
const vueDePablo = (valeur, ms) => vuePablo(pablo(valeur), valeur, ms);

test('case du matin de l\'Accueil : de 5 h à 10 h 29, les deux visages ; l\'étoile seulement quand TOUTE la routine est validée', () => {
  const valeur = valeurEnfants({ pablo: tout(ETAPES_PABLO) });
  assert.equal(caseAccueil(valeur, paris('04:59')), null);
  assert.deepEqual(caseAccueil(valeur, paris('05:00')).visages, [
    {
      id: 'timo', prenom: 'Timo', avatar: 'i-renard', couleur: 'enfant-timo', fini: false,
    },
    {
      id: 'pablo', prenom: 'Pablo', avatar: 'i-ourson', couleur: 'enfant-pablo', fini: true,
    },
  ]);
  assert.ok(caseAccueil(valeur, paris('10:29')));
  assert.equal(caseAccueil(valeur, paris('10:30')), null);
  assert.equal(caseAccueil(null, paris('07:00')), null, 'pas de case avant le premier instantané');
  const presque = valeurEnfants({ timo: { ...tout(ETAPES_TIMO), calme: 'attente' } });
  assert.equal(routineFinie(timo(presque)), false, 'une étape en attente d\'un parent ne compte pas');
  assert.equal(routineFinie(timo(valeurEnfants({ timo: tout(ETAPES_TIMO) }))), true);
  assert.deepEqual(vueEntree(null), { etat: 'attente', visages: [] });
  assert.equal(vueEntree(valeur).visages.length, 2);
});

test('minuteur d\'écran : restant arrondi à la seconde du dessus, minutes à la Time Timer, pastille seulement pendant qu\'il tourne', () => {
  const fin = paris('17:12');
  const minuteur = {
    etat: 'en_cours', debut: iso(paris('17:00')), duree_s: 720, fin: iso(fin),
  };
  assert.equal(restantMinuteurS(minuteur, fin - 130_500), 131);
  assert.deepEqual(texteMinutes(130), { nombre: '3', unite: 'min' });
  assert.deepEqual(texteMinutes(60), { nombre: '1', unite: 'min' });
  assert.deepEqual(texteMinutes(45), { nombre: '45', unite: 's' });
  assert.equal(restantMinuteurS(minuteur, fin + 5000), 0, 'jamais négatif');
  const valeur = valeurEnfants({ timo: { dents: 'valide' }, minuteur });
  assert.deepEqual(vuePastilleEcran(valeur, fin - 600_000), {
    id: 'timo', prenom: 'Timo', avatar: 'i-renard', couleur: 'enfant-timo', nombre: '10', unite: 'min',
  });
  assert.equal(vuePastilleEcran(valeur, fin), null, 'fini : plus de pastille');
  assert.equal(vuePastilleEcran(valeurEnfants({ minuteur: { etat: 'pause' } }), fin), null);
  assert.deepEqual([minuteurEcranEnCours(valeur, fin - 1000), minuteurEcranEnCours(valeur, fin), minuteurEcranEnCours(null, fin)], [true, false, false]);
});

test('fin du minuteur : repérée dès que l\'heure passe la fin (avant la maj du serveur), une fois par fin, 2 min au plus ; son seulement si elle est fraîche', () => {
  const fin = paris('17:12');
  const enCours = valeurEnfants({
    minuteur: {
      etat: 'en_cours', debut: iso(paris('17:00')), duree_s: 720, fin: iso(fin),
    },
  });
  const veille = creerVeilleFin();
  assert.equal(veille.observer(enCours, fin - 1000), null);
  const vue = veille.observer(enCours, fin + 2000);
  assert.deepEqual([vue.id, vue.prenom, vue.sonner, vue.cle], ['timo', 'Timo', true, `timo@${fin}`]);
  const termine = valeurEnfants({ minuteur: { etat: 'termine', fin_le: iso(fin) } });
  assert.equal(veille.observer(termine, fin + 3000).cle, vue.cle, 'la maj « termine » du serveur garde la même clé');
  assert.equal(veille.observer(termine, fin + 45_000).sonner, false, 'relue après 30 s : sans son');
  veille.fermer(vue.cle);
  assert.equal(veille.observer(termine, fin + 50_000), null, 'fermée : ne revient pas');
  assert.equal(creerVeilleFin().observer(termine, fin + 121_000), null, 'au-delà de 2 min : rien');
  assert.equal(creerVeilleFin().observer(valeurEnfants({ minuteur: null }), fin), null, '« Fini » touché avant la fin : aucun message');
});

test('quête : une case par étape (pictogramme, « +5 », cadenas des étapes parent d\'une variante du barème), avatar sur la première à faire, coffre fermé', () => {
  assert.deepEqual(quete(valeurEnfants(), paris('07:20')).cases.filter((c) => c.parent), [], 'barème de Thomas : tout en confiance, aucun cadenas');
  const parent = ['leve', 'calme'];
  const vue = quete(valeurEnfants({ timo: { dejeuner: 'valide', leve: 'attente' }, parent }), paris('07:20'));
  assert.deepEqual(vue.cases.map((c) => [c.id, c.valeur, c.statut, c.parent]), [
    ['leve', '+10', 'attente', true], ['dejeuner', '+5', 'valide', false], ['dents', '+3', 'a_faire', false],
    ['habille', '+5', 'a_faire', false], ['cartable', '+5', 'a_faire', false], ['calme', '+4', 'a_faire', true],
  ]);
  assert.deepEqual([vue.avatar, vue.cases[2].enCours, vue.coffre.ouvert], [2, true, false]);
  const restePending = quete(valeurEnfants({ timo: { ...tout(ETAPES_TIMO), leve: 'attente', calme: 'attente' }, parent }), paris('07:20'));
  assert.deepEqual([restePending.avatar, restePending.coffre.ouvert, restePending.cases.filter((c) => c.enCours).length], [6, false, 0],
    'il ne reste que des étapes en attente d\'un parent : devant le coffre fermé, jamais de retour sur Levé');
  const fini = quete(valeurEnfants({ timo: tout(ETAPES_TIMO) }), paris('07:20'));
  assert.deepEqual([fini.avatar, fini.coffre.ouvert, fini.temps], [6, true, null], 'tout validé : sur le coffre, ouvert, plus de barre');
});

test('quête : « Levé » pas avant 6 h 30 (la case le dit), barre sauge de 6 h 30 au départ, annulation de la dernière coche pendant 5 s', () => {
  const valeur = valeurEnfants();
  assert.equal(quete(valeur, paris('06:29')).cases[0].tot, `6${ESP}h${ESP}30`);
  assert.equal(quete(valeur, paris('06:30')).cases[0].tot, null);
  assert.equal(quete(valeur, paris('06:29')).temps, null, 'avant 6 h 30 : pas de barre');
  assert.deepEqual(quete(valeur, paris('07:20')).temps, { fraction: 0.5, heure: `8${ESP}h${ESP}10` });
  assert.equal(quete(valeur, paris('08:10')).temps, null, 'au départ : plus de barre');
  const coche = paris('07:20');
  const avecCoches = valeurEnfants({ timo: { dents: ['valide', coche - 2000], dejeuner: ['valide', coche - 1000] } });
  assert.deepEqual(quete(avecCoches, coche).annulation, { id: 'dejeuner', picto: 'i-bol', jusqua: coche + 4000 });
  assert.equal(quete(avecCoches, coche + 4000).annulation, null, '5 s passées : rien à annuler');
});

test('quête : à la fin de la routine (10 h 30), les cases pas faites passent en gris (ni croix ni rouge), plus de « 6 h 30 », avatar devant le coffre', () => {
  const ouverte = quete(valeurEnfants({ timo: { dents: 'valide' } }), paris('10:29'));
  assert.deepEqual(ouverte.cases.map((c) => c.passee), [false, false, false, false, false, false]);
  const close = quete(valeurEnfants({ timo: { dents: 'valide', leve: 'attente' }, routineFinie: true }), paris('10:30'));
  assert.deepEqual(close.cases.map((c) => [c.id, c.statut, c.passee]), [
    ['leve', 'attente', false], ['dejeuner', 'a_faire', true], ['dents', 'valide', false],
    ['habille', 'a_faire', true], ['cartable', 'a_faire', true], ['calme', 'a_faire', true],
  ]);
  assert.deepEqual([close.avatar, close.coffre.ouvert, close.cases.filter((c) => c.enCours).length], [6, false, 0]);
  assert.equal(quete(valeurEnfants({ routineFinie: true }), paris('06:00')).cases[0].tot, null, 'routine close : plus d\'heure « 6 h 30 »');
  const pabloClos = vueDePablo(valeurEnfants({ pablo: { dents: 'valide' }, routineFinie: true }), paris('11:00'));
  assert.deepEqual(pabloClos.cases.map((c) => [c.fait, c.passee]), [[false, true], [true, false], [false, true]]);
});

test('annulation des 5 s : seulement une coche de l\'enfant ; une étape cochée par un parent n\'offre pas « Annuler » (le serveur refuserait)', () => {
  const coche = paris('07:20');
  const parParent = valeurEnfants({ timo: { leve: ['valide', coche, 'parent'] }, pablo: { dents: ['valide', coche, 'parent'] } });
  assert.equal(quete(parParent, coche + 1000).annulation, null);
  assert.equal(vueDePablo(parParent, coche + 1000).annulation, null);
  const parEnfant = valeurEnfants({ timo: { leve: ['valide', coche, 'parent'], dents: ['valide', coche - 500] } });
  assert.equal(quete(parEnfant, coche + 1000).annulation.id, 'dents');
});

test('bourse : ce qui reste à regarder en grand, « Je regarde » s\'il en reste, minuteur qui se vide, fin, pause, « À demain » après 20 h', () => {
  const ms = paris('17:00');
  const base = vueBourse(timo(valeurEnfants({ timo: { dents: 'valide', habille: 'valide' } })), ms);
  assert.deepEqual(base, {
    mode: 'bourse', nombre: '8', unite: 'min', gagnees: null, fraction: 1, peutRegarder: true,
  });
  assert.equal(vueBourse(timo(valeurEnfants()), ms).peutRegarder, false, '0 minute : pas de bouton');
  const regarde = vueBourse(timo(valeurEnfants({ timo: { dents: 'valide', habille: 'valide' }, minutes: { utilisees_s: 120, disponibles_s: 360 } })), ms);
  assert.deepEqual([regarde.nombre, regarde.gagnees, regarde.fraction], ['6', `8${ESP}gagnées`, 0.75]);
  const minuteur = {
    etat: 'en_cours', debut: iso(ms - 60_000), duree_s: 480, fin: iso(ms + 420_000),
  };
  const enCours = vueBourse(timo(valeurEnfants({ timo: { dents: 'valide', habille: 'valide' }, minuteur })), ms);
  assert.deepEqual([enCours.mode, enCours.nombre, enCours.unite, enCours.fraction, enCours.peutRegarder], ['minuteur', '7', 'min', 0.875, false]);
  assert.equal(vueBourse(timo(valeurEnfants({ timo: { dents: 'valide' }, minuteur })), ms + 420_000).mode, 'fin', 'fin passée avant la maj du serveur');
  const termine = valeurEnfants({ timo: { dents: 'valide' }, minuteur: { etat: 'termine', fin_le: iso(ms) }, minutes: { utilisees_s: 180, disponibles_s: 0 } });
  assert.equal(vueBourse(timo(termine), ms + FIN_MONTREE_MS - 1).mode, 'fin');
  assert.equal(vueBourse(timo(termine), ms + FIN_MONTREE_MS).mode, 'bourse');
  const pause = valeurEnfants({ timo: { dents: 'valide' }, minuteur: { etat: 'pause' }, minutes: { utilisees_s: 60, disponibles_s: 120 } });
  assert.deepEqual([vueBourse(timo(pause), ms).mode, vueBourse(timo(pause), ms).nombre], ['pause', '2']);
  const perdues = valeurEnfants({ timo: { dents: 'valide' }, minuteur: { etat: 'pause' }, minutes: { perdues: true, disponibles_s: 0 } });
  assert.deepEqual([vueBourse(timo(perdues), paris('20:01')).mode, vueBourse(timo(perdues), paris('20:01')).peutRegarder], ['perdues', false], 'minuteur en pause masqué après 20 h');
});

test('points et boutique : solde, derniers gains (motif ou « Bravo ! »), ce qu\'il manque, « Je veux ça » seulement s\'il a assez, la demande sur son cadeau', () => {
  const valeur = valeurEnfants({
    gains: [{ motif: 'table', le: iso(paris('17:00')) }, { motif: null, le: iso(paris('16:00')) }, { motif: 'inconnu', le: iso(paris('15:00')) }],
    demande: {
      id: 'ab12cd34', cadeau: 'petit', prix: 30, le: iso(paris('17:05')),
    },
  });
  const vue = vueBoutique(timo(valeur), valeur.boutique, valeur.motifs);
  assert.equal(vue.solde, 37);
  assert.deepEqual(vue.gains, [
    { picto: 'i-fork', texte: 'A mis la table', valeur: '+1' }, { picto: 'i-etoile', texte: `Bravo${ESP}!`, valeur: '+1' },
    { picto: 'i-etoile', texte: `Bravo${ESP}!`, valeur: '+1' },
  ]);
  assert.deepEqual(vue.cadeaux.map((c) => [c.id, c.taille, c.manque, c.possible, c.demande]), [
    ['petit', 1, null, true, true], ['moyen', 2, `encore${ESP}23`, false, false], ['gros', 3, `encore${ESP}53`, false, false],
  ]);
  assert.equal(vue.cadeaux[1].fraction, 37 / 60);
  const pile = vueBoutique(timo(valeurEnfants({ points: { solde: 30, aujourdhui: 0 } })), valeur.boutique, valeur.motifs).cadeaux[0];
  assert.deepEqual([pile.possible, pile.manque, pile.fraction], [true, null, 1], '30 points pile : « Je veux ça » pour le petit cadeau');
  const presque = vueBoutique(timo(valeurEnfants({ points: { solde: 29, aujourdhui: 0 } })), valeur.boutique, valeur.motifs).cadeaux[0];
  assert.deepEqual([presque.possible, presque.manque], [false, `encore${ESP}1`]);
  assert.deepEqual(vue.demande, {
    id: 'ab12cd34', libelle: 'Petit cadeau', picto: 'i-cadeau', prix: 30,
  });
});

test('« +1 » libre : « +1 » tant qu\'il reste des points libres, « À demain » grisé au plafond ; retour de 5 s pour l\'enfant de l\'écran ; rien pour Pablo', () => {
  const ms = paris('17:00');
  const valeur = valeurEnfants();
  assert.deepEqual(vuePlusUn(timo(valeur), null, ms), { possible: true, texte: '+1', annulation: null });
  const dernier = { enfant: 'timo', jusqua: ms + 5000 };
  assert.deepEqual(vuePlusUn(timo(valeur), dernier, ms + 4999).annulation, { jusqua: ms + 5000 });
  assert.equal(vuePlusUn(timo(valeur), dernier, ms + 5000).annulation, null, '5 s passées');
  assert.equal(vuePlusUn(timo(valeur), { enfant: 'autre', jusqua: ms + 5000 }, ms).annulation, null, 'seulement pour l\'enfant de l\'écran');
  const plafond = vuePlusUn(timo(valeurEnfants({ points: { solde: 47, aujourdhui: 10, libres_restants: 0 } })), dernier, ms);
  assert.deepEqual(plafond, { possible: false, texte: `À${ESP}demain`, annulation: { jusqua: ms + 5000 } }, 'au plafond, le dernier point s\'annule encore');
  assert.equal(vuePlusUn(pablo(valeur), null, ms), null, 'Pablo : ni points ni « +1 »');
});

test('Pablo : trois pictogrammes, étoiles du bocal, « Ensuite » ouvert quand tout est fait, annulation de 5 s', () => {
  const coche = paris('07:30');
  const enCours = vueDePablo(valeurEnfants({ pablo: { 'petit-dejeuner': ['valide', coche] } }), coche + 1000);
  assert.deepEqual(enCours.cases.map((c) => [c.id, c.fait]), [['petit-dejeuner', true], ['dents', false], ['chaussures', false]]);
  assert.deepEqual([enCours.etoiles, enCours.places, enCours.ensuite.debloque, enCours.annulation], [1, 3, false, { id: 'petit-dejeuner', jusqua: coche + 5000 }]);
  const fini = vueDePablo(valeurEnfants({ pablo: tout(ETAPES_PABLO) }), coche);
  assert.deepEqual([fini.etoiles, fini.ensuite, fini.annulation], [3, { libelle: 'Une histoire', picto: 'i-livre', debloque: true }, null]);
});

function fauxClient(reponses = {}) {
  const envois = [];
  const repondre = (chemin) => Promise.resolve(reponses[chemin] || { ok: true, donnees: {} });
  return {
    envois,
    poster: (chemin, corps, entetes) => {
      envois.push({
        methode: 'POST', chemin, corps, entetes,
      });
      return repondre(chemin);
    },
    lire: (chemin, entetes) => {
      envois.push({ methode: 'GET', chemin, entetes });
      return repondre(chemin);
    },
  };
}

test('mode parent côté page : jeton gardé 60 s d\'après l\'heure du serveur, en-tête seulement pendant la session, refus dit', async () => {
  let ms = paris('07:30');
  const client = fauxClient({ '/api/enfants/parent': { ok: true, donnees: { jeton: 'abc', expire_le: iso(ms + 60_000) } } });
  const session = creerSessionParent({ client, maintenant: () => ms });
  assert.deepEqual([session.actif(), session.restantS(), session.entetes()], [false, 0, undefined]);
  assert.deepEqual(await session.ouvrir(), { ok: true, message: null });
  assert.deepEqual(client.envois[0], {
    methode: 'POST', chemin: '/api/enfants/parent', corps: {}, entetes: undefined,
  });
  assert.deepEqual([session.actif(), session.restantS(), session.entetes()], [true, 60, { 'x-cadre-parent': 'abc' }]);
  ms += 59_100;
  assert.equal(session.restantS(), 1);
  ms += 900;
  assert.deepEqual([session.actif(), session.entetes()], [false, undefined], 'expiré à 60 s');
  const refus = creerSessionParent({ client: fauxClient({ '/api/enfants/parent': { ok: false, statut: 429, message: 'Trop d\'actions' } }), maintenant: () => ms });
  assert.deepEqual(await refus.ouvrir(), { ok: false, message: 'Trop d\'actions' });
  session.fermer();
  assert.equal(session.actif(), false);
});

test('envois du tableau : chemins et corps de la liste fermée du serveur, jeton parent en en-tête seulement pendant la session (jamais pour le point libre)', async () => {
  const ms = paris('07:30');
  const client = fauxClient({ '/api/enfants/parent': { ok: true, donnees: { jeton: 'j1', expire_le: iso(ms + 60_000) } } });
  const session = creerSessionParent({ client, maintenant: () => ms });
  const envois = creerEnvois({ client, session });
  await envois.cocher('timo', 'dents');
  await envois.minuteur('timo', 'demarrer');
  await envois.demanderEchange('timo', 'petit');
  await session.ouvrir();
  await envois.annuler('timo', 'dents');
  await envois.decider('timo', 'leve', 'valider');
  await envois.donnerPoint('timo', null);
  await envois.retirerPoint('timo');
  await envois.pointLibre('timo');
  await envois.annulerPointLibre('timo');
  await envois.deciderEchange('timo', 'ab12cd34', 'refuser');
  await envois.historique();
  assert.deepEqual(client.envois.map(({ methode, chemin, corps, entetes }) => [methode, chemin, corps, entetes ? entetes['x-cadre-parent'] : null]), [
    ['POST', '/api/enfants/timo/etapes/dents', {}, null],
    ['POST', '/api/enfants/timo/minuteur', { action: 'demarrer' }, null],
    ['POST', '/api/enfants/timo/echanges', { cadeau: 'petit' }, null],
    ['POST', '/api/enfants/parent', {}, null],
    ['POST', '/api/enfants/timo/etapes/dents/annuler', {}, 'j1'],
    ['POST', '/api/enfants/timo/etapes/leve/decision', { decision: 'valider' }, 'j1'],
    ['POST', '/api/enfants/timo/points', { motif: null }, 'j1'],
    ['POST', '/api/enfants/timo/points/retirer', {}, 'j1'],
    ['POST', '/api/enfants/timo/points/libre', {}, null],
    ['POST', '/api/enfants/timo/points/libre/annuler', {}, null],
    ['POST', '/api/enfants/timo/echanges/ab12cd34/decision', { decision: 'refuser' }, 'j1'],
    ['GET', '/api/enfants/historique', undefined, 'j1'],
  ]);
});

test('vue du mode parent : actions par étape (valider ou refuser, cocher, décocher), +1 avec Bravo en premier, −1 permis au-dessus de 0, demande, 7 jours d\'UN enfant', () => {
  const valeur = valeurEnfants({
    timo: { leve: 'attente', dents: 'valide' },
    demande: {
      id: 'ab12cd34', cadeau: 'moyen', prix: 60, le: iso(paris('17:00')),
    },
  });
  const historique = {
    jours: ['2026-10-08', '2026-10-14'],
    enfants: [
      {
        id: 'timo', prenom: 'Timo', type: 'minutes', total: 6, jours: [
          {
            journee: '2026-10-08', faites: 6, gagnees: 32, utilisees_s: 1500, points: 1,
          },
          {
            journee: '2026-10-14', faites: 1, gagnees: 3, utilisees_s: 0, points: 0,
          },
        ],
      },
      {
        id: 'pablo', prenom: 'Pablo', type: 'etoiles', total: 3, jours: [
          {
            journee: '2026-10-08', faites: 0, gagnees: 0, utilisees_s: null, points: null,
          },
          {
            journee: '2026-10-14', faites: 2, gagnees: 2, utilisees_s: null, points: null,
          },
        ],
      },
    ],
  };
  const vue = vueParent(timo(valeur), valeur, historique);
  assert.deepEqual(vue.etapes.map((e) => [e.id, e.actions]), [
    ['leve', ['valider', 'refuser']], ['dejeuner', ['cocher']], ['dents', ['decocher']], ['habille', ['cocher']], ['cartable', ['cocher']], ['calme', ['cocher']],
  ]);
  assert.deepEqual(vue.points.motifs.map((m) => [m.id, m.libelle]), [[null, `Bravo${ESP}!`], ['range', 'A rangé'], ['table', 'A mis la table'], ['aide', 'A aidé']]);
  assert.deepEqual([vue.points.solde, vue.points.retirable], [37, true]);
  assert.equal(vueParent(timo(valeurEnfants({ points: { solde: 0, aujourdhui: 0, libres_restants: 10 } })), valeur, null).points.retirable, false, '−1 grisé à 0 : jamais sous zéro');
  assert.deepEqual(vue.demande, {
    id: 'ab12cd34', libelle: 'Moyen cadeau', picto: 'i-cadeau', prix: 60, possible: false,
  });
  assert.deepEqual(vue.historique, [{ jour: 'Jeu', etat: 'pleine', valeur: `32${ESP}min` }, { jour: 'Mer', etat: 'moitie', valeur: `3${ESP}min` }]);
  const dePablo = vueParent(pablo(valeur), valeur, historique);
  assert.deepEqual([dePablo.points, dePablo.demande], [null, null], 'Pablo : ni points ni boutique');
  assert.deepEqual(dePablo.historique, [{ jour: 'Jeu', etat: 'vide', valeur: '' }, { jour: 'Mer', etat: 'moitie', valeur: `2${ESP}★` }]);
  assert.equal(vueParent(timo(valeur), valeur, null).historique, null, 'historique pas encore lu');
  const demande = (solde) => vueParent(timo(valeurEnfants({
    points: { solde, aujourdhui: 0 },
    demande: {
      id: 'ab12cd35', cadeau: 'petit', prix: 30, le: iso(paris('17:05')),
    },
  })), valeur, null).demande.possible;
  assert.deepEqual([demande(30), demande(29)], [true, false], 'Valider actif à 30 points pile, pas à 29');
});

test('sons : doux et courts (sinus ou triangle, sous 1,6 s, volume plafonné) ; sautés sans contexte audio qui tourne, jamais d\'erreur', () => {
  for (const [nom, notes] of Object.entries(SONS)) {
    for (const n of notes) {
      assert.ok(['sine', 'triangle'].includes(n.type), `${nom} : ${n.type}`);
      assert.ok(n.debut + n.duree <= 1.6, `${nom} : trop long`);
    }
  }
  assert.ok(VOLUME_MAX <= 0.2, 'pas de vacarme');
  const crees = [];
  const parametre = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const contexte = {
    state: 'suspended',
    currentTime: 0,
    destination: {},
    reprises: 0,
    resume() { this.reprises += 1; return Promise.resolve(); },
    createOscillator: () => {
      const o = {
        type: null, frequency: parametre(), connect() {}, start() {}, stop() {},
      };
      crees.push(o);
      return o;
    },
    createGain: () => ({ gain: parametre(), connect() {} }),
  };
  const sons = creerSonsEnfants({ obtenirContexte: () => contexte });
  assert.equal(sons.jouer('etape'), false, 'contexte suspendu : rien');
  sons.deverrouiller();
  assert.equal(contexte.reprises, 1);
  contexte.state = 'running';
  assert.equal(sons.jouer('coffre'), true);
  assert.equal(crees.length, SONS.coffre.length);
  assert.equal(sons.jouer('inconnu'), false);
  assert.equal(creerSonsEnfants({ obtenirContexte: () => { throw new Error('pas d\'audio'); } }).jouer('etape'), false);
});

test('chemin de la quête : cases et coffre en S sur deux rangées, dans la carte ; secteur du disque partant de midi', () => {
  const points = positions(6);
  assert.equal(points.length, 7, '6 cases et le coffre');
  assert.ok(points.slice(0, 4).every((p) => Math.abs(p.y - 330) <= 24) && points.slice(4).every((p) => Math.abs(p.y - 690) <= 24), 'deux rangées');
  assert.ok(points[0].x < points[3].x && points[4].x > points[6].x, 'aller à droite, retour à gauche');
  assert.ok(points.every((p) => p.x - 100 >= 0 && p.x + 100 <= 1304), 'dans la carte de 1 304 px');
  assert.match(trace(points), /^M40 \d+( C[\d -]+)+$/);
  assert.equal(positions(1).length, 2);
  assert.equal(secteur(0, 200, 200, 196), '');
  assert.match(secteur(1, 200, 200, 196), /^M200 4A196 196 0 1 1 200 396A/);
  assert.equal(secteur(0.25, 200, 200, 196), 'M200 200L200 4A196 196 0 0 1 396.00 200.00Z');
  assert.match(secteur(0.75, 200, 200, 196), / 0 1 1 4\.00 200\.00Z$/, 'plus d\'une moitié : grand arc');
});

test('pilotage : écran des enfants gardé 90 s sans toucher puis retour à l\'Accueil ; minuteur d\'écran = pas de mode Photos ; rechargement attendu', () => {
  assert.equal(DELAI_ENFANTS_MS, 90000);
  assert.deepEqual([
    enfantsRetenu({ ecranActif: 'enfants', inactifMs: 89_999 }),
    enfantsRetenu({ ecranActif: 'enfants', inactifMs: 90_000 }),
    enfantsRetenu({ ecranActif: 'accueil', inactifMs: 10 }),
  ], [true, false, false]);
  const base = {
    recetteOuverte: false, alerteVisible: false, minuteursActifs: false,
  };
  assert.equal(apresInactivite({
    ...base, signal: true, inactifMs: 60_000, ecranRetenu: true, retenuFini: false,
  }), 'rien', 'à 60 s, l\'écran des enfants reste');
  assert.equal(apresInactivite({
    ...base, signal: false, inactifMs: 90_000, ecranRetenu: false, retenuFini: true,
  }), 'accueil', 'à 90 s, retour à l\'Accueil');
  const photos = {
    enPhotos: false, inactifMs: 200_000, recetteOuverte: false, alerteVisible: false, sonnetteVisible: false, nuit: false, photosPretes: true, vuePrete: true, enLigne: true, ecranRetenu: false,
  };
  assert.equal(decisionPhotos(photos), 'entrer');
  assert.equal(decisionPhotos({ ...photos, minuteurEcran: true }), 'rien', 'Timo regarde : sa pastille reste visible');
  const minuteurs = { enCours: [], sonnants: [] };
  assert.equal(rechargementVersionBloque({
    recetteOuverte: false, etatMinuteurs: minuteurs, sonnetteVisible: false, ecranActif: 'enfants',
  }), true, 'un enfant en pleine routine : on attend');
});
