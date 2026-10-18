// tests/entites.test.js
//
// Rôle    : prouver que la projection de serveur/ha/entites.js ne laisse sortir que la liste blanche,
//           sans GPS, jeton, image ni numéro de téléphone, que les calendriers de AGENDA_CALENDRIERS n'y entrent
//           qu'avec leur nom, et que SourceEntites ne pousse que les entités changées (null pour une entité
//           disparue).
// Entrées : tests/fixtures/ha_states.json, inventaire HA réel du 11/10 anonymisé : les valeurs sensibles y
//           sont remplacées par des valeurs factices RECONNAISSABLES (latitude 12.3456, jeton-factice-0000,
//           +33600000000...), pour qu'une fuite se voie. Option : FLUX_CAPTURE=<fichier> rejoue les mêmes
//           contrôles sur une capture brute de GET /api/flux (fichier privé, hors du dépôt).
// Sorties : node --test.
// Pièges  : la fixture doit CONTENIR les données interdites, sinon le test ne prouve rien (premier test).
//           SourceEntites est branchée sur la vraie bibliothèque (subscribeEntities) avec une fausse
//           Connection qui rejoue des messages subscribe_entities au format compressé de HA (a, c, r).

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ATTRIBUTS_INTERDITS, ENTITES_INTERDITES, LISTE_BLANCHE, listeBlanche, projeter, SourceEntites, verifierListeBlanche,
} from '../serveur/ha/entites.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ha_states.json', import.meta.url), 'utf8'));
const etats = Object.fromEntries(fixture.map((etat) => [etat.entity_id, etat]));

const VALEURS_FACTICES = ['12.3456', '65.4321', 'jeton-factice', 'utilisateur-factice', 'SERIE-FACTICE', '192.0.2.'];
const NUMERO = /(?:\+33|\b0)[1-9](?:[ .]?\d{2}){4}\b/;
const CLES_SENSIBLES = [...ATTRIBUTS_INTERDITS, 'user_id', 'altitude', 'mac', 'serial'];

// Parcourt tout l'objet : aucune clé sensible, aucune valeur factice, aucun numéro de téléphone.
function verifierSansFuite(donnees, contexte) {
  const json = JSON.stringify(donnees);
  for (const cle of CLES_SENSIBLES) assert.ok(!json.includes(`"${cle}"`), `${contexte} : clé ${cle} présente`);
  for (const valeur of VALEURS_FACTICES) assert.ok(!json.includes(valeur), `${contexte} : valeur ${valeur} présente`);
  assert.ok(!NUMERO.test(json), `${contexte} : numéro de téléphone présent`);
}

function verifierEntites(entites, contexte) {
  for (const entityId of Object.keys(entites)) {
    assert.ok(entityId in LISTE_BLANCHE, `${contexte} : ${entityId} hors liste blanche`);
    assert.ok(!ENTITES_INTERDITES.some((motif) => motif.test(entityId)), `${contexte} : ${entityId} interdite`);
  }
}

test('la fixture contient bien les données interdites (sinon le test ne prouverait rien)', () => {
  const json = JSON.stringify(fixture);
  for (const valeur of ['"latitude"', '"longitude"', '"access_token"', '"entity_picture"', '+33600000000', 'jeton-factice']) {
    assert.ok(json.includes(valeur), `fixture sans ${valeur}`);
  }
  for (const entityId of ['person.personne_1', 'zone.home', 'device_tracker.iphone_5', 'sensor.freebox_v9_r1_appels_manques',
    'alarm_control_panel.alarm_center', 'select.alarm_center_guard_mode']) {
    assert.ok(etats[entityId], `fixture sans ${entityId}`);
  }
});

test('seules les entités de la liste blanche sortent, et toutes celles de l\'inventaire', () => {
  const projection = projeter(etats);
  assert.deepEqual(Object.keys(projection).sort(), Object.keys(LISTE_BLANCHE).sort());
  verifierEntites(projection, 'fixture');
});

test('aucune latitude, longitude, access_token, entity_picture ni numéro ne sort', () => {
  verifierSansFuite(projeter(etats), 'fixture');
});

test('chaque entité ne garde que ses attributs autorisés', () => {
  const projection = projeter(etats);
  for (const [entityId, projete] of Object.entries(projection)) {
    assert.deepEqual(Object.keys(projete).sort(), ['attributes', 'last_changed', 'state']);
    for (const nom of Object.keys(projete.attributes)) {
      assert.ok(LISTE_BLANCHE[entityId].includes(nom), `${entityId} : attribut ${nom} non autorisé`);
    }
  }
  assert.deepEqual(projection['camera.sonnette_derniere_photo'].attributes, {});
  assert.equal(projection['weather.forecast_maison'].attributes.temperature_unit, '°C');
  assert.equal(projection['weather.forecast_maison'].attributes.pressure, undefined);
});

