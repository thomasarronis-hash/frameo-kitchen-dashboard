// tests/etat-flux.test.js
//
// Rôle    : prouver le magasin d'état (web/src/etat.js) et la liaison avec le serveur (web/src/api.js) :
//           fusion des fragments d'entités, instantané qui remplace tout (menu et mode simulation compris),
//           événement menu, chien de garde de 45 s qui recrée l'EventSource, réglage de l'horloge sur
//           heure_serveur, événement illisible ignoré, « Cadre non appairé » sur un 401 (et pas sur un 5xx ni une
//           coupure), envoi des actions (POST) et leurs erreurs en français, abandon d'un POST sans réponse au
//           bout du délai (10 s dans la page), abandon d'une lecture (GET) dont le corps cale après les en-têtes.
// Entrées : une fausse EventSource, un faux fetch et une fausse horloge monotone (aucun réseau, aucun DOM).
// Sorties : node --test.
// Pièges  : le silence se compte depuis le dernier message reçu ET depuis la dernière ouverture : une
//           connexion recréée a droit à 45 s avant d'être recréée à nouveau.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creerClient, creerFlux, SILENCE_MAX_MS } from '../web/src/api.js';
import { creerEtat } from '../web/src/etat.js';
import { creerHorloge } from '../web/src/heure.js';

const soleil = (elevation) => ({ state: 'above_horizon', last_changed: '2026-10-11T05:49:51Z', attributes: { elevation } });

test('instantané : toutes les clés connues, entités comprises ; abonnés prévenus', () => {
  const etat = creerEtat();
  const appels = [];
  etat.abonner((donnees) => appels.push(donnees));
  assert.deepEqual(etat.lire(), {
    ha: null, entites: {}, meteo: null, courses: null, agenda: null, sonnette: null, air: null, pluie: null, semaine: null, menu: null, draps: null, tempo: null, voitures: null, clims: null, enfants: null, simulation: null, simulation_maison: null, simulation_voiture: null, simulation_clim: null, direct_video: null, photos_configurees: null, empreinte: null,
  });
  const sonnette = { dernier_coup: null, photo: 'inconnue', photo_le: null };
  const draps = { timo: '2026-10-12', pablo: null, parents: null };
  const tempo = { jours: [], restants: null, saison: null, source: null, lu_le: null };
  const voitures = [{ nom: 'Mégane', batterie: 72, autonomie: null, branchee: true, charge: null, vu_le: null, fin_charge: null }];
  const enfants = { journee: '2026-10-14', depart: '08:10', enfants: [] };
  const clims = [{ nom: 'Salon', disponible: true, mode: 'off' }];
  etat.recevoirInstantane({
    heure_serveur: 1, ha: 'ok', simulation: true, simulation_maison: true, simulation_voiture: true, simulation_clim: true, direct_video: false, photos_configurees: true, empreinte: 'abc', entites: { 'sun.sun': soleil(30) }, courses: { articles: [] }, agenda: { calendriers: [], evenements: [] }, sonnette, semaine: { jours: [] }, menu: { version: 1 }, draps, tempo, voitures, clims, enfants, inconnue: 1,
  });
  assert.equal(appels.length, 1);
  assert.deepEqual(etat.lire(), {
    ha: 'ok', entites: { 'sun.sun': soleil(30) }, meteo: null, courses: { articles: [] }, agenda: { calendriers: [], evenements: [] }, sonnette, air: null, pluie: null, semaine: { jours: [] }, menu: { version: 1 }, draps, tempo, voitures, clims, enfants, simulation: true, simulation_maison: true, simulation_voiture: true, simulation_clim: true, direct_video: false, photos_configurees: true, empreinte: 'abc',
  });
});

test('maj : fragments d\'entités fusionnés (null retire), autres clés remplacées, clés inconnues ignorées', () => {
  const etat = creerEtat();
  etat.recevoirInstantane({ ha: 'ok', entites: { 'sun.sun': soleil(30), 'todo.shopping_list': { state: '0', last_changed: '', attributes: {} } } });
  etat.recevoirMaj({ entites: { 'sun.sun': soleil(10) } });
  etat.recevoirMaj({ entites: { 'todo.shopping_list': null } });
  etat.recevoirMaj({ ha: 'ko' });
  etat.recevoirMaj({ air: { actuel: {} }, inconnue: 2 });
  assert.deepEqual(etat.lire().entites, { 'sun.sun': soleil(10) });
  assert.equal(etat.lire().ha, 'ko');
  assert.deepEqual(etat.lire().air, { actuel: {} });
  assert.equal('inconnue' in etat.lire(), false);
});

