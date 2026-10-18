// tests/enfants-dom.test.js
//
// Rôle    : prouver les écrans des enfants sur le faux DOM (partie 4 des choix de Thomas du 14/10, puis décisions du 14/10
//           en fin d'après-midi) : l'entrée (deux cartes, étoile seulement pour une routine finie) et le mode enfant plein
//           écran, navigation au poser du doigt ; la quête de Timo (appui long d'une seconde pour valider, rien sur un
//           toucher court ni sur « Levé » avant 6 h 30, Annuler des 5 s) ; la bourse et le minuteur d'écran ; les points et
//           la boutique (« Je veux ça » seulement s'il a assez, demande en attente) ; le « +1 » libre de l'en-tête (sans
//           jeton, retour de 5 s, grisé au plafond, ni sur Pablo ni en mode parent) ; « D'abord, ensuite » de Pablo (simple
//           toucher, « Ensuite » qui s'ouvre) ; le geste parent (appui long de 3 s sur un visage, en haut ou sur la carte
//           d'entrée : mode parent de cet enfant, lever sans effet, toucher court normal, aucun retour, ratés, rien de
//           coincé après un appui interrompu, deuxième doigt et capture perdue, rien quand l'écran a été quitté pendant l'appui) ; le mode parent (jeton en en-tête,
//           Valider, +1, −1, Décocher, sortie à 60 s ; la fête du coffre jouée à la fermeture si le parent a tout validé, le
//           rebond des points quand l'enfant revoit l'onglet Points) ; l'étoile « fini » seulement sur le visage de l'enfant
//           affiché ; les refus en une ligne douce ; la case du matin de l'Accueil ; la pastille du minuteur d'écran ; le
//           message de fin ; une règle de couleur par enfant du barème.
// Entrées : faux DOM (tests/faux-dom.js), faux client, faux sons, horloge de la page (performance.now) remplacée, minuteurs
//           simulés (t.mock.timers) pour les appuis longs et les 3 s du geste parent ; valeurs de tests/enfants-valeur.js.
// Sorties : node --test.
// Pièges  :
//   - Le faux DOM ne propage pas les événements : on déclenche sur le nœud qui porte l'écouteur (la case, le bouton, le
//     visage dessiné de la carte d'entrée) ; la remontée du visage vers sa carte se joue en déclenchant sur la carte
//     avec target = le visage (la carte ignore ce poser).
//   - L'anti-répétition de 300 ms des gestes (appui.js) lit performance.now : chaque toucher l'avance.
//   - Les réponses du faux client sont des promesses : le test attend la fin des microtâches (laisser()).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import {
  annulerDoigt, appuyer, bouger, cacherPage, installerFauxDom, lever, parClasse, poser, texte,
} from './faux-dom.js';
import {
  ETAPES_TIMO, iso, paris, valeurEnfants,
} from './enfants-valeur.js';

installerFauxDom();
const { creerEnfants } = await import('../web/src/ecrans/enfants.js');
const { creerAccueil } = await import('../web/src/ecrans/accueil.js');
const { vueAccueil } = await import('../web/src/ecrans/accueil-donnees.js');
const { encartAujourdhui } = await import('../web/src/ecrans/aujourdhui-donnees.js');
const { creerPastilleEcran } = await import('../web/src/composants/pastille-ecran.js');
const { creerFinVideo } = await import('../web/src/composants/fin-video.js');
const { creerMenu } = await import('../web/src/composants/menu.js');
const { chargerBareme } = await import('../serveur/enfants/bareme.js');

let horloge = 0;
performance.now = () => horloge;
after(() => { delete performance.now; });

const laisser = () => new Promise((resoudre) => { setImmediate(resoudre); });
const visible = (n) => {
  for (let m = n; m; m = m.parentNode) if (m.hidden) return false;
  return true;
};
const visibles = (racine, classe) => parClasse(racine, classe).filter(visible);
const parEtiquette = (racine, classe, debut) => parClasse(racine, classe).filter((n) => (n.getAttribute('aria-label') || '').startsWith(debut))[0];
const toucher = (noeud) => {
  horloge += 400;
  appuyer(noeud);
};
function appuiLong(t, noeud, ms = 1000) {
  horloge += 400;
  poser(noeud);
  t.mock.timers.tick(ms);
  lever(noeud);
}
// Le geste parent : appui long de 3 s sur le visage d'un enfant (horloge monotone et minuteur simulé avancés ensemble).
const visageDe = (m, rang) => visibles(m.conteneur, 'enfants-visage')[rang];
const gesteParent = (t, visage) => appuiLong(t, visage, 3000);
const jetonOk = (ms, jeton = 'j') => ({ ok: true, donnees: { jeton, expire_le: iso(ms + 60_000) } });
// Classes et nœuds masqués de tout l'écran : rien ne doit changer pendant le geste parent.
function instantane(racine) {
  const etats = [];
  const parcourir = (n) => {
    etats.push(`${n.className}|${n.hidden}`);
    n.childNodes.forEach(parcourir);
  };
  parcourir(racine);
  return etats;
}

function fauxClient(reponses = {}) {
  const envois = [];
  const repondre = (chemin) => {
    const reponse = typeof reponses[chemin] === 'function' ? reponses[chemin]() : reponses[chemin];
    return Promise.resolve(reponse || { ok: true, donnees: { statut: 'valide' } });
  };
  return {
    envois,
    poster: (chemin, corps, entetes) => {
      envois.push({
        methode: 'POST', chemin, corps, parent: entetes ? entetes['x-cadre-parent'] : null,
      });
      return repondre(chemin);
    },
    lire: (chemin, entetes) => {
      envois.push({ methode: 'GET', chemin, parent: entetes ? entetes['x-cadre-parent'] : null });
      return repondre(chemin);
    },
  };
}

