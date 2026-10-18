// tests/voitures.test.js
//
// Rôle    : prouver les voitures côté serveur : la variable VOITURES (serveur/config.js, lireVoitures : format valide,
//           rôles de commande avec leur domaine imposé, chaque refus avec un message qui ne cite jamais l'entity_id), la
//           projection (serveur/ha/voitures.js : nom de la configuration et jamais friendly_name, aucun entity_id, aucune
//           position, aucun kilométrage, aucun attribut brut ; états inconnus à null ; heure de fin de charge ; commandes
//           disponibles et niveaux de charge avec leurs bornes), les écritures permises (ecrituresVoitures) et
//           SourceVoitures branchée sur la vraie bibliothèque (maj seulement quand la projection change, pas à l'appui d'un
//           bouton ; rien demandé à HA sans voiture configurée).
// Entrées : états HA écrits ici au format de l'intégration Renault (entity_id avec une plaque factice AB-123-CD,
//           reconnaissable), y compris les entités interdites qu'elle crée aussi (device_tracker, kilométrage, boutons) ;
//           secrets factices de tests/fixtures/config (comme tests/config.test.js).
// Sorties : node --test.
// Pièges  : la fausse Connection rejoue des messages subscribe_entities au format compressé de HA (a, c), comme
//           tests/entites.test.js.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chargerConfig, lireVoitures } from '../serveur/config.js';
import { ecrituresVoitures, projeterVoitures, SourceVoitures } from '../serveur/ha/voitures.js';

const MEGANE = 'Mégane: batterie=sensor.ab_123_cd_batterie, branchee=binary_sensor.ab_123_cd_branchee, '
  + 'autonomie=sensor.ab_123_cd_autonomie, charge=sensor.ab_123_cd_etat_de_charge, '
  + 'activite=sensor.ab_123_cd_derniere_activite_de_la_batterie, restant=sensor.ab_123_cd_temps_de_charge_restant';
const COMMANDES = 'charger=button.ab_123_cd_commencer_la_charge, clim=button.ab_123_cd_demarrer_la_climatisation, '
  + 'phares=button.ab_123_cd_faire_un_appel_de_phares, klaxon=button.ab_123_cd_klaxonner, '
  + 'charge_min=number.ab_123_cd_niveau_de_charge_minimal, charge_cible=number.ab_123_cd_niveau_de_charge_cible';
const MEGANE_COMMANDES = `${MEGANE}, ${COMMANDES}`;
const SANS_NIVEAUX = { charge_min: null, charge_cible: null };
const lire = (valeur) => lireVoitures({ VOITURES: valeur });

test('VOITURES vide ou absente : aucune voiture (« Voiture pas encore reliée »)', () => {
  assert.deepEqual(lireVoitures({}), []);
  assert.deepEqual(lire('   '), []);
});

test('VOITURES valide : nom affiché, rôles et entités dans l\'ordre donné ; deux voitures séparées par « ; »', () => {
  assert.deepEqual(lire(MEGANE), [{
    nom: 'Mégane',
    entites: {
      batterie: 'sensor.ab_123_cd_batterie',
      branchee: 'binary_sensor.ab_123_cd_branchee',
      autonomie: 'sensor.ab_123_cd_autonomie',
      charge: 'sensor.ab_123_cd_etat_de_charge',
      activite: 'sensor.ab_123_cd_derniere_activite_de_la_batterie',
      restant: 'sensor.ab_123_cd_temps_de_charge_restant',
    },
  }]);
  const deux = lire(' Zoé:batterie=sensor.zoe_batterie,branchee=binary_sensor.zoe_prise ; R5 de Agathe : branchee = binary_sensor.r5_prise , batterie = sensor.r5_batterie ');
  assert.deepEqual(deux.map((v) => [v.nom, Object.keys(v.entites)]), [['Zoé', ['batterie', 'branchee']], ['R5 de Agathe', ['branchee', 'batterie']]]);
  assert.ok(Object.isFrozen(deux[0]) && Object.isFrozen(deux[0].entites));
});

