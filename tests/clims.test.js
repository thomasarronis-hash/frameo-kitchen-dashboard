// tests/clims.test.js
//
// Rôle    : prouver la lecture de CLIMS (config.js : rôles, domaines, refus au démarrage) et la projection des clims
//           (serveur/ha/clims.js) : nom de CLIMS jamais friendly_name, modes, ventilations et oscillations filtrés sur les
//           valeurs connues, consigne et ses bornes, température au demi-degré, options avec writable_now, clim
//           indisponible, liste des écritures permises, et la source qui ne publie qu'au changement.
// Entrées : états HA au format relevé le 16/10 sur les deux clims Bosch (intégration HACS « Bosch HomeCom »).
// Sorties : node --test.
// Pièges  : aucun réseau ; la fausse Connection rejoue des messages subscribe_entities au format compressé de HA (a, c),
//           comme tests/voitures.test.js.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { lireClims } from '../serveur/config.js';
import { ecrituresClims, projeterClims, SourceClims } from '../serveur/ha/clims.js';

const CLIMS = 'Salon: climat=climate.climatisation_salon, eco=switch.climatisation_salon_eco, '
  + 'boost=switch.climatisation_salon_boost, hors_gel=switch.climatisation_salon_8_degc_heating ; '
  + 'Étage: climat=climate.climatisation_etage';
// Attributs relevés le 16/10 (clim éteinte), friendly_name compris.
const climat = (state = 'off', attributs = {}) => ({
  state,
  attributes: {
    hvac_modes: ['off', 'cool', 'heat', 'auto', 'dry', 'fan_only'],
    min_temp: 16,
    max_temp: 30,
    target_temp_step: 1,
    fan_modes: ['quiet', 'low', 'medium', 'high', 'turbo', 'auto'],
    swing_modes: ['off', 'on'],
    swing_horizontal_modes: ['off', 'on'],
    current_temperature: 22.5,
    temperature: 25,
    fan_mode: 'quiet',
    swing_mode: 'off',
    swing_horizontal_mode: 'on',
    friendly_name: 'Climatisation Salon',
    supported_features: 937,
    ...attributs,
  },
});
const interrupteur = (state = 'off', writable = false) => ({ state, attributes: { writable_now: writable, friendly_name: 'Climatisation Salon Eco' } });
const etatsHA = (remplacer = {}) => ({
  'climate.climatisation_salon': climat(),
  'switch.climatisation_salon_eco': interrupteur(),
  'switch.climatisation_salon_boost': interrupteur('on', true),
  'switch.climatisation_salon_8_degc_heating': interrupteur(),
  'climate.climatisation_etage': climat('cool', { fan_mode: 'auto', current_temperature: 23.26, friendly_name: 'Climatisation Étage' }),
  ...remplacer,
});

test('CLIMS : noms, rôles et entités lus dans l\'ordre donné, vide par défaut', () => {
  assert.deepEqual(lireClims({}), []);
  assert.deepEqual(lireClims({ CLIMS: '  ' }), []);
  const clims = lireClims({ CLIMS });
  assert.deepEqual(clims.map((clim) => clim.nom), ['Salon', 'Étage']);
  assert.deepEqual(clims[0].entites, {
    climat: 'climate.climatisation_salon',
    eco: 'switch.climatisation_salon_eco',
    boost: 'switch.climatisation_salon_boost',
    hors_gel: 'switch.climatisation_salon_8_degc_heating',
  });
  assert.ok(Object.isFrozen(clims[0]) && Object.isFrozen(clims[0].entites));
});

