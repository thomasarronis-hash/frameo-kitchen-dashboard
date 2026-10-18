// tests/actions-voiture.test.js
//
// Rôle    : prouver les commandes de la voiture (serveur/ha/actions-voiture.js) et leur passage par la route
//           POST /api/action/:nom : button et number réservés aux entités des rôles de commande de VOITURES (verifierActions),
//           simulation par défaut SANS aucun appel à la connexion HA, ACTIONS_VOITURE=1 qui appelle button.press ou
//           number.set_value sur l'entité FIGÉE au démarrage (jamais lue dans le corps), corps refusés (400), voiture ou
//           commande non configurée (404), commande indisponible ou bornes inconnues (503), valeur contrôlée contre les
//           bornes et le pas ACTUELS (400), écart de 30 s par commande et 10 s par réglage, budget de 10 commandes par
//           heure glissante toutes voitures confondues (429 trop_tot, quota Renault), échec de HA (502) journalisé sans
//           entity_id.
// Entrées : VOITURES à plaque factice (ab_123_cd, comme tests/voitures.test.js) lue par lireVoitures ; états HA au format
//           relevé le 14/10, projetés par projeterVoitures ; une fausse connexion qui note chaque appel ; une fausse horloge
//           monotone.
// Sorties : node --test.
// Pièges  : la fausse connexion n'est pas une ConnexionHA : son verrou (ACTIONS_VOITURE, couples permis) est prouvé dans
//           tests/connexion.test.js et tests/garde-fous.test.js. Ici, on prouve que actions-voiture.js ne l'appelle JAMAIS
//           en simulation, et l'appelle comme il faut en réel.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lireVoitures } from '../serveur/config.js';
import { verifierActions } from '../serveur/ha/actions.js';
import {
  ACTIONS_VOITURE, BUDGET_HORAIRE, creerActionsVoiture, ECART_COMMANDE_MS, ECART_REGLAGE_MS,
} from '../serveur/ha/actions-voiture.js';
import { projeterVoitures } from '../serveur/ha/voitures.js';
import { CLE, monter } from './aides.js';

const VOITURES = lireVoitures({
  VOITURES: 'Mégane: batterie=sensor.ab_123_cd_batterie, branchee=binary_sensor.ab_123_cd_branchee, '
    + 'charger=button.ab_123_cd_commencer_la_charge, clim=button.ab_123_cd_demarrer_la_climatisation, '
    + 'phares=button.ab_123_cd_faire_un_appel_de_phares, klaxon=button.ab_123_cd_klaxonner, '
    + 'charge_min=number.ab_123_cd_niveau_de_charge_minimal, charge_cible=number.ab_123_cd_niveau_de_charge_cible ; '
    + 'Zoé: batterie=sensor.zoe_batterie, branchee=binary_sensor.zoe_prise, klaxon=button.zoe_klaxon',
});
const bouton = (state = 'unknown') => ({ state, attributes: { friendly_name: 'AB-123-CD Bouton' } });
const reglage = (state, min, max, step = 5) => ({ state, attributes: { min, max, step, mode: 'slider', unit_of_measurement: '%' } });
const etatsHA = (remplacer = {}) => ({
  'button.ab_123_cd_commencer_la_charge': bouton(),
  'button.ab_123_cd_demarrer_la_climatisation': bouton('2026-10-14T07:12:00+00:00'),
  'button.ab_123_cd_faire_un_appel_de_phares': bouton(),
  'button.ab_123_cd_klaxonner': bouton(),
  'number.ab_123_cd_niveau_de_charge_minimal': reglage('45', 15, 45),
  'number.ab_123_cd_niveau_de_charge_cible': reglage('100', 55, 100),
  'button.zoe_klaxon': bouton(),
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
    appels, ecrireVoiture: noter('ecrireVoiture'), ecrireMaison: noter('ecrireMaison'), ecrire: noter('ecrire'), lire: noter('lire'),
  };
}

function preparer({ reelles = false, echec, etats = etatsHA(), voitures = VOITURES } = {}) {
  const connexion = fausseConnexion({ echec });
  const journal = journalCapture();
  const horloge = { ms: 0 };
  const source = { valeur: projeterVoitures(etats, voitures) };
  const actions = creerActionsVoiture({
    connexion, voitures, source, reelles, journal, monotone: () => horloge.ms,
  });
  const changerEtats = (nouveaux) => { source.valeur = projeterVoitures(nouveaux, voitures); };
  return {
    connexion, journal, horloge, actions, changerEtats,
  };
}