test('VOITURES invalide : refus au démarrage, message en français qui cite le nom et le rôle mais jamais l\'entity_id', () => {
  const refus = [
    ['batterie=sensor.x_batterie,branchee=binary_sensor.x_prise', /nom affiché suivi de deux-points/],
    ['Une voiture au nom beaucoup trop long: batterie=sensor.x_b,branchee=binary_sensor.x_p', /nom affiché/],
    ['Mégane: batterie=sensor.ab_123_cd_batterie', /Mégane sans branchee/],
    ['Mégane: branchee=binary_sensor.ab_123_cd_branchee', /Mégane sans batterie/],
    ['Mégane: batterie=sensor.ab_123_cd_batterie,branchee=binary_sensor.ab_123_cd_branchee,vitesse=sensor.ab_123_cd_v', /rôle inconnu « vitesse »/],
    ['Mégane: batterie=sensor.ab_123_cd_batterie,branchee=binary_sensor.ab_123_cd_branchee,', /élément n° 3 sans rôle reconnu/],
    ['Mégane: sensor.ab_123_cd_batterie,branchee=binary_sensor.ab_123_cd_branchee', /élément n° 1 sans rôle reconnu \(forme rôle=entity_id\)/],
    ['Mégane: batterie:sensor.ab_123_cd_batterie,branchee=binary_sensor.ab_123_cd_branchee', /élément n° 1 sans rôle reconnu/],
    ['Mégane: batterie=sensor.ab_123_cd_batterie,batterie=sensor.ab_123_cd_b2,branchee=binary_sensor.ab_123_cd_branchee', /batterie est donné deux fois/],
    ['Mégane: batterie=binary_sensor.ab_123_cd_batterie,branchee=binary_sensor.ab_123_cd_branchee', /batterie : entity_id de sensor attendu/],
    ['Mégane: batterie=sensor.ab_123_cd_batterie,branchee=sensor.ab_123_cd_branchee', /branchee : entity_id de binary_sensor attendu/],
    ['Mégane: batterie=device_tracker.ab_123_cd_location,branchee=binary_sensor.ab_123_cd_branchee', /entity_id de sensor attendu/],
    ['Mégane: batterie=button.ab_123_cd_demarrer_la_charge,branchee=binary_sensor.ab_123_cd_branchee', /entity_id de sensor attendu/],
    ['Mégane: batterie=select.ab_123_cd_mode_de_charge,branchee=binary_sensor.ab_123_cd_branchee', /entity_id de sensor attendu/],
    ['Mégane: batterie=sensor.AB_123_cd_batterie,branchee=binary_sensor.ab_123_cd_branchee', /en minuscules/],
    ['Mégane: batterie=sensor.ab_123_cd_batterie=x,branchee=binary_sensor.ab_123_cd_branchee', /entity_id de sensor attendu/],
    ['Mégane: batterie=sensor.ab_123_cd_kilometrage,branchee=binary_sensor.ab_123_cd_branchee', /position et kilométrage ne sont jamais lus/],
    ['Mégane: batterie=sensor.ab_123_cd_batterie,branchee=binary_sensor.ab_123_cd_branchee,autonomie=sensor.ab_123_cd_mileage', /jamais lus/],
    ['Mégane: batterie=sensor.ab_123_cd_batterie,branchee=binary_sensor.ab_123_cd_branchee,activite=sensor.ab_123_cd_location_last_activity', /jamais lus/],
    ['A: batterie=sensor.a_b,branchee=binary_sensor.a_p; B: batterie=sensor.b_b,branchee=binary_sensor.b_p; C: batterie=sensor.c_b,branchee=binary_sensor.c_p', /2 voitures au plus/],
    ['Zoé: batterie=sensor.a_b,branchee=binary_sensor.a_p; Zoé: batterie=sensor.b_b,branchee=binary_sensor.b_p', /Zoé est donné deux fois/],
    ['A: batterie=sensor.a_b,branchee=binary_sensor.a_p; B: batterie=sensor.a_b,branchee=binary_sensor.b_p', /une même entité sert deux fois/],
  ];
  for (const [valeur, motif] of refus) {
    assert.throws(() => lire(valeur), (err) => {
      assert.match(err.message, /^VOITURES : /, valeur);
      assert.match(err.message, motif, valeur);
      assert.doesNotMatch(err.message, /ab_123_cd|AB_123|\.a_b|\.b_b/, `entity_id cité : ${err.message}`);
      return true;
    }, valeur);
  }
});