test('un nouvel instantané remplace tout : une entité disparue pendant une coupure ne reste pas', () => {
  const etat = creerEtat();
  etat.recevoirInstantane({ ha: 'ok', entites: { 'sun.sun': soleil(30), 'camera.sonnette_derniere_photo': { state: 'idle', last_changed: '', attributes: {} } }, air: { a: 1 } });
  etat.recevoirInstantane({ ha: 'ok', entites: { 'sun.sun': soleil(31) } });
  assert.deepEqual(etat.lire().entites, { 'sun.sun': soleil(31) });
  assert.equal(etat.lire().air, null);
});

// Fausse EventSource : note les ouvertures et rejoue des événements nommés ; readyState 2 = abandonnée (CLOSED).
function fausseConnexion() {
  const sources = [];
  const ouvrirSource = (url) => {
    const source = {
      url, fermee: false, ecouteurs: {}, readyState: 1,
      addEventListener(nom, rappel) { this.ecouteurs[nom] = rappel; },
      close() { this.fermee = true; },
      emettre(nom, donnees) { this.ecouteurs[nom]({ data: typeof donnees === 'string' ? donnees : JSON.stringify(donnees) }); },
    };
    sources.push(source);
    return source;
  };
  return { sources, ouvrirSource };
}

function monter({ statutCle = 200 } = {}) {
  let temps = 0;
  const monotone = () => temps;
  const avancer = (ms) => { temps += ms; };
  let locale = 1_000_000;
  const horloge = creerHorloge(() => locale);
  const etat = creerEtat();
  const { sources, ouvrirSource } = fausseConnexion();
  const verifications = [];
  const verifierCle = () => {
    verifications.push(statutCle);
    return statutCle instanceof Error ? Promise.reject(statutCle) : Promise.resolve(statutCle);
  };
  const flux = creerFlux({ url: '/api/flux', etat, horloge, monotone, ouvrirSource, verifierCle });
  return { flux, etat, horloge, sources, avancer, verifications, avancerLocale: (ms) => { locale += ms; } };
}

test('flux : ouverture de /api/flux, instantané et maj vers le magasin, horloge réglée sur heure_serveur', () => {
  const { flux, etat, horloge, sources } = monter();
  flux.demarrer();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, '/api/flux');
  sources[0].emettre('instantane', { heure_serveur: 5_000_000, ha: 'ok', entites: {} });
  assert.equal(etat.lire().ha, 'ok');
  assert.equal(horloge.maintenant(), 5_000_000);
  sources[0].emettre('maj', { ha: 'ko' });
  assert.equal(etat.lire().ha, 'ko');
  sources[0].emettre('ping', { heure_serveur: 6_000_000 });
  assert.equal(horloge.maintenant(), 6_000_000);
});

test('chien de garde : rien pendant 45 s, connexion recréée au-delà, puis pas avant 45 s de plus', () => {
  const { flux, sources, avancer } = monter();
  flux.demarrer();
  sources[0].emettre('instantane', { heure_serveur: 1, ha: 'ok', entites: {} });
  avancer(20_000);
  sources[0].emettre('ping', { heure_serveur: 2 });
  avancer(SILENCE_MAX_MS);
  flux.verifier();
  assert.equal(sources.length, 1, '45 s pile après le ping : pas encore');
  assert.equal(flux.silenceMs(), SILENCE_MAX_MS);
  avancer(1);
  flux.verifier();
  assert.equal(sources.length, 2, 'au-delà de 45 s : connexion recréée');
  assert.equal(sources[0].fermee, true, 'l\'ancienne est fermée');
  avancer(30_000);
  flux.verifier();
  assert.equal(sources.length, 2, 'la nouvelle connexion a droit à 45 s');
  avancer(15_001);
  flux.verifier();
  assert.equal(sources.length, 3, 'toujours muette 45 s après sa création : recréée');
  sources[2].emettre('instantane', { heure_serveur: 3, ha: 'ok', entites: {} });
  assert.equal(flux.silenceMs(), 0);
});

test('un événement au JSON illisible est ignoré, sans compter comme une réception', (t) => {
  const avertissements = t.mock.method(console, 'warn', () => {});
  const { flux, etat, sources, avancer } = monter();
  flux.demarrer();
  avancer(10_000);
  sources[0].emettre('maj', '{pas du json');
  assert.equal(avertissements.mock.callCount(), 1);
  assert.equal(etat.lire().ha, null);
  assert.equal(flux.silenceMs(), 10_000);
});