const commande = (nomCommande, voiture = 'Mégane') => ({ voiture, commande: nomCommande });
const niveau = (reglageVise, valeur, voiture = 'Mégane') => ({ voiture, reglage: reglageVise, valeur });
const refusAvec = (statusCode, code) => (err) => {
  assert.equal(err.statusCode, statusCode, err.message);
  assert.equal(err.code, code, err.message);
  assert.doesNotMatch(err.message, /ab_123_cd|zoe_/, `entity_id cité : ${err.message}`);
  return true;
};

test('verifierActions : button et number réservés aux entités de commande données, avec button.press et number.set_value seulement', () => {
  const action = (domaine, service, entite) => ({ x: { domaine, service, entity_id: entite } });
  const voiture = { voiture: ['button.ab_123_cd_klaxonner', 'number.ab_123_cd_niveau_de_charge_cible'] };
  const refus = [
    [action('button', 'press', 'button.ab_123_cd_klaxonner'), {}],
    [action('number', 'set_value', 'number.ab_123_cd_niveau_de_charge_cible'), {}],
    [action('button', 'press', 'button.ab_123_cd_commencer_la_charge'), voiture],
    [action('number', 'set_value', 'number.ab_123_cd_niveau_de_charge_minimal'), voiture],
    [action('number', 'increment', 'number.ab_123_cd_niveau_de_charge_cible'), voiture],
    [action('button', 'turn_on', 'button.ab_123_cd_klaxonner'), voiture],
  ];
  for (const [table, options] of refus) {
    assert.throws(() => verifierActions(table, options), (err) => {
      assert.match(err.message, /réservé aux commandes de voiture de VOITURES/);
      assert.doesNotMatch(err.message, /ab_123_cd/, 'jamais l\'entité (plaque) dans le message');
      return true;
    }, JSON.stringify(table));
  }
  assert.throws(() => verifierActions(action('button', 'press', 'button.freebox_reboot'), { voiture: ['button.freebox_reboot'] }), /entité interdite/);
  assert.throws(() => verifierActions(action('alarm_control_panel', 'alarm_disarm', 'alarm_control_panel.alarme_maison'), voiture), /domaine interdit/);
  assert.doesNotThrow(() => verifierActions(action('button', 'press', 'button.ab_123_cd_klaxonner'), voiture));
  assert.doesNotThrow(() => verifierActions(action('number', 'set_value', 'number.ab_123_cd_niveau_de_charge_cible'), voiture));
});

test('la table : deux actions, corps sans entity_id ; une commande de VOITURES qui viserait la Freebox est refusée au démarrage', () => {
  assert.deepEqual(Object.keys(ACTIONS_VOITURE), ['voiture_commande', 'voiture_niveau']);
  for (const { schema } of Object.values(ACTIONS_VOITURE)) {
    assert.equal(schema.additionalProperties, false);
    assert.ok(!Object.keys(schema.properties).some((cle) => /entit/.test(cle)), 'le corps ne désigne jamais une entité');
  }
  const freebox = lireVoitures({ VOITURES: 'Mégane: batterie=sensor.m_b, branchee=binary_sensor.m_p, klaxon=button.freebox_reboot' });
  assert.throws(() => preparer({ voitures: freebox }), /entité interdite button\.freebox_reboot/);
  assert.equal(preparer({ voitures: [] }).actions.simulation, true, 'sans voiture : table vide, rien à refuser');
});

test('simulation par défaut : réponse de même forme, AUCUN appel à la connexion, journal « simulation » sans entity_id', async () => {
  const { connexion, journal, horloge, actions } = preparer();
  assert.equal(actions.simulation, true);
  const essais = [
    ['voiture_commande', commande('charger'), 'Mégane · charger, button.press'],
    ['voiture_commande', commande('clim'), 'Mégane · clim, button.press'],
    ['voiture_commande', commande('phares'), 'Mégane · phares, button.press'],
    ['voiture_commande', commande('klaxon'), 'Mégane · klaxon, button.press'],
    ['voiture_commande', commande('klaxon', 'Zoé'), 'Zoé · klaxon, button.press'],
    ['voiture_niveau', niveau('charge_min', 30), 'Mégane · charge_min, number.set_value 30'],
    ['voiture_niveau', niveau('charge_cible', 80), 'Mégane · charge_cible, number.set_value 80'],
  ];
  for (const [nom, corps, detail] of essais) {
    horloge.ms += 1;
    assert.deepEqual(await actions.executer(nom, corps), { ok: true, simulation: true }, detail);
    assert.equal(journal.lignes.at(-1), `simulation : ${nom} (${detail}), rien n'est envoyé à la voiture`);
  }
  assert.deepEqual(connexion.appels, [], 'la connexion HA ne doit jamais être appelée en simulation');
  assert.doesNotMatch(journal.lignes.join('\n'), /ab_123_cd|zoe_/);
});