test('chargerConfig : voitures lues avec le reste, figées ; une valeur invalide empêche le démarrage', () => {
  const fixtures = (nom) => fileURLToPath(new URL(`./fixtures/config/${nom}`, import.meta.url));
  const env = {
    HA_JETON_FICHIER: fixtures('jeton-factice'), CLE_CADRE_FICHIER: fixtures('cle-factice'), CLE_CLEVO_FICHIER: fixtures('cle-clevo-factice'),
  };
  assert.deepEqual(chargerConfig(env).voitures, []);
  const config = chargerConfig({ ...env, VOITURES: MEGANE });
  assert.equal(config.voitures[0].nom, 'Mégane');
  assert.ok(Object.isFrozen(config.voitures));
  assert.throws(() => chargerConfig({ ...env, VOITURES: 'Mégane: batterie=sensor.x' }), /VOITURES : Mégane sans branchee/);
});

test('VOITURES avec les commandes (décision du 14/10) : charger, clim, phares, klaxon en button, charge_min et charge_cible en number', () => {
  const [megane] = lire(MEGANE_COMMANDES);
  assert.deepEqual(Object.keys(megane.entites), [
    'batterie', 'branchee', 'autonomie', 'charge', 'activite', 'restant', 'charger', 'clim', 'phares', 'klaxon', 'charge_min', 'charge_cible',
  ]);
  assert.equal(megane.entites.klaxon, 'button.ab_123_cd_klaxonner');
  assert.equal(megane.entites.charge_cible, 'number.ab_123_cd_niveau_de_charge_cible');
  const partielle = lire('Zoé: batterie=sensor.zoe_b, branchee=binary_sensor.zoe_p, klaxon=button.zoe_klaxon, charge_cible=number.zoe_cible')[0];
  assert.deepEqual(Object.keys(partielle.entites), ['batterie', 'branchee', 'klaxon', 'charge_cible'], 'chaque commande est facultative');
});

test('VOITURES, rôles de commande : domaine imposé par rôle, select et device_tracker toujours refusés, messages sans entity_id', () => {
  const base = 'Mégane: batterie=sensor.ab_123_cd_batterie, branchee=binary_sensor.ab_123_cd_branchee, ';
  const refus = [
    ['charger=sensor.ab_123_cd_commencer_la_charge', /Mégane, charger : entity_id de button attendu/],
    ['clim=number.ab_123_cd_demarrer_la_climatisation', /clim : entity_id de button attendu/],
    ['phares=switch.ab_123_cd_phares', /phares : entity_id de button attendu/],
    ['klaxon=select.ab_123_cd_klaxonner', /klaxon : entity_id de button attendu/],
    ['charge_min=button.ab_123_cd_niveau_de_charge_minimal', /charge_min : entity_id de number attendu/],
    ['charge_cible=select.ab_123_cd_mode_de_charge', /charge_cible : entity_id de number attendu/],
    ['charge_cible=device_tracker.ab_123_cd_location', /charge_cible : entity_id de number attendu/],
    ['batterie=button.ab_123_cd_klaxonner', /batterie est donné deux fois/],
    ['charger=button.ab_123_cd_location_refresh', /position et kilométrage ne sont jamais lus/],
    ['charge_min=number.ab_123_cd_gps', /jamais lus/],
    ['charge_maxi=number.ab_123_cd_niveau_de_charge_maximal', /rôle inconnu « charge_maxi »/],
    ['klaxon=button.ab_123_cd_klaxonner, klaxon=button.ab_123_cd_klaxonner_2', /klaxon est donné deux fois/],
    ['charger=button.ab_123_cd_x, clim=button.ab_123_cd_x', /une même entité sert deux fois/],
  ];
  for (const [suite, motif] of refus) {
    assert.throws(() => lire(base + suite), (err) => {
      assert.match(err.message, motif, suite);
      assert.doesNotMatch(err.message, /ab_123_cd/, `entity_id cité : ${err.message}`);
      return true;
    }, suite);
  }
});