function monter(t, { ms = paris('07:20'), reponses } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { conteneur } = installerFauxDom();
  const client = fauxClient(reponses);
  const sons = { joues: [], jouer(nom) { this.joues.push(nom); return true; }, deverrouiller() {} };
  const pleinEcran = [];
  let accueils = 0;
  const horlogeEcran = { ms };
  const ecran = creerEnfants(conteneur, {
    client, maintenant: () => horlogeEcran.ms, sons, surPleinEcran: (actif) => pleinEcran.push(actif), allerAccueil: () => { accueils += 1; },
  });
  return {
    conteneur, client, sons, pleinEcran, ecran, horlogeEcran, accueils: () => accueils,
  };
}

test('entrée : deux grandes cartes (visage dessiné, couleur, prénom), étoile seulement pour une routine finie ; une carte ouvre le mode enfant', (t) => {
  const m = monter(t);
  m.ecran.mettreAJour(valeurEnfants({ pablo: { 'petit-dejeuner': 'valide', dents: 'valide', chaussures: 'valide' } }), paris('07:20'));
  m.ecran.entrer();
  assert.deepEqual(visibles(m.conteneur, 'enfants-carte-prenom').map(texte), ['Timo', 'Pablo']);
  const avatars = visibles(m.conteneur, 'enfants-carte-avatar');
  assert.deepEqual(avatars.map((a) => [a.classList.contains('couleur-enfant-timo'), a.classList.contains('couleur-enfant-pablo')]), [[true, false], [false, true]]);
  assert.deepEqual(avatars.map((a) => visibles(a, 'avatar-etoile').length), [0, 1], 'l\'étoile dorée de Pablo seulement');
  assert.equal(avatars[1].getAttribute('aria-label'), 'Pablo, routine finie');
  assert.equal(visibles(m.conteneur, 'enfants-mode').length, 0);
  poser(visibles(m.conteneur, 'enfants-carte')[0]);
  assert.deepEqual(m.pleinEcran, [false, true], 'menu masqué en mode enfant, ouvert au poser du doigt (règle de Wes)');
  assert.deepEqual(visibles(m.conteneur, 'enfants-titre').map(texte), ['La quête du matin']);
  assert.equal(visibles(m.conteneur, 'quete-case').length, 6);
  assert.equal(visibles(m.conteneur, 'enfants-visage').length, 2);
  poser(visibles(m.conteneur, 'enfants-onglet')[1]);
  assert.deepEqual(visibles(m.conteneur, 'enfants-titre').map(texte), ['Mes points'], 'onglet ouvert au poser');
  poser(visibles(m.conteneur, 'enfants-maison')[0]);
  assert.equal(m.accueils(), 1, 'bouton maison : retour à l\'Accueil, au poser');
  m.ecran.entrer();
  const cartePablo = visibles(m.conteneur, 'enfants-carte')[1];
  const visagePablo = parClasse(cartePablo, 'enfants-carte-avatar')[0];
  horloge += 400;
  poser(visagePablo);
  cartePablo.declencher('pointerdown', { target: visagePablo.firstChild || visagePablo });
  assert.equal(visibles(m.conteneur, 'enfants-mode').length, 0, 'poser venu du visage dessiné : la carte autour ne s\'ouvre pas (appui long possible)');
  lever(visagePablo);
  assert.equal(visibles(m.conteneur, 'pablo-case').length, 3, 'toucher court sur le visage : ouvre l\'enfant, au lever');
});

test('quête : appui long d\'une seconde pour valider (son, rien sur un toucher court), « Levé » refusé avant 6 h 30 sans rien envoyer, Annuler pendant 5 s', async (t) => {
  const m = monter(t, { ms: paris('06:20') });
  m.ecran.mettreAJour(valeurEnfants(), paris('06:20'));
  m.ecran.ouvrirEnfant('timo');
  const dents = parEtiquette(m.conteneur, 'quete-case', 'Dents');
  toucher(dents);
  assert.equal(m.client.envois.length, 0, 'toucher court : rien');
  appuiLong(t, parEtiquette(m.conteneur, 'quete-case', 'Levé'));
  assert.equal(m.client.envois.length, 0, 'avant 6 h 30 : rien n\'est envoyé');
  assert.deepEqual(visibles(m.conteneur, 'quete-tot').map(texte), ['6 h 30']);
  appuiLong(t, dents);
  await laisser();
  assert.deepEqual(m.client.envois, [{
    methode: 'POST', chemin: '/api/enfants/timo/etapes/dents', corps: {}, parent: null,
  }]);
  assert.deepEqual(m.sons.joues, ['etape']);
  const coche = paris('06:20');
  m.ecran.mettreAJour(valeurEnfants({ timo: { dents: ['valide', coche] } }), coche + 1000);
  const casesValides = visibles(m.conteneur, 'quete-case-valide');
  assert.equal(casesValides.length, 1);
  appuiLong(t, casesValides[0]);
  assert.equal(m.client.envois.length, 1, 'une case faite ne renvoie rien');
  const annuler = visibles(m.conteneur, 'quete-annuler');
  assert.equal(annuler.length, 1);
  toucher(annuler[0]);
  assert.equal(m.client.envois[1].chemin, '/api/enfants/timo/etapes/dents/annuler');
  m.horlogeEcran.ms = coche + 6000;
  m.ecran.entretenir(coche + 6000);
  assert.equal(visibles(m.conteneur, 'quete-annuler').length, 0, '5 s passées : plus d\'Annuler');
});

test('quête (variante « parent » du barème) : étape demandée par Timo (sablier dans le cadenas, contour en pointillés), avatar sur la première à faire, coffre ouvert quand tout est fait (fête)', (t) => {
  const m = monter(t);
  m.ecran.mettreAJour(valeurEnfants({ timo: { leve: 'attente', dejeuner: 'valide' }, parent: ['leve', 'calme'] }), paris('07:20'));
  m.ecran.ouvrirEnfant('timo');
  const leve = parEtiquette(m.conteneur, 'quete-case', 'Levé');
  assert.ok(leve.classList.contains('quete-case-attente'));
  assert.equal(parClasse(leve, 'quete-cadenas-icone')[0].getAttribute('data-icone'), 'i-sablier');
  assert.ok(parEtiquette(m.conteneur, 'quete-case', 'Dents').classList.contains('quete-case-en-cours'));
  assert.equal(parClasse(m.conteneur, 'quete-coffre')[0].getAttribute('aria-label'), 'Coffre fermé');
  m.ecran.mettreAJour(valeurEnfants({ timo: Object.fromEntries(ETAPES_TIMO.map(([id]) => [id, 'valide'])) }), paris('07:30'));
  assert.equal(parClasse(m.conteneur, 'quete-coffre')[0].getAttribute('aria-label'), 'Coffre ouvert');
  assert.deepEqual(m.sons.joues, ['coffre'], 'la fête du coffre, vue pendant que l\'écran le montre');
  m.ecran.ouvrirEnfant('pablo');
  m.ecran.ouvrirEnfant('timo');
  assert.deepEqual(m.sons.joues, ['coffre'], 'pas de nouvelle fête en revenant sur un coffre déjà ouvert');
});

