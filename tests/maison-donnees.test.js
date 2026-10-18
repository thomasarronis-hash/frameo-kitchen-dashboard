// tests/maison-donnees.test.js
//
// Rôle    : prouver les vues sans DOM de l'écran Maison (web/src/ecrans/maison-donnees.js) : alarme en français en
//           lecture seule, vue des ouvertures (ouvertes en tête puis indisponibles puis fermées, résumé « Tout est
//           fermé » / « 2 ouvertures », « depuis » à l'heure de Paris, pile faible), télécommandes, sonnette (dernier
//           coup VU par le serveur, sinon « dernier changement »), entretien (encres, piles faibles nommées avec leur
//           appareil, les 12 du serveur), mot de passe découpé (chiffres à part).
// Entrées : tests/fixtures/ha_states.json (inventaire réel du 11/10, anonymisé), projeté comme le fait le serveur.
// Sorties : node --test.
// Pièges  : les heures sont écrites en UTC dans les données (last_changed de HA) et lues à l'heure de Paris : le
//           11/10/2026, Paris est à UTC+2.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LISTE_BLANCHE, projeter } from '../serveur/ha/entites.js';
import { ESP } from '../web/src/format.js';
import {
  decouperMotDePasse, encres, etatAlarme, OUVERTURES, PILES, pilesFaibles, texteDepuis, texteQuand, vueEntretien, vueOuvertures, vueSonnette,
  vueTelecommandes,
} from '../web/src/ecrans/maison-donnees.js';

const brut = JSON.parse(readFileSync(new URL('./fixtures/ha_states.json', import.meta.url), 'utf8'));
const ENTITES = projeter(Object.fromEntries(brut.map((etat) => [etat.entity_id, etat])));
const utc = (texte) => Date.parse(`${texte}Z`);
const MAINTENANT = utc('2026-10-14T12:34'); // mercredi 14/10, 14h34 à Paris
const H = ' h ';

function avec(modifs) {
  const entites = structuredClone(ENTITES);
  for (const [cle, valeur] of Object.entries(modifs)) entites[cle] = { ...entites[cle], ...valeur };
  return entites;
}
const capteur = (nom) => `binary_sensor.${nom}_sensor_open`;

test('« depuis » à l\'heure de Paris : aujourd\'hui l\'heure, hier, un jour de la semaine, puis la date', () => {
  assert.equal(texteDepuis('2026-10-14T12:32:05+00:00', MAINTENANT), `depuis 14${H}32`);
  assert.equal(texteDepuis('2026-10-13T22:30:00+00:00', MAINTENANT), `depuis 0${H}30`, '0h30 à Paris le 14 : aujourd\'hui');
  assert.equal(texteDepuis('2026-10-13T21:59:00+00:00', MAINTENANT), 'depuis hier', '23h59 à Paris le 13');
  assert.equal(texteDepuis('2026-10-12T07:00:00+00:00', MAINTENANT), 'depuis lundi');
  assert.equal(texteDepuis('2026-10-08T07:00:00+00:00', MAINTENANT), 'depuis jeudi', 'il y a 6 jours');
  assert.equal(texteDepuis('2026-10-07T07:00:00+00:00', MAINTENANT), 'depuis le 7 octobre', 'il y a 7 jours');
  assert.equal(texteDepuis('2026-10-01T07:00:00+00:00', MAINTENANT), 'depuis le 1er octobre');
  assert.equal(texteDepuis('', MAINTENANT), null);
  assert.equal(texteQuand('2026-10-08T11:49:57+00:00', MAINTENANT), `jeudi à 13${H}49`);
  assert.equal(texteQuand('2026-10-14T09:05:00+00:00', MAINTENANT), `aujourd'hui à 11${H}05`);
  assert.equal(texteQuand('2026-10-13T09:05:00+00:00', MAINTENANT), `hier à 11${H}05`);
});

test('alarme : état en français, ton (armée, désarmée, alerte, neutre), depuis quand', () => {
  const alarme = (state) => etatAlarme({ state, last_changed: '2026-10-13T21:00:01+00:00', attributes: {} }, MAINTENANT);
  assert.deepEqual(alarme('armed_night'), { libelle: 'Nuit', ton: 'arme', depuis: 'depuis hier' });
  assert.deepEqual(alarme('armed_home'), { libelle: 'Maison', ton: 'arme', depuis: 'depuis hier' });
  assert.deepEqual(alarme('armed_away'), { libelle: 'Absent', ton: 'arme', depuis: 'depuis hier' });
  assert.deepEqual(alarme('disarmed'), { libelle: 'Désarmée', ton: 'desarme', depuis: 'depuis hier' });
  assert.deepEqual(alarme('triggered'), { libelle: 'Déclenchée', ton: 'alerte', depuis: 'depuis hier' });
  assert.deepEqual(alarme('unavailable'), { libelle: 'Indisponible', ton: 'neutre', depuis: null });
  assert.deepEqual(alarme('etat_nouveau'), { libelle: 'etat_nouveau', ton: 'neutre', depuis: null });
  assert.equal(etatAlarme(undefined, MAINTENANT), null);
});