test('CLIMS : refus au démarrage, avec un message qui dit quoi corriger', () => {
  const refus = [
    ['climat=climate.x', /commence par son nom affiché/],
    ['Salon: eco=switch.x', /Salon sans climat/],
    ['Salon: climat=switch.x', /climat : entity_id de climate attendu/],
    ['Salon: climat=climate.x, eco=climate.y', /eco : entity_id de switch attendu/],
    ['Salon: climat=climate.x, turbo=switch.y', /rôle inconnu « turbo »/],
    ['Salon: climat=climate.x, climat=climate.y', /climat est donné deux fois/],
    ['Salon: climat=Climate.X', /entity_id de climate attendu/],
    ['Salon: climat=climate.x ; Salon: climat=climate.y', /Salon est donné deux fois/],
    ['A: climat=climate.x ; B: climat=climate.x', /une même entité sert deux fois/],
    ['A: climat=climate.a ; B: climat=climate.b ; C: climat=climate.c', /2 clims au plus/],
  ];
  for (const [valeur, motif] of refus) assert.throws(() => lireClims({ CLIMS: valeur }), motif, valeur);
});

test('projection : nom de CLIMS, mode, consigne, ventilation, oscillations et options, jamais friendly_name ni entity_id', () => {
  const [salon, etage] = projeterClims(etatsHA(), lireClims({ CLIMS }));
  assert.deepEqual(salon, {
    nom: 'Salon',
    disponible: true,
    mode: 'off',
    modes: ['cool', 'heat', 'auto', 'dry', 'fan_only'],
    temperature: 22.5,
    consigne: { valeur: 25, min: 16, max: 30, pas: 1 },
    ventilation: 'quiet',
    ventilations: ['auto', 'quiet', 'low', 'medium', 'high', 'turbo'],
    oscillation: { verticale: false, horizontale: true },
    options: [
      { cle: 'eco', actif: false, modifiable: false },
      { cle: 'boost', actif: true, modifiable: true },
      { cle: 'hors_gel', actif: false, modifiable: false },
    ],
  });
  assert.equal(etage.mode, 'cool');
  assert.equal(etage.temperature, 23.5, 'au demi-degré');
  assert.equal(etage.ventilation, 'auto');
  assert.deepEqual(etage.options, [], 'aucune option configurée');
  const texte = JSON.stringify([salon, etage]);
  assert.doesNotMatch(texte, /Climatisation|climate\.|switch\.|supported_features|writable_now/);
});

test('projection : valeurs inconnues ignorées, oscillation absente, consigne illisible', () => {
  const etats = etatsHA({
    'climate.climatisation_salon': climat('heat_cool', {
      hvac_modes: ['off', 'cool', 'heat_cool'],
      fan_modes: ['auto', 'diffuse'],
      fan_mode: 'diffuse',
      swing_modes: ['off', 'vertical', 'both'],
      swing_horizontal_modes: undefined,
      temperature: null,
    }),
  });
  const [salon] = projeterClims(etats, lireClims({ CLIMS }));
  assert.equal(salon.mode, null, 'heat_cool : mode inconnu, pas de bouton actif');
  assert.deepEqual(salon.modes, ['cool']);
  assert.deepEqual(salon.ventilations, ['auto']);
  assert.equal(salon.ventilation, null);
  assert.deepEqual(salon.oscillation, { verticale: null, horizontale: null });
  assert.equal(salon.consigne, null);
});

test('projection : bornes incohérentes ou pas absent', () => {
  const lire = (attributs) => projeterClims(etatsHA({ 'climate.climatisation_salon': climat('cool', attributs) }), lireClims({ CLIMS }))[0].consigne;
  assert.equal(lire({ min_temp: 30, max_temp: 16 }), null);
  assert.equal(lire({ target_temp_step: 0 }), null);
  assert.deepEqual(lire({ target_temp_step: undefined }), { valeur: 25, min: 16, max: 30, pas: 1 }, 'pas de 1 par défaut');
  assert.deepEqual(lire({ target_temp_step: 0.5, temperature: 21.5 }), { valeur: 21.5, min: 16, max: 30, pas: 0.5 });
});