// États au format de l'intégration Renault, entités interdites comprises (créées par HA sur le même appareil).
const QUAND = '2026-10-14T16:40:00+00:00';
function etatsRenault(remplacer = {}) {
  const etat = (state, attributes = {}) => ({ state, attributes: { friendly_name: 'AB-123-CD Quelque chose', ...attributes }, last_changed: QUAND });
  return {
    'sensor.ab_123_cd_batterie': etat('22', { unit_of_measurement: '%', device_class: 'battery' }),
    'binary_sensor.ab_123_cd_branchee': etat('off', { device_class: 'plug' }),
    'sensor.ab_123_cd_autonomie': etat('94.6', { unit_of_measurement: 'km' }),
    'sensor.ab_123_cd_etat_de_charge': etat('not_in_charge', { options: ['not_in_charge', 'charge_in_progress'] }),
    'sensor.ab_123_cd_derniere_activite_de_la_batterie': etat('2026-10-14T16:38:05+00:00', { device_class: 'timestamp' }),
    'sensor.ab_123_cd_temps_de_charge_restant': etat('unknown', { unit_of_measurement: 'min' }),
    'device_tracker.ab_123_cd_location': etat('not_home', { latitude: 12.3456, longitude: 65.4321, gps_accuracy: 5 }),
    'sensor.ab_123_cd_kilometrage': etat('48213', { unit_of_measurement: 'km' }),
    'button.ab_123_cd_demarrer_la_charge': etat('unknown'),
    ...remplacer,
  };
}
const CONFIG = lire(MEGANE);

test('projection : nom de VOITURES, champs fermés, ni entity_id, ni friendly_name, ni position, ni kilométrage', () => {
  const projection = projeterVoitures(etatsRenault(), CONFIG);
  assert.deepEqual(projection, [{
    nom: 'Mégane',
    batterie: 22,
    autonomie: { valeur: 95, unite: 'km' },
    branchee: false,
    charge: 'not_in_charge',
    vu_le: '2026-10-14T16:38:05.000Z',
    fin_charge: null,
    commandes: [],
    niveaux: SANS_NIVEAUX,
  }]);
  const json = JSON.stringify(projection);
  for (const interdit of ['ab_123_cd', 'AB-123-CD', 'friendly_name', 'latitude', 'longitude', 'gps', '12.3456', '48213', 'device_class', 'options', 'button']) {
    assert.ok(!json.includes(interdit), `projection : ${interdit} présent`);
  }
});

test('projection : états inconnus ou hors bornes à null, jamais inventés ; état de charge inconnu de la liste : « autre »', () => {
  const absents = projeterVoitures(etatsRenault({
    'sensor.ab_123_cd_batterie': { state: 'unavailable', attributes: {}, last_changed: QUAND },
    'binary_sensor.ab_123_cd_branchee': { state: 'unknown', attributes: {}, last_changed: QUAND },
    'sensor.ab_123_cd_autonomie': { state: '120', attributes: {}, last_changed: QUAND },
    'sensor.ab_123_cd_etat_de_charge': { state: 'unavailable', attributes: {}, last_changed: QUAND },
    'sensor.ab_123_cd_derniere_activite_de_la_batterie': { state: 'unknown', attributes: {}, last_changed: QUAND },
  }), CONFIG)[0];
  assert.deepEqual(absents, {
    nom: 'Mégane', batterie: null, autonomie: null, branchee: null, charge: null, vu_le: null, fin_charge: null, commandes: [], niveaux: SANS_NIVEAUX,
  }, 'autonomie sans unité : null');
  const bizarres = projeterVoitures(etatsRenault({
    'sensor.ab_123_cd_batterie': { state: '104', attributes: {}, last_changed: QUAND },
    'sensor.ab_123_cd_etat_de_charge': { state: 'v2l_connected', attributes: {}, last_changed: QUAND },
  }), CONFIG)[0];
  assert.deepEqual([bizarres.batterie, bizarres.charge], [null, 'autre']);
  assert.deepEqual(projeterVoitures({}, CONFIG)[0], absents, 'intégration pas encore ajoutée : tout à null');
  const minimale = projeterVoitures(etatsRenault(), lire('Zoé: batterie=sensor.ab_123_cd_batterie, branchee=binary_sensor.ab_123_cd_branchee'))[0];
  assert.deepEqual(minimale, {
    nom: 'Zoé', batterie: 22, autonomie: null, branchee: false, charge: null, vu_le: null, fin_charge: null, commandes: [], niveaux: SANS_NIVEAUX,
  }, 'rôles facultatifs absents : null');
});