test('ouvertures sur l\'inventaire réel : 9 lignes, toutes fermées, « Tout est fermé »', () => {
  const vue = vueOuvertures(ENTITES, MAINTENANT);
  assert.equal(vue.lignes.length, 9);
  assert.deepEqual(vue.lignes.map((l) => l.nom), OUVERTURES.map((o) => o.nom));
  assert.ok(vue.lignes.every((l) => l.etat === 'fermee' && l.libelle === 'Fermée' && /^fermée depuis /.test(l.depuis) && !l.pileFaible));
  assert.deepEqual([vue.ouvertes, vue.indisponibles, vue.resume, vue.detail, vue.resumeCourt], [0, 0, 'Tout est fermé', null, 'tout fermé']);
});

test('ouvertures : les ouvertes en tête (ordre de la table), puis les indisponibles, puis les fermées ; résumé et pile faible', () => {
  const entites = avec({
    [capteur('fenetre_cuisine')]: { state: 'on', last_changed: '2026-10-14T12:32:00+00:00' },
    [capteur('porte_d_entree')]: { state: 'on', last_changed: '2026-10-13T18:00:00+00:00' },
    [capteur('porte_garage')]: { state: 'unavailable', last_changed: '2026-10-14T10:00:00+00:00' },
    'binary_sensor.fenetre_cuisine_battery_low': { state: 'on' },
    'binary_sensor.baie_vitree_droit_battery_low': { state: 'on' },
  });
  const vue = vueOuvertures(entites, MAINTENANT);
  assert.deepEqual(vue.lignes.slice(0, 3).map(({ nom, etat, libelle, depuis, pileFaible }) => [nom, etat, libelle, depuis, pileFaible]), [
    ['Porte d\'entrée', 'ouverte', 'Ouverte', 'ouverte depuis hier', false],
    ['Fenêtre cuisine', 'ouverte', 'Ouverte', `ouverte depuis 14${H}32`, true],
    ['Porte du garage', 'inconnue', 'Indisponible', `indisponible depuis 12${H}00`, false],
  ]);
  assert.deepEqual(vue.lignes.slice(3).map((l) => l.nom), ['Baie vitrée gauche', 'Baie vitrée droite', 'Baie vitrée centrale', 'Fenêtre salon', 'Fenêtre chambre', 'Porte-fenêtre bureau']);
  assert.equal(vue.lignes[4].pileFaible, true, 'pile faible d\'une ouverture fermée');
  assert.deepEqual([vue.ouvertes, vue.indisponibles, vue.resume, vue.resumeCourt], [2, 1, `2${ESP}ouvertures`, `2${ESP}ouvertures`]);
  assert.equal(vue.detail, `1${ESP}capteur indisponible`);
});

test('ouvertures : une seule au singulier ; capteur indisponible sans ouverture = « Aucune ouverture signalée », jamais « Tout est fermé »', () => {
  const une = vueOuvertures(avec({ [capteur('baie_vitree_centrale')]: { state: 'on' } }), MAINTENANT);
  assert.deepEqual([une.resume, une.resumeCourt], [`1${ESP}ouverture`, `1${ESP}ouverture`]);
  const muet = vueOuvertures(avec({ [capteur('fenetre_salon')]: { state: 'unknown' }, [capteur('porte_fenetre_bureau')]: { state: 'unavailable' } }), MAINTENANT);
  assert.deepEqual([muet.resume, muet.detail, muet.resumeCourt], ['Aucune ouverture signalée', `2${ESP}capteurs indisponibles`, 'à vérifier']);
  const sansRien = vueOuvertures({}, MAINTENANT);
  assert.deepEqual([sansRien.resume, sansRien.detail, sansRien.resumeCourt], ['Capteurs indisponibles', null, 'capteurs indisponibles']);
  assert.ok(sansRien.lignes.every((l) => l.etat === 'inconnue' && l.depuis === null));
});

test('télécommandes : état de l\'Apple TV et de la télé, applis de source_list, joignabilité par les remote', () => {
  const vue = vueTelecommandes(ENTITES);
  assert.equal(vue.appletv.etat, `Apple TV${ESP}: éteinte`);
  assert.equal(vue.appletv.joignable, true);
  assert.equal(vue.appletv.applis.length, 24);
  assert.ok(vue.appletv.applis.includes('Netflix'));
  assert.deepEqual(vue.tele, { etat: `Télé${ESP}: éteinte`, joignable: true });
  const autre = vueTelecommandes(avec({ 'media_player.sejour_sejour': { state: 'playing' }, 'remote.smart_tv_pro_2': { state: 'unavailable' } }));
  assert.equal(autre.appletv.etat, `Apple TV${ESP}: lecture en cours`);
  assert.equal(autre.tele.joignable, false);
  assert.deepEqual(vueTelecommandes({}), {
    appletv: { etat: `Apple TV${ESP}: inconnue de la maison`, joignable: false, applis: [] },
    tele: { etat: `Télé${ESP}: inconnue de la maison`, joignable: false },
  });
});