test('bourse : « Je regarde » à l\'appui long, le minuteur qui se vide (minutes en très grand, Pause, Fini), « Je regarde » et Fini en pause', async (t) => {
  const m = monter(t, { ms: paris('17:00') });
  const valeur = valeurEnfants({ timo: { dents: 'valide', habille: 'valide' } });
  m.ecran.mettreAJour(valeur, paris('17:00'));
  m.ecran.ouvrirEnfant('timo');
  assert.deepEqual(visibles(m.conteneur, 'bourse-nombre').map(texte), ['8min']);
  const regarder = visibles(m.conteneur, 'bourse-regarder')[0];
  toucher(regarder);
  assert.equal(m.client.envois.length, 0, 'toucher qui passe : rien');
  appuiLong(t, regarder);
  await laisser();
  assert.deepEqual(m.client.envois.map(({ chemin, corps }) => [chemin, corps]), [['/api/enfants/timo/minuteur', { action: 'demarrer' }]]);
  const minuteur = {
    etat: 'en_cours', debut: iso(paris('17:00')), duree_s: 480, fin: iso(paris('17:08')),
  };
  m.ecran.mettreAJour(valeurEnfants({ timo: { dents: 'valide', habille: 'valide' }, minuteur }), paris('17:01'));
  assert.equal(visibles(m.conteneur, 'bourse-disque').length, 1);
  assert.deepEqual(visibles(m.conteneur, 'bourse-restant').map(texte), ['7min']);
  assert.ok(parClasse(m.conteneur, 'bourse-disque-reste')[0].getAttribute('d').startsWith('M200 200L200 4A196 196 0 1 1 '));
  const pause = visibles(m.conteneur, 'bourse-boutons')[0].childNodes.filter(visible);
  assert.deepEqual(pause.map(texte), ['Pause', 'Fini']);
  toucher(pause[0]);
  assert.deepEqual(m.client.envois[1].corps, { action: 'pause' });
  m.ecran.mettreAJour(valeurEnfants({ timo: { dents: 'valide', habille: 'valide' }, minuteur: { etat: 'pause' }, minutes: { utilisees_s: 60, disponibles_s: 420 } }), paris('17:01'));
  assert.deepEqual(visibles(m.conteneur, 'bourse-boutons')[0].childNodes.filter(visible).map(texte), ['Je regarde', 'Fini']);
});

test('points et boutique : solde, gains, « Je veux ça » seulement s\'il a assez (appui long), puis « En attente d\'un parent » ; les points qui montent rebondissent', async (t) => {
  const m = monter(t, { ms: paris('17:00') });
  m.ecran.mettreAJour(valeurEnfants({ gains: [{ motif: 'range', le: iso(paris('16:00')) }] }), paris('17:00'));
  m.ecran.ouvrirEnfant('timo');
  toucher(visibles(m.conteneur, 'enfants-onglet')[1]);
  assert.deepEqual(visibles(m.conteneur, 'enfants-titre').map(texte), ['Mes points']);
  assert.equal(visibles(m.conteneur, 'quete-carte').length, 0);
  assert.deepEqual(visibles(m.conteneur, 'boutique-solde').map(texte), ['37']);
  assert.deepEqual(visibles(m.conteneur, 'boutique-gain-texte').map(texte), ['A rangé']);
  const vouloir = visibles(m.conteneur, 'boutique-vouloir');
  assert.equal(vouloir.length, 1, 'seulement le petit cadeau (37 points sur 30, 60, 90)');
  assert.deepEqual(visibles(m.conteneur, 'boutique-manque').map(texte), ['encore 23', 'encore 53']);
  appuiLong(t, vouloir[0]);
  await laisser();
  assert.deepEqual(m.client.envois.map(({ chemin, corps }) => [chemin, corps]), [['/api/enfants/timo/echanges', { cadeau: 'petit' }]]);
  m.ecran.mettreAJour(valeurEnfants({
    points: { solde: 38, aujourdhui: 1, libres_restants: 10 },
    demande: {
      id: 'ab12cd34', cadeau: 'petit', prix: 30, le: iso(paris('17:00')),
    },
  }), paris('17:01'));
  assert.equal(visibles(m.conteneur, 'boutique-attente').length, 1);
  assert.equal(visibles(m.conteneur, 'boutique-vouloir').length, 0);
  assert.deepEqual(m.sons.joues, ['point', 'point'], 'demande envoyée, puis le point qui monte');
});