test('projection : heure de fin pendant une charge seulement, comptée depuis la dernière activité (ou le changement du temps restant)', () => {
  const enCharge = (restant, unite = 'min', autres = {}) => projeterVoitures(etatsRenault({
    'binary_sensor.ab_123_cd_branchee': { state: 'on', attributes: {}, last_changed: QUAND },
    'sensor.ab_123_cd_etat_de_charge': { state: 'charge_in_progress', attributes: {}, last_changed: QUAND },
    'sensor.ab_123_cd_temps_de_charge_restant': { state: restant, attributes: { unit_of_measurement: unite }, last_changed: '2026-10-14T16:50:00+00:00' },
    ...autres,
  }), CONFIG)[0];
  assert.equal(enCharge('125').fin_charge, '2026-10-14T18:43:05.000Z', '16:38:05 + 125 min');
  assert.equal(enCharge('2', 'h').fin_charge, '2026-10-14T18:38:05.000Z');
  assert.equal(enCharge('125', 'jours').fin_charge, null, 'unité inconnue : pas d\'heure');
  assert.equal(enCharge('unknown').fin_charge, null);
  const sansActivite = enCharge('30', 'min', { 'sensor.ab_123_cd_derniere_activite_de_la_batterie': { state: 'unknown', attributes: {}, last_changed: QUAND } });
  assert.equal(sansActivite.fin_charge, '2026-10-14T17:20:00.000Z', 'depuis le changement du temps restant (16:50)');
  assert.equal(projeterVoitures(etatsRenault({ 'sensor.ab_123_cd_temps_de_charge_restant': { state: '30', attributes: { unit_of_measurement: 'min' }, last_changed: QUAND } }), CONFIG)[0].fin_charge, null, 'pas en charge : pas d\'heure');
});

// Entités des commandes, au format relevé dans HA le 14/10 (boutons « unknown » ou heure du dernier appui, niveaux en slider).
function etatsCommandes(remplacer = {}) {
  const etat = (state, attributes = {}) => ({ state, attributes: { friendly_name: 'AB-123-CD Commande', ...attributes }, last_changed: QUAND });
  const reglage = (state, min, max) => etat(state, {
    min, max, step: 5, mode: 'slider', unit_of_measurement: '%', icon: 'mdi:battery',
  });
  return etatsRenault({
    'button.ab_123_cd_commencer_la_charge': etat('unknown'),
    'button.ab_123_cd_demarrer_la_climatisation': etat('2026-10-14T07:12:00+00:00'),
    'button.ab_123_cd_faire_un_appel_de_phares': etat('unknown'),
    'button.ab_123_cd_klaxonner': etat('unknown'),
    'number.ab_123_cd_niveau_de_charge_minimal': reglage('45', 15, 45),
    'number.ab_123_cd_niveau_de_charge_cible': reglage('100', 55, 100),
    ...remplacer,
  });
}
const CONFIG_COMMANDES = lire(MEGANE_COMMANDES);

test('projection des commandes : celles qui sont disponibles, dans l\'ordre ; niveaux avec valeur et bornes ; rien d\'autre ne sort', () => {
  const [megane] = projeterVoitures(etatsCommandes(), CONFIG_COMMANDES);
  assert.deepEqual(megane.commandes, ['charger', 'clim', 'phares', 'klaxon'], 'heure du dernier appui ou unknown : disponible');
  assert.deepEqual(megane.niveaux, {
    charge_min: { valeur: 45, min: 15, max: 45, pas: 5 },
    charge_cible: { valeur: 100, min: 55, max: 100, pas: 5 },
  });
  assert.deepEqual(Object.keys(megane), ['nom', 'batterie', 'autonomie', 'branchee', 'charge', 'vu_le', 'fin_charge', 'commandes', 'niveaux']);
  const json = JSON.stringify(megane);
  for (const interdit of ['ab_123_cd', 'AB-123-CD', 'friendly_name', 'button', 'number', 'slider', 'mode', 'step', 'mdi:', 'icon', '07:12', 'unit_of_measurement']) {
    assert.ok(!json.includes(interdit), `projection : ${interdit} présent`);
  }
});

