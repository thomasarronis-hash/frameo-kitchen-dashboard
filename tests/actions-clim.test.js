// tests/actions-clim.test.js
//
// Rôle    : prouver les commandes des clims (serveur/ha/actions-clim.js) et leur passage par la route POST /api/action/:nom :
//           climate et switch réservés aux entités de CLIMS (verifierActions), simulation par défaut SANS aucun appel à la
//           connexion HA, ACTIONS_CLIM=1 qui appelle le bon service sur l'entité FIGÉE au démarrage (jamais lue dans le
//           corps) avec la bonne donnée, corps refusés (400), clim ou option non configurée (404), valeur que la clim
//           n'accepte pas, clim indisponible ou option non modifiable (503), consigne contrôlée contre les bornes et le pas
//           ACTUELS (400), écart de 2 s par commande et budget de 120 par heure (429 trop_tot), échec de HA (502).
// Entrées : CLIMS lue par lireClims ; états HA au format relevé le 16/10 (intégration Bosch HomeCom), projetés par
//           projeterClims ; une fausse connexion qui note chaque appel ; une fausse horloge monotone.
// Sorties : node --test.
// Pièges  : la fausse connexion n'est pas une ConnexionHA : son verrou (ACTIONS_CLIM, couples permis) est prouvé dans
//           tests/garde-fous.test.js. Ici, on prouve que actions-clim.js ne l'appelle JAMAIS en simulation, et l'appelle
//           comme il faut en réel.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lireClims } from '../serveur/config.js';
import { verifierActions } from '../serveur/ha/actions.js';
import {
  ACTIONS_CLIM, BUDGET_HORAIRE, creerActionsClim, ECART_MS,
} from '../serveur/ha/actions-clim.js';
import { projeterClims } from '../serveur/ha/clims.js';
import { CLE, monter } from './aides.js';

const CLIMS = lireClims({
  CLIMS: 'Salon: climat=climate.clim_salon, eco=switch.clim_salon_eco, boost=switch.clim_salon_boost ; '
    + 'Étage: climat=climate.clim_etage',
});
const climat = (state = 'cool', attributs = {}) => ({
  state,
  attributes: {
    hvac_modes: ['off', 'cool', 'heat', 'auto', 'dry', 'fan_only'],
    min_temp: 16,
    max_temp: 30,
    target_temp_step: 1,
    fan_modes: ['quiet', 'low', 'medium', 'high', 'turbo', 'auto'],
    swing_modes: ['off', 'on'],
    swing_horizontal_modes: ['off', 'on'],
    temperature: 25,
    fan_mode: 'auto',
    swing_mode: 'off',
    swing_horizontal_mode: 'off',
    ...attributs,
  },
});
const etatsHA = (remplacer = {}) => ({
  'climate.clim_salon': climat(),
  'switch.clim_salon_eco': { state: 'off', attributes: { writable_now: true } },
  'switch.clim_salon_boost': { state: 'off', attributes: { writable_now: false } },
  'climate.clim_etage': climat('off', { swing_horizontal_modes: undefined }),
  ...remplacer,
});

function journalCapture() {
  const lignes = [];
  return { lignes, info: (m) => lignes.push(m), warn: (m) => lignes.push(m), error: (m) => lignes.push(m) };
}

function fausseConnexion({ echec = null } = {}) {
  const appels = [];
  const noter = (methode) => async (service, entite, donnees) => {
    appels.push({ methode, service, entite, donnees });
    if (echec) throw new Error(echec);
  };
  return {
    appels, ecrireClim: noter('ecrireClim'), ecrireVoiture: noter('ecrireVoiture'), ecrireMaison: noter('ecrireMaison'), ecrire: noter('ecrire'),
  };
}