test('Pablo : simple toucher, étoile vers le bocal (son), case faite inerte, « Ensuite » qui s\'ouvre quand tout est fait ; aucun titre ni onglet', async (t) => {
  const m = monter(t);
  m.ecran.mettreAJour(valeurEnfants(), paris('07:20'));
  m.ecran.ouvrirEnfant('timo');
  toucher(visibles(m.conteneur, 'enfants-visage')[1]);
  assert.deepEqual([visibles(m.conteneur, 'enfants-titre').length, visibles(m.conteneur, 'enfants-onglets').length], [0, 0]);
  assert.equal(visibles(m.conteneur, 'plus-un').length, 0, 'pas de « +1 » pour Pablo (ni points ni boutique)');
  const cases = visibles(m.conteneur, 'pablo-case');
  assert.deepEqual(cases.map((c) => c.getAttribute('aria-label')), ['Petit déjeuner', 'Dents', 'Chaussures']);
  toucher(cases[0]);
  await laisser();
  assert.deepEqual(m.client.envois.map(({ chemin }) => chemin), ['/api/enfants/pablo/etapes/petit-dejeuner']);
  assert.deepEqual(m.sons.joues, ['etoile']);
  m.ecran.mettreAJour(valeurEnfants({ pablo: { 'petit-dejeuner': 'valide' } }), paris('07:21'));
  toucher(visibles(m.conteneur, 'pablo-case')[0]);
  assert.equal(m.client.envois.length, 1, 'case faite : rien');
  assert.equal(parClasse(m.conteneur, 'pablo-bocal')[0].getAttribute('aria-label'), '1 étoile');
  m.ecran.mettreAJour(valeurEnfants({ pablo: { 'petit-dejeuner': 'valide', dents: 'valide', chaussures: 'valide' } }), paris('07:25'));
  assert.ok(parClasse(m.conteneur, 'pablo-ensuite')[0].classList.contains('pablo-ensuite-ouverte'));
  assert.deepEqual(m.sons.joues, ['etoile', 'coffre']);
});

test('« +1 » libre : en-tête de Timo sur Quête et Points, sans jeton ; étoile vers l\'onglet Points ou total qui rebondit, retour de 5 s, grisé « À demain » au plafond', async (t) => {
  const ms = paris('17:00');
  const reponseLibre = { ok: true, donnees: { enfant: 'timo', solde: 38, aujourdhui: 1, libres_restants: 9, annulable_jusqu_a: iso(ms + 5000) } };
  const m = monter(t, { ms, reponses: { '/api/enfants/timo/points/libre': reponseLibre } });
  m.ecran.mettreAJour(valeurEnfants(), ms);
  m.ecran.ouvrirEnfant('timo');
  const plus = () => visibles(m.conteneur, 'plus-un-bouton');
  assert.deepEqual([plus().map(texte), visibles(m.conteneur, 'plus-un-retour').length], [['+1'], 0], 'sur la quête, sans retour');
  toucher(plus()[0]);
  await laisser();
  assert.deepEqual(m.client.envois.map(({ chemin, corps, parent }) => [chemin, corps, parent]), [['/api/enfants/timo/points/libre', {}, null]]);
  assert.deepEqual(m.sons.joues, ['point'], 'quête : le total n\'est pas affiché, l\'étoile vole vers l\'onglet Points');
  m.ecran.mettreAJour(valeurEnfants({ points: { solde: 38, aujourdhui: 1, libres_restants: 9 } }), ms + 500);
  assert.deepEqual(m.sons.joues, ['point'], 'rien de plus quand la valeur du flux arrive');
  const retour = visibles(m.conteneur, 'plus-un-retour');
  assert.equal(retour.length, 1, 'retour de 5 s (erreur de doigt)');
  toucher(retour[0]);
  await laisser();
  assert.deepEqual(m.client.envois.slice(1).map(({ chemin, corps, parent }) => [chemin, corps, parent]), [['/api/enfants/timo/points/libre/annuler', {}, null]]);
  assert.equal(visibles(m.conteneur, 'plus-un-retour').length, 0, 'retour masqué dès l\'appui');
  m.ecran.mettreAJour(valeurEnfants(), ms + 1000);
  toucher(visibles(m.conteneur, 'enfants-onglet')[1]);
  assert.deepEqual([plus().length, m.sons.joues], [1, ['point']], 'onglet Points : le même bouton, aucun point de plus vu');
  toucher(plus()[0]);
  await laisser();
  assert.deepEqual(m.sons.joues, ['point'], 'onglet Points : le rebond attend la valeur du flux');
  m.ecran.mettreAJour(valeurEnfants({ points: { solde: 38, aujourdhui: 1, libres_restants: 9 } }), ms + 1500);
  assert.deepEqual(m.sons.joues, ['point', 'point'], 'le total qui monte rebondit, avec son petit son');
  m.horlogeEcran.ms = ms + 6000;
  m.ecran.entretenir(ms + 6000);
  assert.equal(visibles(m.conteneur, 'plus-un-retour').length, 0, '5 s passées : plus de retour');
  m.ecran.mettreAJour(valeurEnfants({ points: { solde: 47, aujourdhui: 10, libres_restants: 0 } }), ms + 7000);
  assert.deepEqual([plus()[0].disabled, texte(plus()[0])], [true, 'À demain'], 'plafond du jour : grisé, un mot court');
  toucher(plus()[0]);
  await laisser();
  assert.equal(m.client.envois.length, 3, 'grisé : rien n\'est envoyé');
});

test('geste parent : appui long de 3 s sur un visage du haut, mode parent de CET enfant, aucun retour pendant les 3 s, lever sans effet ; refait, il relance 60 s', async (t) => {
  const ms = paris('07:20');
  const jetons = [jetonOk(ms), jetonOk(ms + 40_000)];
  const m = monter(t, { ms, reponses: { '/api/enfants/parent': () => jetons.shift() } });
  m.ecran.mettreAJour(valeurEnfants(), ms);
  m.ecran.ouvrirEnfant('timo');
  const pablo = visageDe(m, 1);
  const avant = instantane(m.conteneur);
  horloge += 400;
  poser(pablo, 1800, 60);
  bouger(pablo, 1830, 90);
  horloge += 2900;
  t.mock.timers.tick(2900);
  assert.deepEqual(instantane(m.conteneur), avant, 'aucun retour : ni classe, ni nœud montré ou masqué');
  assert.equal(m.client.envois.length, 0, 'rien avant 3 s (30 px de tremblement tolérés)');
  horloge += 100;
  t.mock.timers.tick(100);
  await laisser();
  await laisser();
  assert.deepEqual(m.client.envois.map(({ chemin }) => chemin), ['/api/enfants/parent', '/api/enfants/historique']);
  assert.deepEqual(visibles(m.conteneur, 'enfants-bandeau-nom').map(texte), ['Mode parent'], 'le bandeau, à l\'ouverture');
  assert.deepEqual(visibles(m.conteneur, 'enfants-visage').map((v) => v.classList.contains('enfants-visage-actif')), [false, true], 'Pablo affiché : le visage tenu');
  assert.equal(visibles(m.conteneur, 'parent-solde').length, 0, 'la page parent de Pablo (sans points), pas celle de Timo');
  lever(pablo, 1830, 90);
  assert.deepEqual(visibles(m.conteneur, 'enfants-visage').map((v) => v.classList.contains('enfants-visage-actif')), [false, true], 'le lever ne fait rien');
  m.horlogeEcran.ms = ms + 40_000;
  m.ecran.entretenir(ms + 40_000);
  assert.deepEqual(visibles(m.conteneur, 'enfants-bandeau-restant').map(texte), ['20 s']);
  m.client.envois.length = 0;
  gesteParent(t, visageDe(m, 1));
  await laisser();
  assert.deepEqual(m.client.envois.map(({ chemin }) => chemin).slice(0, 1), ['/api/enfants/parent'], 'refait pendant le mode parent : nouveau jeton');
  m.horlogeEcran.ms = ms + 60_000;
  m.ecran.entretenir(ms + 60_000);
  assert.equal(visibles(m.conteneur, 'parent').length, 1, 'toujours ouvert à la première échéance : relancé pour 60 s');
});