test('ACTIONS_VOITURE=1 : button.press ou number.set_value sur l\'entité FIGÉE de VOITURES, avec la bonne donnée', async () => {
  const { connexion, journal, actions } = preparer({ reelles: true });
  assert.equal(actions.simulation, false);
  const cas = [
    ['voiture_commande', commande('charger'), 'button.press', 'button.ab_123_cd_commencer_la_charge', {}],
    ['voiture_commande', commande('clim'), 'button.press', 'button.ab_123_cd_demarrer_la_climatisation', {}],
    ['voiture_commande', commande('phares'), 'button.press', 'button.ab_123_cd_faire_un_appel_de_phares', {}],
    ['voiture_commande', commande('klaxon'), 'button.press', 'button.ab_123_cd_klaxonner', {}],
    ['voiture_commande', commande('klaxon', 'Zoé'), 'button.press', 'button.zoe_klaxon', {}],
    ['voiture_niveau', niveau('charge_min', 15), 'number.set_value', 'number.ab_123_cd_niveau_de_charge_minimal', { value: 15 }],
    ['voiture_niveau', niveau('charge_cible', 100), 'number.set_value', 'number.ab_123_cd_niveau_de_charge_cible', { value: 100 }],
  ];
  for (const [nom, corps, service, entite, donnees] of cas) {
    connexion.appels.length = 0;
    assert.deepEqual(await actions.executer(nom, corps), { ok: true, simulation: false }, JSON.stringify(corps));
    assert.deepEqual(connexion.appels, [{ methode: 'ecrireVoiture', service, entite, donnees }], JSON.stringify(corps));
  }
  assert.equal(journal.lignes.at(-1), 'voiture_niveau : Mégane · charge_cible (number.set_value 100)');
  assert.doesNotMatch(journal.lignes.join('\n'), /ab_123_cd|zoe_/);
});

test('corps refusés (400) avant tout appel : entité dans le corps, commande ou réglage inconnus, valeur pas entière, champ en trop', async () => {
  const invalides = [
    ['voiture_commande', { voiture: 'Mégane', commande: 'klaxon', entity_id: 'button.ab_123_cd_commencer_la_charge' }],
    ['voiture_commande', { voiture: 'Mégane', commande: 'button.ab_123_cd_klaxonner' }],
    ['voiture_commande', { voiture: 'Mégane', commande: 'ouvrir' }],
    ['voiture_commande', { voiture: 'Mégane', commande: 'charge_min' }],
    ['voiture_commande', { voiture: 'Mégane', commande: 'Klaxon' }],
    ['voiture_commande', { commande: 'klaxon' }],
    ['voiture_commande', { voiture: '', commande: 'klaxon' }],
    ['voiture_commande', { voiture: 'Mégane', commande: 'klaxon', confirmation: true }],
    ['voiture_niveau', { voiture: 'Mégane', reglage: 'klaxon', valeur: 30 }],
    ['voiture_niveau', { voiture: 'Mégane', reglage: 'charge_max', valeur: 30 }],
    ['voiture_niveau', { voiture: 'Mégane', reglage: 'charge_min', valeur: 30.5 }],
    ['voiture_niveau', { voiture: 'Mégane', reglage: 'charge_min', valeur: '30' }],
    ['voiture_niveau', { voiture: 'Mégane', reglage: 'charge_min', valeur: -5 }],
    ['voiture_niveau', { voiture: 'Mégane', reglage: 'charge_min', valeur: 105 }],
    ['voiture_niveau', { voiture: 'Mégane', reglage: 'charge_min' }],
    ['voiture_niveau', null],
  ];
  for (const reelles of [false, true]) {
    const { connexion, actions } = preparer({ reelles });
    for (const [nom, corps] of invalides) {
      await assert.rejects(actions.executer(nom, corps), refusAvec(400, 'corps_invalide'), `${nom} ${JSON.stringify(corps)}`);
    }
    assert.deepEqual(connexion.appels, []);
  }
});