function preparer({ reelles = false, echec, etats = etatsHA(), clims = CLIMS } = {}) {
  const connexion = fausseConnexion({ echec });
  const journal = journalCapture();
  const horloge = { ms: 0 };
  const source = { valeur: projeterClims(etats, clims) };
  const actions = creerActionsClim({
    connexion, clims, source, reelles, journal, monotone: () => horloge.ms,
  });
  const changerEtats = (nouveaux) => { source.valeur = projeterClims(nouveaux, clims); };
  return {
    connexion, journal, horloge, actions, changerEtats,
  };
}

const refusAvec = (statusCode, code) => (err) => {
  assert.equal(err.statusCode, statusCode, err.message);
  assert.equal(err.code, code, err.message);
  return true;
};

test('verifierActions : climate et switch réservés aux entités de CLIMS, avec les seuls services des clims', () => {
  const action = (domaine, service, entite) => ({ x: { domaine, service, entity_id: entite } });
  const clim = { clim: ['climate.clim_salon', 'switch.clim_salon_eco'] };
  const refus = [
    [action('climate', 'set_hvac_mode', 'climate.clim_salon'), {}],
    [action('switch', 'turn_on', 'switch.clim_salon_eco'), {}],
    [action('climate', 'set_hvac_mode', 'climate.autre'), clim],
    [action('switch', 'turn_on', 'switch.prise_four'), clim],
    [action('climate', 'set_preset_mode', 'climate.clim_salon'), clim],
    [action('switch', 'toggle', 'switch.clim_salon_eco'), clim],
  ];
  for (const [table, options] of refus) {
    assert.throws(() => verifierActions(table, options), /réservé aux clims de CLIMS/, JSON.stringify(table));
  }
  assert.throws(() => verifierActions(action('switch', 'turn_off', 'switch.freebox_wifi'), { clim: ['switch.freebox_wifi'] }), /entité interdite/);
  assert.doesNotThrow(() => verifierActions(action('climate', 'set_temperature', 'climate.clim_salon'), clim));
  assert.doesNotThrow(() => verifierActions(action('switch', 'turn_off', 'switch.clim_salon_eco'), clim));
});

test('la table : six actions, corps sans entity_id ; une option de CLIMS qui viserait la Freebox est refusée au démarrage', () => {
  assert.deepEqual(Object.keys(ACTIONS_CLIM), ['clim_marche', 'clim_mode', 'clim_consigne', 'clim_ventilation', 'clim_oscillation', 'clim_option']);
  for (const { schema } of Object.values(ACTIONS_CLIM)) {
    assert.equal(schema.additionalProperties, false);
    assert.ok(!Object.keys(schema.properties).some((cle) => /entit/.test(cle)), 'le corps ne désigne jamais une entité');
  }
  const freebox = lireClims({ CLIMS: 'Salon: climat=climate.clim_salon, eco=switch.freebox_wifi' });
  assert.throws(() => preparer({ clims: freebox }), /entité interdite switch\.freebox_wifi/);
  assert.equal(preparer({ clims: [] }).actions.simulation, true, 'sans clim : table vide, rien à refuser');
});

test('simulation par défaut : réponse de même forme, AUCUN appel à la connexion, journal « simulation »', async () => {
  const { connexion, journal, horloge, actions } = preparer();
  assert.equal(actions.simulation, true);
  const essais = [
    ['clim_marche', { clim: 'Salon', marche: false }, 'Salon · arrêt (climate.turn_off)'],
    ['clim_mode', { clim: 'Salon', mode: 'heat' }, 'Salon · mode heat (climate.set_hvac_mode)'],
    ['clim_consigne', { clim: 'Salon', valeur: 21 }, 'Salon · consigne 21 (climate.set_temperature)'],
    ['clim_ventilation', { clim: 'Étage', ventilation: 'turbo' }, 'Étage · ventilation turbo (climate.set_fan_mode)'],
    ['clim_oscillation', { clim: 'Salon', sens: 'horizontale', actif: true }, 'Salon · oscillation horizontale on (climate.set_swing_horizontal_mode)'],
    ['clim_option', { clim: 'Salon', option: 'eco', actif: true }, 'Salon · eco activée (switch.turn_on)'],
  ];
  for (const [nom, corps, detail] of essais) {
    horloge.ms += 1;
    assert.deepEqual(await actions.executer(nom, corps), { ok: true, simulation: true }, detail);
    assert.equal(journal.lignes.at(-1), `simulation : ${detail}, rien n'est envoyé à la clim`);
  }
  assert.deepEqual(connexion.appels, [], 'la connexion HA ne doit jamais être appelée en simulation');
});