test('geste parent : toucher court sur un visage = action normale (changer d\'enfant, rien sur le visage affiché)', async (t) => {
  const ms = paris('07:20');
  const m = monter(t, { ms, reponses: { '/api/enfants/parent': jetonOk(ms) } });
  m.ecran.mettreAJour(valeurEnfants(), ms);
  m.ecran.ouvrirEnfant('timo');
  horloge += 400;
  poser(visageDe(m, 1));
  assert.equal(visibles(m.conteneur, 'pablo-case').length, 0, 'rien au poser : le visage attend le lever ou les 3 s');
  horloge += 2000;
  t.mock.timers.tick(2000);
  lever(visageDe(m, 1));
  assert.equal(visibles(m.conteneur, 'pablo-case').length, 3, 'levé à 2 s : toucher court, Pablo affiché');
  toucher(visageDe(m, 1));
  assert.equal(visibles(m.conteneur, 'pablo-case').length, 3, 'visage affiché : rien ne change');
  t.mock.timers.tick(5000);
  await laisser();
  assert.equal(m.client.envois.length, 0, 'jamais de mode parent sur un toucher court');
});

test('geste parent raté : doigt bougé de plus de 40 px, levé avant 3 s, pointercancel, page cachée ; rien ne reste coincé, le toucher suivant marche', async (t) => {
  const ms = paris('07:20');
  const m = monter(t, { ms, reponses: { '/api/enfants/parent': jetonOk(ms) } });
  m.ecran.mettreAJour(valeurEnfants(), ms);
  m.ecran.ouvrirEnfant('timo');
  const timo = visageDe(m, 0);
  const attendre = (duree) => {
    horloge += duree;
    t.mock.timers.tick(duree);
  };
  horloge += 400;
  poser(timo, 1700, 60); bouger(timo, 1741, 60); attendre(3000); lever(timo, 1741, 60);
  horloge += 400;
  poser(timo); attendre(2999); lever(timo); attendre(1000);
  horloge += 400;
  poser(timo); attendre(1000); annulerDoigt(timo); attendre(3000);
  horloge += 400;
  poser(timo); attendre(1000); cacherPage(); attendre(3000);
  await laisser();
  assert.equal(m.client.envois.length, 0, 'aucune de ces variantes n\'ouvre le mode parent');
  assert.deepEqual(visibles(m.conteneur, 'enfants-titre').map(texte), ['La quête du matin'], 'ni changement d\'enfant, ni onglet');
  lever(timo);
  assert.equal(visibles(m.conteneur, 'pablo-case').length, 0, 'le lever qui revient après la page cachée ne fait rien');
  poser(visibles(m.conteneur, 'enfants-onglet')[1]);
  assert.deepEqual(visibles(m.conteneur, 'enfants-titre').map(texte), ['Mes points'], 'juste après : l\'onglet répond au poser');
  toucher(visageDe(m, 1));
  assert.equal(visibles(m.conteneur, 'pablo-case').length, 3, 'et un visage au toucher court');
  gesteParent(t, visageDe(m, 0));
  await laisser();
  assert.deepEqual(m.client.envois.map(({ chemin }) => chemin).slice(0, 1), ['/api/enfants/parent'], 'puis un appui long juste réussit');
});

test('geste parent, écran quitté pendant l\'appui (maison touchée par un autre doigt) : rien à 3 s ni au lever, menu laissé rendu ; jeton reçu après la sortie refermé', async (t) => {
  const ms = paris('07:20');
  const m = monter(t, { ms, reponses: { '/api/enfants/parent': jetonOk(ms) } });
  m.ecran.mettreAJour(valeurEnfants(), ms);
  m.ecran.ouvrirEnfant('timo');
  const pablo = visageDe(m, 1);
  horloge += 400;
  poser(pablo);
  poser(visibles(m.conteneur, 'enfants-maison')[0]);
  m.ecran.quitter();
  assert.deepEqual(m.pleinEcran, [true, false]);
  horloge += 3000;
  t.mock.timers.tick(3000);
  lever(pablo);
  await laisser();
  await laisser();
  assert.deepEqual([m.client.envois.length, m.pleinEcran], [0, [true, false]], 'aucun jeton demandé, menu toujours rendu');
  m.ecran.ouvrirEnfant('timo');
  gesteParent(t, visageDe(m, 0));
  m.ecran.quitter();
  await laisser();
  await laisser();
  assert.deepEqual(m.client.envois.map(({ chemin }) => chemin), ['/api/enfants/parent'], 'jeton arrivé écran quitté : pas d\'historique lu');
  assert.deepEqual(m.pleinEcran, [true, false, true, false], 'ni mode enfant ni menu masqué après la sortie');
  m.ecran.ouvrirEnfant('timo');
  assert.equal(visibles(m.conteneur, 'parent').length, 0);
  appuiLong(t, parEtiquette(m.conteneur, 'quete-case', 'Dents'));
  await laisser();
  assert.equal(m.client.envois[1].parent, null, 'session refermée : plus aucun jeton envoyé');
});