test('maison en lecture seule : les 9 ouvertures (état et last_changed), l\'alarme sans attribut de clavier, plus de compteur de codes', () => {
  const projection = projeter(etats);
  const ouvertures = Object.keys(projection).filter((id) => id.endsWith('_sensor_open'));
  assert.deepEqual(ouvertures, [
    'binary_sensor.porte_d_entree_sensor_open', 'binary_sensor.baie_vitree_gauche_sensor_open', 'binary_sensor.baie_vitree_droit_sensor_open',
    'binary_sensor.baie_vitree_centrale_sensor_open', 'binary_sensor.fenetre_salon_sensor_open', 'binary_sensor.fenetre_chambre_sensor_open',
    'binary_sensor.fenetre_cuisine_sensor_open', 'binary_sensor.porte_garage_sensor_open', 'binary_sensor.porte_fenetre_bureau_sensor_open',
  ]);
  for (const id of ouvertures) {
    assert.deepEqual(projection[id], { state: etats[id].state, last_changed: etats[id].last_changed, attributes: {} }, id);
  }
  assert.deepEqual(projection['alarm_control_panel.alarme_maison'].attributes, {}, 'ni code_format ni code_arm_required');
  assert.equal(projection['counter.alarme_codes_faux'], undefined, 'le compteur ne servait qu\'au clavier, retiré');
  assert.deepEqual(projection['media_player.sejour_sejour'].attributes.source_list, etats['media_player.sejour_sejour'].attributes.source_list);
});

test('une entité de la liste blanche absente de HA est simplement omise', () => {
  const sansMeteo = { ...etats };
  delete sansMeteo['weather.forecast_maison'];
  assert.equal(projeter(sansMeteo)['weather.forecast_maison'], undefined);
});

test('la liste blanche refuse une entité ou un attribut interdit', () => {
  assert.throws(() => verifierListeBlanche({ 'alarm_control_panel.alarm_center': [] }), /entité interdite/);
  assert.throws(() => verifierListeBlanche({ 'select.alarm_center_guard_mode': [] }), /entité interdite/);
  assert.throws(() => verifierListeBlanche({ 'person.personne_1': [] }), /entité interdite/);
  assert.throws(() => verifierListeBlanche({ 'sensor.freebox_v9_r1_appels_manques': [] }), /entité interdite/);
  assert.throws(() => verifierListeBlanche({ 'camera.sonnette_derniere_photo': ['entity_picture'] }), /attribut interdit/);
  assert.doesNotThrow(() => verifierListeBlanche(LISTE_BLANCHE));
});

// Fausse Connection : juste ce que subscribeEntities utilise ; envoyer() pousse un message de HA.
async function brancherSourceEntites(options) {
  let rappel;
  const conn = {
    haVersion: '2026.10.1',
    addEventListener() {},
    removeEventListener() {},
    async subscribeMessage(recevoir, message) {
      assert.deepEqual(message, { type: 'subscribe_entities' });
      rappel = recevoir;
      return async () => {};
    },
  };
  const connexion = new EventEmitter();
  const source = new SourceEntites(connexion, options);
  const maj = [];
  source.on('maj', (fragment) => maj.push(fragment));
  connexion.emit('connectee', conn);
  for (let i = 0; i < 10 && !rappel; i += 1) await Promise.resolve();
  assert.ok(rappel, 'subscribe_entities jamais demandé');
  return { source, maj, envoyer: (message) => rappel(message) };
}

test('SourceEntites : premier état projeté, rien hors liste blanche, ni GPS ni jeton', async () => {
  const { source, maj, envoyer } = await brancherSourceEntites();
  envoyer({
    a: {
      'sun.sun': { s: 'above_horizon', a: { elevation: 30.5, azimuth: 120 }, c: 'c1', lc: 1760170000 },
      'person.personne_1': { s: 'home', a: { latitude: 12.3456, longitude: 65.4321 }, c: 'c2', lc: 1760170000 },
      'camera.sonnette_derniere_photo': { s: 'idle', a: { access_token: 'jeton-factice-0000', entity_picture: '/api/camera_proxy/x?token=jeton-factice-0000' }, c: 'c3', lc: 1760170000 },
    },
  });
  const quand = new Date(1760170000 * 1000).toISOString();
  const attendu = {
    'sun.sun': { state: 'above_horizon', last_changed: quand, attributes: { elevation: 30.5 } },
    'camera.sonnette_derniere_photo': { state: 'idle', last_changed: quand, attributes: {} },
  };
  assert.deepEqual(maj, [attendu]);
  assert.deepEqual(source.valeur, attendu);
});