test('ACTIONS_CLIM=1 : le bon service sur l\'entité FIGÉE de CLIMS, avec la bonne donnée', async () => {
  const { connexion, horloge, actions } = preparer({ reelles: true });
  const essais = [
    ['clim_marche', { clim: 'Étage', marche: true }, ['climate.turn_on', 'climate.clim_etage', {}]],
    ['clim_mode', { clim: 'Salon', mode: 'dry' }, ['climate.set_hvac_mode', 'climate.clim_salon', { hvac_mode: 'dry' }]],
    ['clim_consigne', { clim: 'Salon', valeur: 19 }, ['climate.set_temperature', 'climate.clim_salon', { temperature: 19 }]],
    ['clim_ventilation', { clim: 'Salon', ventilation: 'quiet' }, ['climate.set_fan_mode', 'climate.clim_salon', { fan_mode: 'quiet' }]],
    ['clim_oscillation', { clim: 'Salon', sens: 'verticale', actif: true }, ['climate.set_swing_mode', 'climate.clim_salon', { swing_mode: 'on' }]],
    ['clim_oscillation', { clim: 'Salon', sens: 'horizontale', actif: false }, ['climate.set_swing_horizontal_mode', 'climate.clim_salon', { swing_horizontal_mode: 'off' }]],
    ['clim_option', { clim: 'Salon', option: 'eco', actif: false }, ['switch.turn_off', 'switch.clim_salon_eco', {}]],
  ];
  for (const [nom, corps, [service, entite, donnees]] of essais) {
    horloge.ms += 1;
    assert.deepEqual(await actions.executer(nom, corps), { ok: true, simulation: false });
    assert.deepEqual(connexion.appels.at(-1), {
      methode: 'ecrireClim', service, entite, donnees,
    }, nom);
  }
});

test('corps refusés (400) avant tout appel : entité dans le corps, valeur inconnue, mauvais type, champ en trop', async () => {
  const { connexion, actions } = preparer({ reelles: true });
  const refus = [
    ['clim_mode', { clim: 'Salon', mode: 'heat_cool' }],
    ['clim_mode', { clim: 'Salon', mode: 'cool', entity_id: 'climate.autre' }],
    ['clim_marche', { clim: 'Salon', marche: 'oui' }],
    ['clim_consigne', { clim: 'Salon', valeur: '21' }],
    ['clim_consigne', { clim: 'Salon', valeur: 99 }],
    ['clim_ventilation', { clim: 'Salon', ventilation: 'diffuse' }],
    ['clim_oscillation', { clim: 'Salon', sens: 'diagonale', actif: true }],
    ['clim_option', { clim: 'Salon', option: 'alarme', actif: true }],
    ['clim_option', { clim: '', option: 'eco', actif: true }],
  ];
  for (const [nom, corps] of refus) {
    await assert.rejects(actions.executer(nom, corps), refusAvec(400, 'corps_invalide'), JSON.stringify(corps));
  }
  assert.deepEqual(connexion.appels, []);
});

test('clim ou option non configurée : 404 ; nom d\'action inconnu ou hérité d\'Object : 404 ; rien d\'appelé', async () => {
  const { connexion, actions } = preparer({ reelles: true });
  await assert.rejects(actions.executer('clim_marche', { clim: 'Garage', marche: true }), refusAvec(404, 'clim_inconnue'));
  await assert.rejects(actions.executer('clim_option', { clim: 'Étage', option: 'eco', actif: true }), refusAvec(404, 'commande_absente'));
  await assert.rejects(actions.executer('clim_option', { clim: 'Salon', option: 'sommeil', actif: true }), refusAvec(404, 'commande_absente'));
  for (const nom of ['constructor', '__proto__', 'clim_preset']) {
    await assert.rejects(actions.executer(nom, {}), refusAvec(404, 'action_inconnue'), nom);
  }
  assert.equal(actions.connait('clim_mode'), true);
  assert.equal(actions.connait('voiture_commande'), false);
  assert.deepEqual(connexion.appels, []);
});