test('projection : clim indisponible ou absente, options indisponibles retirées', () => {
  const etats = etatsHA({
    'climate.climatisation_salon': { state: 'unavailable', attributes: {} },
    'switch.climatisation_salon_eco': { state: 'unavailable', attributes: {} },
    'switch.climatisation_salon_boost': { state: 'unknown', attributes: {} },
  });
  delete etats['climate.climatisation_etage'];
  const [salon, etage] = projeterClims(etats, lireClims({ CLIMS }));
  assert.equal(salon.disponible, false);
  assert.equal(salon.mode, null);
  assert.deepEqual(salon.modes, []);
  assert.deepEqual(salon.options, [{ cle: 'hors_gel', actif: false, modifiable: false }]);
  assert.equal(etage.disponible, false);
});

test('option sans writable_now : modifiable', () => {
  const etats = etatsHA({ 'switch.climatisation_salon_eco': { state: 'on', attributes: {} } });
  const [salon] = projeterClims(etats, lireClims({ CLIMS }));
  assert.deepEqual(salon.options[0], { cle: 'eco', actif: true, modifiable: true });
});

test('écritures permises : services des clims sur les seules entités de CLIMS', () => {
  const ecritures = ecrituresClims(lireClims({ CLIMS: 'Salon: climat=climate.clim_salon, eco=switch.clim_salon_eco' }));
  assert.deepEqual(ecritures.map(({ service, entityId }) => `${service} ${entityId}`), [
    'climate.turn_on climate.clim_salon',
    'climate.turn_off climate.clim_salon',
    'climate.set_hvac_mode climate.clim_salon',
    'climate.set_temperature climate.clim_salon',
    'climate.set_fan_mode climate.clim_salon',
    'climate.set_swing_mode climate.clim_salon',
    'climate.set_swing_horizontal_mode climate.clim_salon',
    'switch.turn_on switch.clim_salon_eco',
    'switch.turn_off switch.clim_salon_eco',
  ]);
  assert.deepEqual(ecrituresClims([]), []);
});

// Fausse Connection : juste ce que subscribeEntities utilise ; envoyer() pousse un message de HA (format compressé a, c).
async function brancher(clims) {
  let rappel = null;
  let demandes = 0;
  const conn = {
    haVersion: '2026.10.1',
    addEventListener() {},
    removeEventListener() {},
    async subscribeMessage(recevoir) {
      demandes += 1;
      rappel = recevoir;
      return async () => {};
    },
  };
  const connexion = new EventEmitter();
  const source = new SourceClims(connexion, clims);
  const maj = [];
  source.on('maj', (valeur) => maj.push(valeur));
  connexion.emit('connectee', conn);
  for (let i = 0; i < 10 && !rappel; i += 1) await Promise.resolve();
  return {
    source, maj, envoyer: (message) => rappel(message), demandes: () => demandes,
  };
}

test('SourceClims : indisponible avant HA, puis projetée ; maj seulement quand la projection change', async () => {
  const { source, maj, envoyer } = await brancher(lireClims({ CLIMS: 'Salon: climat=climate.clim_salon' }));
  assert.equal(source.valeur[0].disponible, false, 'avant le premier état');
  const { attributes } = climat();
  envoyer({ a: { 'climate.clim_salon': { s: 'off', a: attributes, c: 'c1', lc: 1760600000 } } });
  assert.equal(maj.length, 1);
  assert.equal(maj[0][0].mode, 'off');
  envoyer({ c: { 'climate.clim_salon': { '+': { a: { friendly_name: 'Autre nom', supported_features: 1 } } } } });
  assert.equal(maj.length, 1, 'nom de HA changé : rien de neuf pour la page');
  envoyer({ c: { 'climate.clim_salon': { '+': { s: 'heat', lc: 1760600600 } } } });
  assert.equal(maj.length, 2);
  assert.equal(source.valeur[0].mode, 'heat');
});

test('SourceClims sans clim configurée : valeur [], aucun abonnement demandé à HA', async () => {
  const { source, demandes } = await brancher([]);
  assert.deepEqual(source.valeur, []);
  assert.equal(demandes(), 0);
});