test('geste parent : deuxième doigt sur le même visage (appui annulé, pas relancé), capture du doigt perdue ; le toucher suivant marche', async (t) => {
  const ms = paris('07:20');
  const m = monter(t, { ms, reponses: { '/api/enfants/parent': jetonOk(ms) } });
  m.ecran.mettreAJour(valeurEnfants(), ms);
  m.ecran.ouvrirEnfant('timo');
  const pablo = visageDe(m, 1);
  const doigt = (type, pointerId, x = 10) => pablo.declencher(type, { pointerId, clientX: x, clientY: 10 });
  horloge += 400;
  doigt('pointerdown', 1);
  horloge += 1000;
  t.mock.timers.tick(1000);
  doigt('pointerdown', 2, 30);
  doigt('pointerup', 1, 30);
  assert.equal(visibles(m.conteneur, 'pablo-case').length, 0, 'deux doigts : le lever de l\'un ne compte pas comme un toucher court');
  horloge += 3000;
  t.mock.timers.tick(3000);
  doigt('pointerup', 2, 30);
  await laisser();
  assert.deepEqual([m.client.envois.length, visibles(m.conteneur, 'pablo-case').length], [0, 0], 'ni mode parent, ni changement d\'enfant');
  horloge += 400;
  doigt('pointerdown', 3);
  pablo.declencher('lostpointercapture', { pointerId: 3 });
  horloge += 3000;
  t.mock.timers.tick(3000);
  await laisser();
  assert.equal(m.client.envois.length, 0, 'capture perdue : appui annulé');
  horloge += 400;
  doigt('pointerdown', 4);
  doigt('pointermove', 5, 200);
  doigt('pointerup', 4);
  assert.equal(visibles(m.conteneur, 'pablo-case').length, 3, 'le mouvement d\'un autre doigt est ignoré : toucher court normal');
});

test('geste parent depuis l\'écran d\'entrée : appui long sur le visage dessiné de la carte de Pablo, mode parent de Pablo, lever sans effet', async (t) => {
  const ms = paris('17:00');
  const m = monter(t, { ms, reponses: { '/api/enfants/parent': jetonOk(ms) } });
  m.ecran.mettreAJour(valeurEnfants(), ms);
  m.ecran.entrer();
  const visagePablo = visibles(m.conteneur, 'enfants-carte-avatar')[1];
  horloge += 400;
  poser(visagePablo, 1300, 400);
  horloge += 2000;
  t.mock.timers.tick(2000);
  assert.deepEqual([visibles(m.conteneur, 'enfants-mode').length, m.client.envois.length], [0, 0], 'rien avant 3 s');
  horloge += 1000;
  t.mock.timers.tick(1000);
  await laisser();
  await laisser();
  assert.deepEqual(m.client.envois.map(({ chemin }) => chemin), ['/api/enfants/parent', '/api/enfants/historique']);
  lever(visagePablo, 1300, 400);
  assert.deepEqual([visibles(m.conteneur, 'parent').length, m.pleinEcran[m.pleinEcran.length - 1]], [1, true]);
  assert.deepEqual(visibles(m.conteneur, 'enfants-visage').map((v) => v.classList.contains('enfants-visage-actif')), [false, true], 'Pablo affiché');
  assert.equal(visibles(m.conteneur, 'parent-solde').length, 0, 'la page parent de Pablo (sans points)');
});

test('mode parent : appui long sur le visage, bandeau avec le temps restant, Valider, +1, −1, Décocher avec le jeton, historique relu, sortie seule à 60 s', async (t) => {
  const ms = paris('07:20');
  const historique = {
    jours: ['2026-10-14'],
    enfants: [{
      id: 'timo', prenom: 'Timo', type: 'minutes', total: 6, jours: [{
        journee: '2026-10-14', faites: 1, gagnees: 3, utilisees_s: 0, points: 0,
      }],
    }],
  };
  const m = monter(t, {
    ms,
    reponses: {
      '/api/enfants/parent': jetonOk(ms, 'jeton-test'),
      '/api/enfants/historique': { ok: true, donnees: historique },
    },
  });
  m.ecran.mettreAJour(valeurEnfants({ timo: { leve: 'attente', dents: 'valide' }, parent: ['leve'] }), ms);
  m.ecran.ouvrirEnfant('timo');
  gesteParent(t, visageDe(m, 0));
  await laisser();
  await laisser();
  assert.deepEqual(m.client.envois.map(({ methode, chemin, parent }) => [methode, chemin, parent]), [
    ['POST', '/api/enfants/parent', null], ['GET', '/api/enfants/historique', 'jeton-test'],
  ]);
  assert.deepEqual(visibles(m.conteneur, 'enfants-bandeau-restant').map(texte), ['60 s']);
  assert.deepEqual([visibles(m.conteneur, 'quete-carte').length, visibles(m.conteneur, 'plus-un').length], [0, 0], 'ni quête ni « +1 » libre en mode parent');
  assert.deepEqual(visibles(m.conteneur, 'parent-jour-valeur').map(texte), ['3 min']);
  const actions = visibles(m.conteneur, 'parent-action');
  assert.deepEqual(actions.map(texte), ['Valider', 'Refuser', 'Cocher', 'Décocher', 'Cocher', 'Cocher', 'Cocher']);
  toucher(actions[0]);
  toucher(actions[3]);
  toucher(visibles(m.conteneur, 'parent-motif')[0]);
  const retirer = visibles(m.conteneur, 'parent-retirer')[0];
  assert.deepEqual([retirer.disabled, retirer.getAttribute('aria-label')], [false, 'Retirer un point donné par erreur']);
  toucher(retirer);
  await laisser();
  assert.deepEqual(m.client.envois.slice(2).filter((e) => e.methode === 'POST').map(({ chemin, corps, parent }) => [chemin, corps, parent]), [
    ['/api/enfants/timo/etapes/leve/decision', { decision: 'valider' }, 'jeton-test'],
    ['/api/enfants/timo/etapes/dents/annuler', {}, 'jeton-test'],
    ['/api/enfants/timo/points', { motif: null }, 'jeton-test'],
    ['/api/enfants/timo/points/retirer', {}, 'jeton-test'],
  ]);
  assert.ok(m.client.envois.filter((e) => e.chemin === '/api/enfants/historique').length >= 2, 'historique relu après une action');
  m.ecran.mettreAJour(valeurEnfants({ points: { solde: 0, aujourdhui: 0, libres_restants: 10 } }), ms + 1000);
  assert.equal(visibles(m.conteneur, 'parent-retirer')[0].disabled, true, 'à 0 point, −1 grisé : jamais sous zéro');
  m.horlogeEcran.ms = ms + 30_000;
  m.ecran.entretenir(ms + 30_000);
  assert.deepEqual(visibles(m.conteneur, 'enfants-bandeau-restant').map(texte), ['30 s']);
  m.horlogeEcran.ms = ms + 60_000;
  m.ecran.entretenir(ms + 60_000);
  assert.deepEqual([visibles(m.conteneur, 'parent').length, visibles(m.conteneur, 'quete-carte').length, visibles(m.conteneur, 'plus-un').length], [0, 1, 1]);
});