test('voiture ou commande non configurée : 404 clair ; nom d\'action inconnu : 404 ; rien d\'appelé', async () => {
  for (const reelles of [false, true]) {
    const { connexion, actions } = preparer({ reelles });
    await assert.rejects(actions.executer('voiture_commande', commande('klaxon', 'Twingo')), refusAvec(404, 'voiture_inconnue'));
    await assert.rejects(actions.executer('voiture_commande', commande('charger', 'Zoé')), (err) => {
      assert.deepEqual([err.statusCode, err.code, err.message], [404, 'commande_absente', 'Zoé · charger : pas dans VOITURES']);
      return true;
    });
    await assert.rejects(actions.executer('voiture_niveau', niveau('charge_cible', 80, 'Zoé')), refusAvec(404, 'commande_absente'));
    for (const nom of ['__proto__', 'constructor', 'voiture_klaxon', 'alarme_desarmer']) {
      assert.equal(actions.connait(nom), false, nom);
      await assert.rejects(actions.executer(nom, commande('klaxon')), refusAvec(404, 'action_inconnue'), nom);
    }
    assert.deepEqual(connexion.appels, []);
  }
  assert.deepEqual(['voiture_commande', 'voiture_niveau', 'appletv_touche', 'courses_ajouter', undefined].map(preparer().actions.connait),
    [true, true, false, false, false]);
});

test('commande indisponible ou réglage pas encore lu : 503, rien d\'appelé ; de nouveau disponible : ça passe', async () => {
  const indisponible = { state: 'unavailable', attributes: {} };
  const { connexion, actions, changerEtats } = preparer({
    reelles: true,
    etats: etatsHA({ 'button.ab_123_cd_klaxonner': indisponible, 'number.ab_123_cd_niveau_de_charge_minimal': reglage('unknown', 15, 45) }),
  });
  await assert.rejects(actions.executer('voiture_commande', commande('klaxon')), refusAvec(503, 'commande_indisponible'));
  await assert.rejects(actions.executer('voiture_niveau', niveau('charge_min', 30)), refusAvec(503, 'bornes_inconnues'));
  changerEtats({});
  await assert.rejects(actions.executer('voiture_commande', commande('phares')), refusAvec(503, 'commande_indisponible'), 'intégration absente');
  assert.deepEqual(connexion.appels, []);
  changerEtats(etatsHA());
  assert.deepEqual(await actions.executer('voiture_commande', commande('klaxon')), { ok: true, simulation: false }, 'aucun créneau consommé par les refus');
});

test('niveaux : valeur contrôlée contre min, max et step ACTUELS (400 hors bornes ou hors du pas) ; bornes qui changent suivies', async () => {
  const { connexion, horloge, actions, changerEtats } = preparer({ reelles: true });
  const refuses = [10, 50, 32, 14, 46];
  for (const valeur of refuses) {
    await assert.rejects(actions.executer('voiture_niveau', niveau('charge_min', valeur)), (err) => {
      assert.deepEqual([err.statusCode, err.code], [400, 'corps_invalide'], String(valeur));
      assert.match(err.message, /Mégane · charge_min de 15 à 45, par pas de 5/);
      return true;
    });
  }
  await assert.rejects(actions.executer('voiture_niveau', niveau('charge_cible', 50)), refusAvec(400, 'corps_invalide'), 'cible sous 55');
  for (const valeur of [15, 30, 45]) {
    horloge.ms += ECART_REGLAGE_MS;
    assert.deepEqual(await actions.executer('voiture_niveau', niveau('charge_min', valeur)), { ok: true, simulation: false }, String(valeur));
  }
  assert.deepEqual(connexion.appels.map((appel) => appel.donnees.value), [15, 30, 45], 'les refus n\'ont rien envoyé');
  changerEtats(etatsHA({ 'number.ab_123_cd_niveau_de_charge_minimal': reglage('20', 10, 40, 10) }));
  horloge.ms += ECART_REGLAGE_MS;
  await assert.rejects(actions.executer('voiture_niveau', niveau('charge_min', 45)), refusAvec(400, 'corps_invalide'), 'nouveau max 40');
  await assert.rejects(actions.executer('voiture_niveau', niveau('charge_min', 15)), refusAvec(400, 'corps_invalide'), 'nouveau pas 10');
  assert.deepEqual(await actions.executer('voiture_niveau', niveau('charge_min', 40)), { ok: true, simulation: false });
});