test('projection des commandes : entité absente ou indisponible retirée ; niveau illisible ou bornes incohérentes à null', () => {
  const indisponible = { state: 'unavailable', attributes: {}, last_changed: QUAND };
  const reglage = (state, attributes) => ({ state, attributes, last_changed: QUAND });
  const projeter = (remplacer) => projeterVoitures(etatsCommandes(remplacer), CONFIG_COMMANDES)[0];
  const sansKlaxon = etatsCommandes({ 'button.ab_123_cd_klaxonner': indisponible });
  delete sansKlaxon['button.ab_123_cd_commencer_la_charge'];
  assert.deepEqual(projeterVoitures(sansKlaxon, CONFIG_COMMANDES)[0].commandes, ['clim', 'phares']);
  const cas = [
    [indisponible, 'indisponible'],
    [reglage('unknown', { min: 15, max: 45, step: 5 }), 'état inconnu'],
    [reglage('beaucoup', { min: 15, max: 45, step: 5 }), 'état pas un nombre'],
    [reglage('45', { min: 45, max: 15, step: 5 }), 'min au-dessus de max'],
    [reglage('45', { min: 15, max: 45, step: 0 }), 'pas nul'],
    [reglage('45', { min: '15', max: 45, step: 5 }), 'borne en texte'],
    [reglage('45', { max: 45, step: 5 }), 'borne absente'],
  ];
  for (const [etat, raison] of cas) {
    assert.deepEqual(projeter({ 'number.ab_123_cd_niveau_de_charge_minimal': etat }).niveaux, {
      charge_min: null, charge_cible: { valeur: 100, min: 55, max: 100, pas: 5 },
    }, raison);
  }
  const vide = projeterVoitures({}, CONFIG_COMMANDES)[0];
  assert.deepEqual([vide.commandes, vide.niveaux], [[], SANS_NIVEAUX], 'intégration pas encore ajoutée : ni commande ni réglage');
});

test('ecrituresVoitures : chaque commande et chaque niveau configurés, avec son service ; aucune entité de lecture', () => {
  assert.deepEqual(ecrituresVoitures(CONFIG_COMMANDES), [
    { nom: 'Mégane', role: 'charger', service: 'button.press', entityId: 'button.ab_123_cd_commencer_la_charge' },
    { nom: 'Mégane', role: 'clim', service: 'button.press', entityId: 'button.ab_123_cd_demarrer_la_climatisation' },
    { nom: 'Mégane', role: 'phares', service: 'button.press', entityId: 'button.ab_123_cd_faire_un_appel_de_phares' },
    { nom: 'Mégane', role: 'klaxon', service: 'button.press', entityId: 'button.ab_123_cd_klaxonner' },
    { nom: 'Mégane', role: 'charge_min', service: 'number.set_value', entityId: 'number.ab_123_cd_niveau_de_charge_minimal' },
    { nom: 'Mégane', role: 'charge_cible', service: 'number.set_value', entityId: 'number.ab_123_cd_niveau_de_charge_cible' },
  ]);
  assert.deepEqual(ecrituresVoitures(CONFIG), [], 'lecture seule : rien à écrire');
  assert.deepEqual(ecrituresVoitures([]), []);
});

// Fausse Connection : juste ce que subscribeEntities utilise ; envoyer() pousse un message de HA.
async function brancher(voitures) {
  let rappel = null;
  let demandes = 0;
  const conn = {
    haVersion: '2026.10.1',
    addEventListener() {},
    removeEventListener() {},
    async subscribeMessage(recevoir, message) {
      assert.deepEqual(message, { type: 'subscribe_entities' });
      demandes += 1;
      rappel = recevoir;
      return async () => {};
    },
  };
  const connexion = new EventEmitter();
  const source = new SourceVoitures(connexion, voitures);
  const maj = [];
  source.on('maj', (valeur) => maj.push(valeur));
  connexion.emit('connectee', conn);
  for (let i = 0; i < 10 && !rappel; i += 1) await Promise.resolve();
  return {
    source, maj, envoyer: (message) => rappel(message), demandes: () => demandes,
  };
}