test('mode parent puis Fermer : la fête du coffre se joue si le parent a validé la dernière étape ; le point donné rebondit quand Timo revoit ses points', async (t) => {
  const ms = paris('09:30');
  const m = monter(t, { ms, reponses: { '/api/enfants/parent': jetonOk(ms) } });
  const presque = { ...Object.fromEntries(ETAPES_TIMO.map(([id]) => [id, 'valide'])), calme: 'attente' };
  m.ecran.mettreAJour(valeurEnfants({ timo: presque, parent: ['calme'] }), ms);
  m.ecran.ouvrirEnfant('timo');
  gesteParent(t, visageDe(m, 0));
  await laisser();
  assert.equal(visibles(m.conteneur, 'parent').length, 1);
  m.ecran.mettreAJour(valeurEnfants({ timo: { ...presque, calme: 'valide' }, parent: ['calme'], points: { solde: 38, aujourdhui: 1, libres_restants: 10 } }), ms + 5000);
  assert.deepEqual(m.sons.joues, [], 'rien pendant le mode parent');
  toucher(visibles(m.conteneur, 'enfants-bandeau-fermer')[0]);
  assert.equal(parClasse(m.conteneur, 'quete-coffre')[0].getAttribute('aria-label'), 'Coffre ouvert');
  assert.deepEqual(m.sons.joues, ['coffre'], 'la fête à la fermeture, quand la quête revient');
  toucher(visibles(m.conteneur, 'enfants-onglet')[1]);
  assert.deepEqual(m.sons.joues, ['coffre', 'point'], 'le point qui monte, vu sur l\'onglet Points');
  toucher(visibles(m.conteneur, 'enfants-onglet')[0]);
  toucher(visibles(m.conteneur, 'enfants-onglet')[1]);
  assert.deepEqual(m.sons.joues, ['coffre', 'point'], 'une seule fois');
});

test('visages du haut : l\'étoile « fini » seulement sur celui de l\'enfant affiché (jamais l\'ourson étoilé à côté du renard)', (t) => {
  const m = monter(t);
  m.ecran.mettreAJour(valeurEnfants({ pablo: { 'petit-dejeuner': 'valide', dents: 'valide', chaussures: 'valide' } }), paris('07:45'));
  m.ecran.ouvrirEnfant('timo');
  const etoiles = () => visibles(m.conteneur, 'enfants-visage-avatar').map((a) => visibles(a, 'avatar-etoile').length);
  assert.deepEqual(etoiles(), [0, 0], 'écran de Timo : pas d\'étoile pour Pablo');
  toucher(visibles(m.conteneur, 'enfants-visage')[1]);
  assert.deepEqual(etoiles(), [0, 1], 'écran de Pablo : son étoile');
});

test('refus du serveur : une ligne courte et douce (« Pas encore assez de points ») ; un double toucher (« déjà cochée ») ne dit rien', async (t) => {
  let reponse = { ok: false, statut: 409, message: 'Le serveur a refusé', code: 'points_insuffisants' };
  const m = monter(t, { ms: paris('17:00'), reponses: { '/api/enfants/timo/echanges': () => reponse, '/api/enfants/timo/etapes/dents': { ok: false, statut: 409, code: 'deja_cochee' } } });
  m.ecran.mettreAJour(valeurEnfants(), paris('17:00'));
  m.ecran.ouvrirEnfant('timo');
  appuiLong(t, parEtiquette(m.conteneur, 'quete-case', 'Dents'));
  await laisser();
  assert.equal(visibles(m.conteneur, 'enfants-message').length, 0);
  toucher(visibles(m.conteneur, 'enfants-onglet')[1]);
  appuiLong(t, visibles(m.conteneur, 'boutique-vouloir')[0]);
  await laisser();
  assert.deepEqual(visibles(m.conteneur, 'enfants-message').map(texte), ['Pas encore assez de points']);
  t.mock.timers.tick(4000);
  assert.equal(visibles(m.conteneur, 'enfants-message').length, 0, 'effacée au bout de 4 s');
  reponse = { ok: false, statut: 0, message: 'Pas de réponse du serveur', code: null };
  appuiLong(t, visibles(m.conteneur, 'boutique-vouloir')[0]);
  await laisser();
  assert.deepEqual(visibles(m.conteneur, 'enfants-message').map(texte), ['Pas de réponse, rien n\'a changé']);
});