test('sonnette : dernier coup VU par le serveur ; sans lui, « dernier changement » (peut être un redémarrage) ; caméra disponible ou non', () => {
  const entites = avec({ 'binary_sensor.doorbell_ringing': { state: 'off', last_changed: '2026-10-14T11:09:06+00:00' } });
  const suivi = { dernier_coup: '2026-10-14T09:49:57+00:00', photo: 'du_coup', photo_le: '2026-10-14T09:50:10+00:00' };
  assert.deepEqual(vueSonnette(entites, suivi, MAINTENANT), { dernier: `Dernier coup de sonnette${ESP}: aujourd'hui à 11${H}49`, cameraDisponible: true });
  const sansCoup = { dernier_coup: null, photo: 'inconnue', photo_le: null };
  assert.equal(vueSonnette(entites, sansCoup, MAINTENANT).dernier, `Sonnette, dernier changement${ESP}: aujourd'hui à 13${H}09`);
  assert.equal(vueSonnette(entites, null, MAINTENANT).dernier, `Sonnette, dernier changement${ESP}: aujourd'hui à 13${H}09`, 'suivi pas encore reçu');
  assert.equal(vueSonnette(avec({ 'camera.sonnette_derniere_photo': { state: 'unavailable' } }), suivi, MAINTENANT).cameraDisponible, false);
  assert.deepEqual(vueSonnette({}, null, MAINTENANT), { dernier: 'Aucun coup de sonnette connu', cameraDisponible: false });
});

test('entretien : encres en %, alerte sous 15 %, niveau inconnu sans unité ; piles faibles nommées avec leur appareil', () => {
  const entites = avec({
    'sensor.hp_deskjet_2800_series_black_ink': { state: '12' },
    'binary_sensor.salon_battery_low': { state: 'on' },
    'binary_sensor.porte_d_entree_battery_low': { state: 'on' },
  });
  assert.deepEqual(encres(entites).map(({ nom, niveau, texte, alerte }) => [nom, niveau, texte, alerte]), [
    ['Encre noire', 12, `12${ESP}%`, true],
    ['Encre couleur', Number(ENTITES['sensor.hp_deskjet_2800_series_tri_color_ink'].state), `${ENTITES['sensor.hp_deskjet_2800_series_tri_color_ink'].state}${ESP}%`, false],
  ]);
  assert.deepEqual(pilesFaibles(entites), ['Capteur porte d\'entrée', 'Détecteur du salon']);
  const vue = vueEntretien(entites);
  assert.equal(vue.capteurs, 12);
  assert.equal(vue.piles.length, 2);
  const sansUnite = structuredClone(entites);
  delete sansUnite['sensor.hp_deskjet_2800_series_black_ink'].attributes.unit_of_measurement;
  assert.deepEqual(encres(sansUnite)[0], { nom: 'Encre noire', niveau: null, texte: 'niveau inconnu', alerte: false });
});

test('piles : un nom pour chacune des 12 piles de la liste blanche du serveur, les ouvertures au nom de la vue Alarme', () => {
  const duServeur = Object.keys(LISTE_BLANCHE).filter((id) => id.endsWith('_battery_low')).sort();
  assert.deepEqual(PILES.map(({ cle }) => `binary_sensor.${cle}_battery_low`).sort(), duServeur);
  const noms = Object.fromEntries(PILES.map(({ cle, nom }) => [cle, nom]));
  assert.equal(noms.baie_vitree_droit, 'Capteur baie vitrée droite', 'même nom que la vue Alarme, pas « Baie vitrée droit » de HA');
  assert.equal(noms.porte_fenetre_bureau, 'Capteur porte-fenêtre bureau');
  assert.deepEqual([noms.garage, noms.salon], ['Détecteur du garage', 'Détecteur du salon']);
});

test('mot de passe du Wi-Fi invités : découpé en lettres et chiffres, rien perdu ni ajouté', () => {
  assert.deepEqual(decouperMotDePasse('lI1O0o-2026'), [
    { texte: 'lI', chiffres: false }, { texte: '1', chiffres: true }, { texte: 'O', chiffres: false }, { texte: '0', chiffres: true },
    { texte: 'o-', chiffres: false }, { texte: '2026', chiffres: true },
  ]);
  assert.equal(decouperMotDePasse('Invités;du salon 2026').map((m) => m.texte).join(''), 'Invités;du salon 2026');
  assert.deepEqual(decouperMotDePasse(''), []);
});