test('SourceVoitures : valeur à null avant HA, puis projetée ; maj seulement quand la projection change', async () => {
  const { source, maj, envoyer } = await brancher(CONFIG);
  assert.equal(source.valeur[0].batterie, null, 'avant le premier état : la voiture configurée, sans donnée');
  envoyer({
    a: {
      'sensor.ab_123_cd_batterie': { s: '22', a: { unit_of_measurement: '%', friendly_name: 'AB-123-CD Batterie' }, c: 'c1', lc: 1760460000 },
      'binary_sensor.ab_123_cd_branchee': { s: 'off', a: {}, c: 'c2', lc: 1760460000 },
      'device_tracker.ab_123_cd_location': { s: 'home', a: { latitude: 12.3456, longitude: 65.4321 }, c: 'c3', lc: 1760460000 },
    },
  });
  assert.equal(maj.length, 1);
  assert.deepEqual([maj[0][0].batterie, maj[0][0].branchee], [22, false]);
  envoyer({ c: { 'device_tracker.ab_123_cd_location': { '+': { s: 'not_home', a: { latitude: 1.5 } } } } });
  envoyer({ c: { 'sensor.ab_123_cd_batterie': { '+': { a: { friendly_name: 'Autre nom' } } } } });
  assert.equal(maj.length, 1, 'position et nom de HA changés : rien de neuf pour la page');
  envoyer({ c: { 'binary_sensor.ab_123_cd_branchee': { '+': { s: 'on', lc: 1760460600 } } } });
  assert.equal(maj.length, 2);
  assert.equal(source.valeur[0].branchee, true);
  assert.ok(!JSON.stringify(maj).includes('12.3456') && !JSON.stringify(maj).includes('ab_123_cd'));
});

test('SourceVoitures : l\'appui sur un bouton (nouvelle heure dans son état) ne change rien ; sa disparition, si', async () => {
  const { source, maj, envoyer } = await brancher(CONFIG_COMMANDES);
  envoyer({
    a: {
      'sensor.ab_123_cd_batterie': { s: '22', a: {}, c: 'c1', lc: 1760460000 },
      'button.ab_123_cd_klaxonner': { s: 'unknown', a: { friendly_name: 'AB-123-CD Klaxonner' }, c: 'c2', lc: 1760460000 },
      'number.ab_123_cd_niveau_de_charge_minimal': { s: '45', a: { min: 15, max: 45, step: 5, mode: 'slider' }, c: 'c3', lc: 1760460000 },
    },
  });
  assert.equal(maj.length, 1);
  assert.deepEqual([source.valeur[0].commandes, source.valeur[0].niveaux.charge_min], [['klaxon'], { valeur: 45, min: 15, max: 45, pas: 5 }]);
  envoyer({ c: { 'button.ab_123_cd_klaxonner': { '+': { s: '2026-10-14T17:00:00+00:00', lc: 1760461200 } } } });
  assert.equal(maj.length, 1, 'klaxon appuyé : la page n\'a rien de neuf à savoir');
  envoyer({ c: { 'number.ab_123_cd_niveau_de_charge_minimal': { '+': { s: '30' } } } });
  assert.equal(maj.length, 2);
  assert.equal(source.valeur[0].niveaux.charge_min.valeur, 30);
  envoyer({ c: { 'button.ab_123_cd_klaxonner': { '+': { s: 'unavailable' } } } });
  assert.deepEqual(source.valeur[0].commandes, [], 'klaxon devenu indisponible : son bouton disparaît');
});

test('SourceVoitures sans voiture configurée : valeur [], aucun abonnement demandé à HA', async () => {
  const { source, demandes } = await brancher([]);
  assert.deepEqual(source.valeur, []);
  assert.equal(demandes(), 0);
});