test('événement menu : rangé comme une maj (publication, puis menu retiré)', () => {
  const { flux, etat, sources } = monter();
  flux.demarrer();
  sources[0].emettre('instantane', { heure_serveur: 1, ha: 'ok', entites: {}, menu: null, simulation: true });
  sources[0].emettre('menu', { menu: { version: 1, statut: 'commande' } });
  assert.deepEqual(etat.lire().menu, { version: 1, statut: 'commande' });
  assert.equal(etat.lire().simulation, true, 'le reste ne bouge pas');
  sources[0].emettre('menu', { menu: null });
  assert.equal(etat.lire().menu, null);
});

const attendreMicrotaches = () => new Promise((resoudre) => setImmediate(resoudre));

test('« Cadre non appairé » : flux abandonné puis 401 sur la vérification ; effacé au premier message reçu', async () => {
  const { flux, sources, verifications } = monter({ statutCle: 401 });
  flux.demarrer();
  sources[0].emettre('error', {});
  await attendreMicrotaches();
  assert.deepEqual(verifications, [], 'erreur passagère (readyState CONNECTING) : pas de vérification');
  sources[0].readyState = 2;
  sources[0].emettre('error', {});
  await attendreMicrotaches();
  assert.deepEqual(verifications, [401]);
  assert.equal(flux.nonAppaire(), true);
  sources[0].emettre('ping', { heure_serveur: 1 });
  assert.equal(flux.nonAppaire(), false, 'la clé est de nouveau acceptée');
});

test('un 5xx ou une erreur réseau à la vérification ne disent pas « non appairé » ; un vieux flux remplacé est ignoré', async () => {
  for (const statut of [502, new Error('réseau')]) {
    const { flux, sources } = monter({ statutCle: statut });
    flux.demarrer();
    sources[0].readyState = 2;
    sources[0].emettre('error', {});
    await attendreMicrotaches();
    assert.equal(flux.nonAppaire(), false, String(statut));
  }
  const { flux, sources, verifications, avancer } = monter({ statutCle: 401 });
  flux.demarrer();
  avancer(SILENCE_MAX_MS + 1);
  flux.verifier();
  sources[0].readyState = 2;
  sources[0].emettre('error', {});
  await attendreMicrotaches();
  assert.deepEqual(verifications, [], 'erreur de l\'ancienne connexion, déjà remplacée');
  flux.signalerNonAppaire();
  assert.equal(flux.nonAppaire(), true, 'signalé par un POST refusé (401)');
});

// Faux fetch : rend la réponse demandée et note la requête.
function fauxFetch(reponse) {
  const requetes = [];
  const requete = (url, options) => {
    requetes.push({ url, ...options, corps: options.body === undefined ? undefined : JSON.parse(options.body) });
    if (reponse instanceof Error) return Promise.reject(reponse);
    return Promise.resolve({ ok: reponse.status < 300, status: reponse.status, json: () => (reponse.json === undefined ? Promise.reject(new Error('vide')) : Promise.resolve(reponse.json)) });
  };
  return { requetes, requete };
}

test('POST : corps JSON, réponse rendue telle quelle si elle est bonne', async () => {
  const { requetes, requete } = fauxFetch({ status: 200, json: { ok: true, simulation: true } });
  const client = creerClient({ requete, surNonAppaire: () => assert.fail('pas de 401') });
  assert.deepEqual(await client.poster('/api/action/courses_ajouter', { texte: 'lait' }), { ok: true, donnees: { ok: true, simulation: true } });
  assert.equal(requetes[0].method, 'POST');
  assert.equal(requetes[0].headers['content-type'], 'application/json');
  assert.deepEqual(requetes[0].corps, { texte: 'lait' });
  assert.equal(requetes[0].cache, 'no-store');
  assert.ok(requetes[0].signal instanceof AbortSignal, 'requête annulable');
});

test('en-têtes en plus (jeton du mode parent des enfants) : ajoutés au POST comme au GET, sans retirer le type JSON', async () => {
  const { requetes, requete } = fauxFetch({ status: 200, json: { ok: true } });
  const client = creerClient({ requete, surNonAppaire: () => assert.fail('pas de 401') });
  await client.poster('/api/enfants/timo/points', { motif: null }, { 'x-cadre-parent': 'abc' });
  await client.lire('/api/enfants/historique', { 'x-cadre-parent': 'abc' });
  await client.lire('/api/wifi-invites');
  assert.deepEqual(requetes[0].headers, { 'content-type': 'application/json', 'x-cadre-parent': 'abc' });
  assert.deepEqual([requetes[1].method, requetes[1].headers], ['GET', { 'x-cadre-parent': 'abc' }]);
  assert.equal(requetes[2].headers, undefined, 'sans en-tête demandé, aucun');
});