test('valeurs contrôlées contre ce que la clim accepte MAINTENANT : 503 sinon, et ça passe quand elle l\'accepte', async () => {
  const { connexion, horloge, actions, changerEtats } = preparer({ reelles: true });
  await assert.rejects(actions.executer('clim_oscillation', { clim: 'Étage', sens: 'horizontale', actif: true }), refusAvec(503, 'commande_indisponible'));
  await assert.rejects(actions.executer('clim_option', { clim: 'Salon', option: 'boost', actif: true }), refusAvec(503, 'commande_indisponible'), 'writable_now false');
  changerEtats(etatsHA({ 'climate.clim_salon': climat('cool', { hvac_modes: ['off', 'cool'], fan_modes: ['auto'] }) }));
  await assert.rejects(actions.executer('clim_mode', { clim: 'Salon', mode: 'heat' }), refusAvec(503, 'commande_indisponible'));
  await assert.rejects(actions.executer('clim_ventilation', { clim: 'Salon', ventilation: 'turbo' }), refusAvec(503, 'commande_indisponible'));
  changerEtats(etatsHA({ 'climate.clim_salon': { state: 'unavailable', attributes: {} } }));
  await assert.rejects(actions.executer('clim_marche', { clim: 'Salon', marche: true }), refusAvec(503, 'commande_indisponible'));
  await assert.rejects(actions.executer('clim_consigne', { clim: 'Salon', valeur: 20 }), refusAvec(503, 'commande_indisponible'));
  assert.deepEqual(connexion.appels, []);
  changerEtats(etatsHA({ 'switch.clim_salon_boost': { state: 'off', attributes: { writable_now: true } } }));
  horloge.ms += 1;
  assert.deepEqual(await actions.executer('clim_option', { clim: 'Salon', option: 'boost', actif: true }), { ok: true, simulation: false });
});

test('consigne : contrôlée contre min, max et pas ACTUELS (400) ; consigne pas encore lue : 503', async () => {
  const { horloge, actions, changerEtats } = preparer();
  for (const valeur of [15, 31, 21.5]) {
    await assert.rejects(actions.executer('clim_consigne', { clim: 'Salon', valeur }), refusAvec(400, 'corps_invalide'), String(valeur));
  }
  changerEtats(etatsHA({ 'climate.clim_salon': climat('heat', { target_temp_step: 0.5 }) }));
  horloge.ms += 1;
  assert.deepEqual(await actions.executer('clim_consigne', { clim: 'Salon', valeur: 21.5 }), { ok: true, simulation: true });
  changerEtats(etatsHA({ 'climate.clim_salon': climat('heat', { temperature: null }) }));
  await assert.rejects(actions.executer('clim_consigne', { clim: 'Salon', valeur: 21 }), refusAvec(503, 'bornes_inconnues'));
});

test('écart par commande : la même au plus toutes les 2 s (429), les autres passent ; en simulation aussi', async () => {
  const { horloge, actions } = preparer();
  const mode = { clim: 'Salon', mode: 'heat' };
  assert.equal((await actions.executer('clim_mode', mode)).ok, true);
  await assert.rejects(actions.executer('clim_mode', { clim: 'Salon', mode: 'cool' }), refusAvec(429, 'trop_tot'), 'le mode compte, quelle que soit sa valeur');
  assert.equal((await actions.executer('clim_mode', { clim: 'Étage', mode: 'cool' })).ok, true, 'autre clim');
  assert.equal((await actions.executer('clim_option', { clim: 'Salon', option: 'eco', actif: true })).ok, true, 'autre commande');
  assert.equal((await actions.executer('clim_oscillation', { clim: 'Salon', sens: 'verticale', actif: true })).ok, true);
  assert.equal((await actions.executer('clim_oscillation', { clim: 'Salon', sens: 'horizontale', actif: true })).ok, true, 'chaque sens à part');
  horloge.ms += ECART_MS;
  assert.equal((await actions.executer('clim_mode', mode)).ok, true);
});