test('SourceEntites : seules les entités changées sont poussées, null pour une entité disparue', async () => {
  const { source, maj, envoyer } = await brancherSourceEntites();
  envoyer({
    a: {
      'sun.sun': { s: 'above_horizon', a: { elevation: 30.5, azimuth: 120 }, c: 'c1', lc: 1760170000 },
      'camera.sonnette_derniere_photo': { s: 'idle', a: { access_token: 'jeton-factice-0000' }, c: 'c3', lc: 1760170000 },
      'todo.shopping_list': { s: '2', a: {}, c: 'c4', lc: 1760170000 },
    },
  });
  maj.length = 0;

  // Attributs non projetés (jeton de la caméra renouvelé, azimut) : aucune maj.
  envoyer({ c: { 'camera.sonnette_derniere_photo': { '+': { a: { access_token: 'jeton-factice-0001' } } }, 'sun.sun': { '+': { a: { azimuth: 121 } } } } });
  assert.deepEqual(maj, []);

  envoyer({ c: { 'todo.shopping_list': { '+': { s: '3', lc: 1760170600 } } } });
  assert.deepEqual(maj, [{ 'todo.shopping_list': { state: '3', last_changed: new Date(1760170600 * 1000).toISOString(), attributes: {} } }]);

  envoyer({ r: ['camera.sonnette_derniere_photo'] });
  assert.deepEqual(maj[1], { 'camera.sonnette_derniere_photo': null });
  assert.deepEqual(Object.keys(source.valeur).sort(), ['sun.sun', 'todo.shopping_list']);
});

test('calendriers configurés : ajoutés à la liste blanche avec leur nom seul, jamais message, description ni lieu', () => {
  assert.deepEqual(Object.keys(listeBlanche()).sort(), Object.keys(LISTE_BLANCHE).sort(), 'sans calendrier : la liste fixe');
  const liste = listeBlanche(['calendar.famille', 'calendar.thomas']);
  assert.deepEqual(liste['calendar.famille'], ['friendly_name']);
  assert.ok(Object.isFrozen(liste));
  const calendrier = {
    entity_id: 'calendar.famille', state: 'on', last_changed: '2026-10-14T07:30:00+00:00',
    attributes: {
      friendly_name: 'Famille', message: 'Dentiste', description: 'Visio https://exemple.invalid/salle 06 00 00 00 00',
      location: '12 rue factice', start_time: '2026-10-14 09:30:00', end_time: '2026-10-14 10:00:00', all_day: false,
    },
  };
  const projection = projeter({ ...etats, 'calendar.famille': calendrier, 'calendar.autre': { ...calendrier, entity_id: 'calendar.autre' } }, liste);
  assert.deepEqual(projection['calendar.famille'], { state: 'on', last_changed: '2026-10-14T07:30:00+00:00', attributes: { friendly_name: 'Famille' } });
  assert.equal(projection['calendar.autre'], undefined, 'calendrier hors AGENDA_CALENDRIERS : jamais projeté');
  assert.equal(projection['calendar.thomas'], undefined, 'calendrier configuré absent de HA : omis');
  assert.equal(projeter(etats)['calendar.famille'], undefined, 'liste par défaut : aucun calendrier');
});

test('calendriers configurés : un nom qui n\'est pas calendar.* est refusé', () => {
  for (const mauvais of ['alarm_control_panel.alarm_center', 'person.personne_1', 'calendar.Famille', 'calendar']) {
    assert.throws(() => listeBlanche([mauvais]), /n'est pas un calendrier/, mauvais);
  }
});

test('SourceEntites : recue devient vrai au premier état reçu ; un calendrier configuré sort avec son nom seul', async () => {
  const { source, maj, envoyer } = await brancherSourceEntites({ calendriers: ['calendar.famille'] });
  assert.equal(source.recue, false);
  envoyer({
    a: {
      'calendar.famille': { s: 'off', a: { friendly_name: 'Famille', message: 'Dentiste', description: 'secret', location: 'ici' }, c: 'c1', lc: 1760170000 },
      'calendar.autre': { s: 'off', a: { friendly_name: 'Autre' }, c: 'c2', lc: 1760170000 },
    },
  });
  assert.equal(source.recue, true);
  assert.deepEqual(maj, [{ 'calendar.famille': { state: 'off', last_changed: new Date(1760170000 * 1000).toISOString(), attributes: { friendly_name: 'Famille' } } }]);
});

test('flux réel capturé (FLUX_CAPTURE)', { skip: !process.env.FLUX_CAPTURE && 'FLUX_CAPTURE non défini' }, () => {
  const brut = readFileSync(process.env.FLUX_CAPTURE, 'utf8');
  const evenements = brut.split('\n\n').filter((bloc) => bloc.includes('data: ')).map((bloc) => ({
    nom: /^event: (.+)$/m.exec(bloc)?.[1],
    donnees: JSON.parse(/^data: (.+)$/m.exec(bloc)[1]),
  }));
  assert.equal(evenements[0]?.nom, 'instantane', 'la capture doit commencer par instantane');
  for (const { nom, donnees } of evenements) {
    if (donnees.entites) verifierEntites(Object.fromEntries(Object.entries(donnees.entites).filter(([, v]) => v !== null)), nom);
    const json = JSON.stringify(donnees);
    for (const cle of ATTRIBUTS_INTERDITS) assert.ok(!json.includes(`"${cle}"`), `${nom} : clé ${cle} présente`);
    assert.ok(!/"(person|zone|device_tracker)\.|alarm_center|sensor\.freebox_/.test(json), `${nom} : entité interdite`);
    assert.ok(!NUMERO.test(json), `${nom} : numéro de téléphone présent`);
  }
});