test('GET (lire) : sans corps, no-store, même lecture des réponses et des erreurs que POST', async () => {
  const { requetes, requete } = fauxFetch({ status: 200, json: { configure: false } });
  const client = creerClient({ requete, surNonAppaire: () => assert.fail('pas de 401') });
  assert.deepEqual(await client.lire('/api/wifi-invites'), { ok: true, donnees: { configure: false } });
  assert.deepEqual([requetes[0].url, requetes[0].method, requetes[0].body, requetes[0].cache, requetes[0].credentials], ['/api/wifi-invites', 'GET', undefined, 'no-store', 'same-origin']);
  const refuse = creerClient({ requete: fauxFetch({ status: 502, json: { erreur: 'photo_indisponible', message: 'HA répond 500' } }).requete, surNonAppaire: () => {} });
  assert.deepEqual(await refuse.lire('/api/wifi-invites'), {
    ok: false, statut: 502, message: 'La maison n\'a pas pu le faire (HA répond 500)', code: 'photo_indisponible',
  });
});

test('POST resté sans réponse : abandonné au bout du délai (requête coupée), message « pas de réponse », jamais de rejet', async () => {
  let signalRecu = null;
  const pendante = (_url, options) => {
    signalRecu = options.signal;
    return new Promise(() => {});
  };
  const client = creerClient({ requete: pendante, surNonAppaire: () => assert.fail('pas de 401'), delaiMs: 30 });
  const debut = Date.now();
  assert.deepEqual(await client.poster('/api/action/courses_cocher', { uid: 'a', fait: true }), {
    ok: false, statut: 0, message: 'Pas de réponse du serveur, rien n\'a été changé', code: null,
  });
  assert.ok(Date.now() - debut >= 25, 'pas avant le délai');
  assert.equal(signalRecu.aborted, true, 'la requête est coupée');
});

test('lecture dont le corps cale après les en-têtes (Wi-Fi du cadre, 14/10) : abandonnée au bout du délai ; un POST s\'arrête aux en-têtes', async () => {
  let signalRecu = null;
  const corpsCale = (_url, options) => {
    signalRecu = options.signal;
    return Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) });
  };
  const client = creerClient({ requete: corpsCale, surNonAppaire: () => assert.fail('pas de 401'), delaiMs: 30 });
  const debut = Date.now();
  assert.deepEqual(await client.lire('/api/photos/lot'), {
    ok: false, statut: 0, message: 'Pas de réponse du serveur, rien n\'a été changé', code: null,
  });
  assert.ok(Date.now() - debut >= 25, 'pas avant le délai');
  assert.equal(signalRecu.aborted, true, 'la lecture est coupée');
  let lu = false;
  const corpsLent = () => Promise.resolve({ ok: true, status: 200, json: () => new Promise((resoudre) => setTimeout(() => { lu = true; resoudre({ ok: true }); }, 60)) });
  const poste = creerClient({ requete: corpsLent, surNonAppaire: () => assert.fail('pas de 401'), delaiMs: 30 });
  assert.deepEqual(await poste.poster('/api/enfants/timo/points', {}), { ok: true, donnees: { ok: true } }, 'en-têtes reçus à temps : l\'action est faite, son corps est attendu');
  assert.equal(lu, true);
});

test('POST : erreurs lisibles (401 signalé, 400 avec le message du serveur, 502, 429, réseau coupé), jamais de rejet', async () => {
  let signale = 0;
  const cas = [
    [{ status: 401, json: { erreur: 'non_appaire' } }, 401, 'Cadre non appairé : le serveur ne reconnaît pas sa clé', 'non_appaire'],
    [{ status: 400, json: { erreur: 'corps_invalide', message: 'corps invalide pour courses_ajouter' } }, 400, 'Le serveur a refusé (corps invalide pour courses_ajouter)', 'corps_invalide'],
    [{ status: 502, json: { erreur: 'action_echouee', message: 'article introuvable dans la liste : u1' } }, 502, 'La maison n\'a pas pu le faire (article introuvable dans la liste : u1)', 'action_echouee'],
    [{ status: 409, json: { erreur: 'points_insuffisants' } }, 409, 'Le serveur a refusé', 'points_insuffisants'],
    [{ status: 429 }, 429, 'Trop d\'actions d\'affilée : réessayer dans une minute', null],
    [{ status: 500 }, 500, 'Le serveur a refusé', null],
    [new Error('réseau'), 0, 'Pas de réponse du serveur, rien n\'a été changé', null],
  ];
  for (const [reponse, statut, message, code] of cas) {
    const client = creerClient({ requete: fauxFetch(reponse).requete, surNonAppaire: () => { signale += 1; } });
    assert.deepEqual(await client.poster('/api/drive-pret', {}), {
      ok: false, statut, message, code,
    });
  }
  assert.equal(signale, 1, 'seul le 401 dit « non appairé »');
});