test('écart par rôle (quota Renault) : même commande au plus toutes les 30 s, même réglage toutes les 10 s, 429 trop_tot ; en simulation aussi', async () => {
  for (const reelles of [false, true]) {
    const { connexion, horloge, actions } = preparer({ reelles });
    const klaxon = () => actions.executer('voiture_commande', commande('klaxon'));
    assert.equal((await klaxon()).ok, true);
    horloge.ms = ECART_COMMANDE_MS - 1;
    await assert.rejects(klaxon(), (err) => {
      assert.deepEqual([err.statusCode, err.code], [429, 'trop_tot']);
      assert.equal(err.message, 'trop tôt : Mégane · klaxon au plus toutes les 30 s (quota de l\'API Renault), réessayer dans 1 s');
      return true;
    });
    assert.equal((await actions.executer('voiture_commande', commande('phares'))).ok, true, 'une autre commande a son propre créneau');
    assert.equal((await actions.executer('voiture_commande', commande('klaxon', 'Zoé'))).ok, true, 'une autre voiture aussi');
    horloge.ms = ECART_COMMANDE_MS;
    assert.equal((await klaxon()).ok, true, '30 s pile : de nouveau permis');

    horloge.ms = 100_000;
    assert.equal((await actions.executer('voiture_niveau', niveau('charge_min', 30))).ok, true);
    horloge.ms += ECART_REGLAGE_MS - 1;
    await assert.rejects(actions.executer('voiture_niveau', niveau('charge_min', 35)), refusAvec(429, 'trop_tot'));
    assert.equal((await actions.executer('voiture_niveau', niveau('charge_cible', 80))).ok, true, 'l\'autre réglage a son propre créneau');
    horloge.ms += 1;
    assert.equal((await actions.executer('voiture_niveau', niveau('charge_min', 35))).ok, true, '10 s pile');
    await assert.rejects(actions.executer('voiture_niveau', niveau('charge_cible', 7)), refusAvec(400, 'corps_invalide'));
    assert.equal(connexion.appels.length, reelles ? 7 : 0);
  }
});

test('budget horaire (quota Renault) : 10 commandes par heure glissante, rôles et voitures confondus, 429 au-delà ; en simulation aussi', async () => {
  const HEURE_MS = 3_600_000;
  const tour = [
    ['voiture_commande', commande('klaxon')], ['voiture_commande', commande('phares')], ['voiture_commande', commande('clim')],
    ['voiture_commande', commande('charger')], ['voiture_niveau', niveau('charge_min', 30)],
    ['voiture_niveau', niveau('charge_cible', 80)], ['voiture_commande', commande('klaxon', 'Zoé')],
  ];
  const refusBudget = (minutes) => (err) => {
    assert.deepEqual([err.statusCode, err.code], [429, 'trop_tot']);
    assert.equal(err.message, `trop tôt : 10 commandes par heure au plus pour les voitures (quota de l'API Renault), réessayer dans ${minutes} min`);
    return true;
  };
  assert.equal(BUDGET_HORAIRE, 10);
  for (const reelles of [false, true]) {
    const { connexion, horloge, actions } = preparer({ reelles });
    for (let i = 0; i < BUDGET_HORAIRE; i += 1) {
      horloge.ms = i * ECART_COMMANDE_MS;
      const [nom, corps] = tour[i % tour.length];
      assert.equal((await actions.executer(nom, corps)).ok, true, `appel ${i + 1} à ${horloge.ms} ms`);
      if (i === 0) await assert.rejects(actions.executer(nom, corps), refusAvec(429, 'trop_tot'), 'refus de l\'écart : budget pas consommé');
    }
    horloge.ms = BUDGET_HORAIRE * ECART_COMMANDE_MS;
    await assert.rejects(actions.executer('voiture_commande', commande('charger')), refusBudget(55), 'écart du rôle respecté, budget épuisé');
    await assert.rejects(actions.executer('voiture_commande', commande('klaxon', 'Zoé')), refusBudget(55), 'l\'autre voiture aussi');
    await assert.rejects(actions.executer('voiture_niveau', niveau('charge_min', 35)), refusBudget(55), 'les réglages aussi');
    horloge.ms = HEURE_MS - 1;
    await assert.rejects(actions.executer('voiture_commande', commande('charger')), refusBudget(1));
    horloge.ms = HEURE_MS;
    assert.equal((await actions.executer('voiture_commande', commande('charger'))).ok, true,
      'le premier appel sort de l\'heure ; le refus 1 ms plus tôt n\'a pas pris le créneau de 30 s du rôle');
    await assert.rejects(actions.executer('voiture_commande', commande('clim')), refusBudget(1), 'de nouveau 10 dans l\'heure');
    horloge.ms = HEURE_MS + ECART_COMMANDE_MS;
    assert.equal((await actions.executer('voiture_commande', commande('clim'))).ok, true, 'le deuxième sort à son tour');
    assert.equal(connexion.appels.length, reelles ? BUDGET_HORAIRE + 2 : 0);
  }
});