test('budget horaire : 120 commandes par heure glissante, toutes clims confondues, 429 au-delà ; un refus ne consomme rien', async () => {
  const { horloge, actions } = preparer();
  for (let i = 0; i < BUDGET_HORAIRE; i += 1) {
    horloge.ms += ECART_MS;
    await actions.executer('clim_consigne', { clim: i % 2 ? 'Salon' : 'Étage', valeur: 20 });
  }
  horloge.ms += ECART_MS;
  await assert.rejects(actions.executer('clim_marche', { clim: 'Salon', marche: true }), refusAvec(429, 'trop_tot'));
  horloge.ms = 3_600_000 + ECART_MS;
  assert.equal((await actions.executer('clim_marche', { clim: 'Salon', marche: true })).ok, true, 'la première est sortie de l\'heure');
});

test('échec de HA : 502 et journal ; le créneau reste pris', async () => {
  const { journal, horloge, actions } = preparer({ reelles: true, echec: 'Bosch cloud unreachable' });
  await assert.rejects(actions.executer('clim_marche', { clim: 'Salon', marche: true }), refusAvec(502, 'action_echouee'));
  assert.match(journal.lignes.at(-1), /Salon · marche : échec de climate\.turn_on \(Bosch cloud unreachable\)/);
  horloge.ms += 1;
  await assert.rejects(actions.executer('clim_marche', { clim: 'Salon', marche: true }), refusAvec(429, 'trop_tot'));
});

// Route : commandes simulées montées sur l'application, à côté des tables par défaut (tests/aides.js).
async function monterRoute(t) {
  const { actions: actionsClim, journal } = preparer();
  const monte = await monter({ actionsClim });
  t.after(() => monte.app.close());
  const poster = (nom, corps, cle = CLE) => monte.app.inject({
    method: 'POST', url: `/api/action/${nom}`, headers: { ...(cle ? { 'x-cadre-cle': cle } : {}), 'content-type': 'application/json' }, payload: corps,
  });
  return { ...monte, poster, journalClim: journal };
}

test('route : commande simulée 200, refus en JSON { erreur, message } (400, 404, 429), sans clé 401 ; les autres tables intactes', async (t) => {
  const { poster, journalClim } = await monterRoute(t);
  let reponse = await poster('clim_mode', { clim: 'Salon', mode: 'heat' });
  assert.equal(reponse.statusCode, 200);
  assert.deepEqual(reponse.json(), { ok: true, simulation: true });
  assert.equal(reponse.headers['cache-control'], 'no-store');
  reponse = await poster('clim_mode', { clim: 'Salon', mode: 'cool' });
  assert.deepEqual([reponse.statusCode, reponse.json().erreur], [429, 'trop_tot']);
  reponse = await poster('clim_marche', { clim: 'Garage', marche: true });
  assert.deepEqual([reponse.statusCode, reponse.json().erreur], [404, 'clim_inconnue']);
  reponse = await poster('clim_consigne', { clim: 'Salon', valeur: 40 });
  assert.deepEqual([reponse.statusCode, reponse.json().erreur], [400, 'corps_invalide']);
  assert.equal((await poster('clim_marche', { clim: 'Salon', marche: true }, null)).statusCode, 401);
  assert.match(journalClim.lignes.join('\n'), /simulation : Salon · mode heat \(climate\.set_hvac_mode\)/);
  assert.equal((await poster('tv_touche', { touche: 'MUTE' })).statusCode, 200);
  assert.equal((await poster('alarme_desarmer', { code: '0000' })).statusCode, 404);
});