test('quitter l\'écran : menu rendu, mode parent refermé ; l\'entrée revient à la prochaine ouverture', async (t) => {
  const ms = paris('07:20');
  const m = monter(t, { ms, reponses: { '/api/enfants/parent': jetonOk(ms) } });
  m.ecran.mettreAJour(valeurEnfants(), ms);
  m.ecran.ouvrirEnfant('timo');
  gesteParent(t, visageDe(m, 0));
  await laisser();
  assert.equal(visibles(m.conteneur, 'parent').length, 1);
  m.ecran.quitter();
  assert.equal(m.pleinEcran[m.pleinEcran.length - 1], false);
  m.ecran.entrer();
  assert.deepEqual([visibles(m.conteneur, 'enfants-carte').length, visibles(m.conteneur, 'enfants-mode').length], [2, 0]);
  m.ecran.ouvrirEnfant('timo');
  assert.equal(visibles(m.conteneur, 'parent').length, 0, 'le mode parent ne survit pas à la sortie');
});

test('Accueil : de 5 h à 10 h 30, la case des deux visages remplace Wi-Fi invités (et passe avant la case Tempo) ; chaque visage ouvre son tableau', () => {
  const { conteneur } = installerFauxDom();
  const ouverts = [];
  const accueil = creerAccueil(conteneur, {
    ouvrirRecette() {}, ouvrirCourses() {}, ouvrirMinuteurs() {}, ouvrirMaison() {}, ouvrirAujourdhui() {}, ouvrirEnfant: (id) => ouverts.push(id),
  });
  const donnees = {
    ha: null, entites: {}, courses: null, air: null, pluie: null, semaine: null, meteo: null, menu: null, agenda: null,
    enfants: valeurEnfants({ timo: Object.fromEntries(ETAPES_TIMO.map(([id]) => [id, 'valide'])) }),
  };
  const encart = { etiquette: 'Aujourd\'hui', badges: [] };
  const tempoRouge = { couleur: 'rouge', creuses: false, nom: 'Demain rouge', detail: null };
  accueil.mettreAJour({ ...vueAccueil(donnees, paris('07:40')), tempo: tempoRouge }, encart);
  const caseEnfants = parClasse(conteneur, 'case-enfants')[0];
  const wifi = parClasse(conteneur, 'bouton-maison').filter((b) => texte(b).includes('Wi-Fi'))[0];
  assert.deepEqual([visible(caseEnfants), visible(wifi), visible(parClasse(conteneur, 'case-tempo')[0])], [true, false, false]);
  const visages = visibles(caseEnfants, 'case-enfants-visage');
  assert.deepEqual(visages.map((v) => v.getAttribute('aria-label')), ['Tableau de Timo, routine finie', 'Tableau de Pablo']);
  assert.deepEqual(visages.map((v) => visibles(v, 'avatar-etoile').length), [1, 0], 'pas de chiffre, une étoile pour la routine finie');
  poser(visages[1]);
  assert.deepEqual(ouverts, ['pablo']);
  accueil.mettreAJour({ ...vueAccueil(donnees, paris('10:30')), tempo: tempoRouge }, encartAujourdhui({
    rendezVous: { etat: 'ok', lignes: [], plus: 0, journee: null }, rappels: { lignes: [], plus: 0 }, alertes: { lignes: [], plus: 0 },
  }));
  assert.deepEqual([visible(caseEnfants), visible(parClasse(conteneur, 'case-tempo')[0])], [false, true], '10 h 30 : la case Tempo revient');
});

test('pastille du minuteur d\'écran : visage et minutes restantes, ouvre son tableau au pointerdown ; masquée sans minuteur', () => {
  const { conteneur } = installerFauxDom();
  const ouverts = [];
  const pastille = creerPastilleEcran(conteneur, { ouvrir: (id) => ouverts.push(id) });
  pastille.mettreAJour({
    id: 'timo', prenom: 'Timo', avatar: 'i-renard', couleur: 'enfant-timo', nombre: '12', unite: 'min',
  });
  assert.equal(conteneur.hidden, false);
  assert.equal(texte(parClasse(conteneur, 'pastille-ecran-temps')[0]), '12min');
  assert.equal(conteneur.getAttribute('aria-label'), 'Timo regarde : encore 12 min');
  poser(conteneur);
  assert.deepEqual(ouverts, ['timo']);
  pastille.mettreAJour(null);
  assert.equal(conteneur.hidden, true);
});

test('fin de la vidéo : « Fin de la vidéo, puis on éteint » par-dessus tout, son doux une seule fois, fermé d\'un toucher', () => {
  const { conteneur } = installerFauxDom();
  const fermees = [];
  const joues = [];
  const fin = creerFinVideo(conteneur, { fermer: (cle) => fermees.push(cle), sons: { jouer: (nom) => joues.push(nom) } });
  const vue = {
    id: 'timo', prenom: 'Timo', avatar: 'i-renard', couleur: 'enfant-timo', cle: 'timo@1', sonner: true,
  };
  fin.mettreAJour(vue);
  fin.mettreAJour(vue);
  assert.deepEqual([fin.estVisible(), joues], [true, ['fin']]);
  assert.deepEqual([texte(parClasse(conteneur, 'fin-video-titre')[0]), texte(parClasse(conteneur, 'fin-video-texte')[0])], ['Fin de la vidéo', 'puis on éteint']);
  poser(conteneur);
  assert.deepEqual([fin.estVisible(), fermees], [false, ['timo@1']]);
  fin.mettreAJour(null);
  assert.equal(fin.estVisible(), false);
});

test('menu : l\'entrée Enfants ouvre son écran ; chaque couleur du barème a sa règle dans avatar.css', () => {
  const { conteneur } = installerFauxDom();
  const navigations = [];
  creerMenu(conteneur, { surNavigation: (nom) => navigations.push(nom) });
  const entree = parClasse(conteneur, 'menu-entree').filter((b) => texte(b) === 'Enfants')[0];
  poser(entree);
  assert.deepEqual(navigations, ['enfants']);
  const feuille = readFileSync(new URL('../web/styles/avatar.css', import.meta.url), 'utf8');
  for (const { couleur } of chargerBareme().enfants) {
    assert.match(feuille, new RegExp(`\\.couleur-${couleur} \\{\\s*background: var\\(--${couleur}\\);`), `.couleur-${couleur} absente`);
  }
});