test('échec de HA : 502 sans entity_id, journal où chaque entity_id est remplacé par « voiture · rôle » ; le créneau reste pris', async () => {
  const echec = 'number.set_value : Value 50 for number.ab_123_cd_niveau_de_charge_minimal is outside valid range 15 - 45 '
    + '(sensor.ab_123_cd_batterie)';
  const { journal, horloge, actions } = preparer({ reelles: true, echec });
  await assert.rejects(actions.executer('voiture_niveau', niveau('charge_min', 30)), (err) => {
    assert.deepEqual([err.statusCode, err.code], [502, 'action_echouee']);
    assert.equal(err.message, 'Mégane · charge_min : Home Assistant n\'a pas pris la commande (détail au journal du serveur)');
    return true;
  });
  assert.equal(journal.lignes.at(-1), 'voiture_niveau : Mégane · charge_min, échec de number.set_value (number.set_value : Value 50 for '
    + 'Mégane · charge_min is outside valid range 15 - 45 (Mégane · batterie))');
  horloge.ms += 1;
  await assert.rejects(actions.executer('voiture_niveau', niveau('charge_min', 30)), refusAvec(429, 'trop_tot'), 'un appel raté a pu partir vers Renault');
});

// Route : commandes simulées montées sur l'application, à côté des actions maison et courses par défaut (tests/aides.js).
async function monterRoute(t) {
  const { actions: actionsVoiture, journal } = preparer();
  const monte = await monter({ actionsVoiture });
  t.after(() => monte.app.close());
  const poster = (nom, corps, cle = CLE) => monte.app.inject({
    method: 'POST', url: `/api/action/${nom}`, headers: { ...(cle ? { 'x-cadre-cle': cle } : {}), 'content-type': 'application/json' }, payload: corps,
  });
  return { ...monte, poster, journalVoiture: journal };
}

test('route : commande simulée 200, réglage 200, refus en JSON { erreur, message } (400, 404, 429), sans clé 401', async (t) => {
  const { poster, journal, journalVoiture } = await monterRoute(t);
  let reponse = await poster('voiture_commande', commande('klaxon'));
  assert.equal(reponse.statusCode, 200);
  assert.deepEqual(reponse.json(), { ok: true, simulation: true });
  assert.equal(reponse.headers['cache-control'], 'no-store');
  assert.equal((await poster('voiture_niveau', niveau('charge_cible', 80))).statusCode, 200);
  reponse = await poster('voiture_commande', commande('klaxon'));
  assert.equal(reponse.statusCode, 429);
  assert.equal(reponse.json().erreur, 'trop_tot');
  reponse = await poster('voiture_commande', commande('klaxon', 'Twingo'));
  assert.deepEqual([reponse.statusCode, reponse.json().erreur], [404, 'voiture_inconnue']);
  reponse = await poster('voiture_niveau', niveau('charge_min', 47));
  assert.deepEqual([reponse.statusCode, reponse.json().erreur], [400, 'corps_invalide']);
  assert.equal((await poster('voiture_commande', commande('phares'), null)).statusCode, 401);
  assert.match(journalVoiture.lignes.join('\n'), /simulation : voiture_commande \(Mégane · klaxon, button\.press\)/);
  assert.doesNotMatch(journal() + journalVoiture.lignes.join('\n'), /ab_123_cd/);
});

test('route : les autres tables gardent leurs actions (maison, courses), l\'alarme reste inconnue', async (t) => {
  const { poster } = await monterRoute(t);
  assert.equal((await poster('tv_touche', { touche: 'MUTE' })).statusCode, 200);
  assert.equal((await poster('alarme_desarmer', { code: '0000' })).statusCode, 404);
  assert.equal((await poster('voiture_commande', { touche: 'MUTE' })).statusCode, 400, 'un corps maison ne passe pas pour la voiture');
});
