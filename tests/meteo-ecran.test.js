// tests/meteo-ecran.test.js
//
// Rôle    : prouver web/src/ecrans/meteo-donnees.js (vue de l'écran Météo allégée le 14/10, sans DOM) et les niveaux de
//           web/src/air.js : ligne courte du temps actuel (vent seulement s'il est fort), 48 heures heure par heure
//           (heure de Paris, nom du jour, pluie seulement si elle est prévue), pluie dans l'heure (total ou heure
//           sèche), 7 jours (pluie au-delà de 0,5 mm, vent à partir de 40 km/h, unités converties), indice de l'air
//           (demain seulement s'il est pire), pollens présents seulement, ligne des crédits.
// Entrées : fixtures réelles : ha-meteo-horaire.json (weather.get_forecasts de met.no via HA, capturé par le flux
//           le 13/10 à 18h10), ha_states.json, réponses Open-Meteo du 11/10 passées par les analyseurs du serveur
//           (la page est testée sur la forme exacte de ce que le flux lui envoie).
// Sorties : node --test.
// Pièges  : ESP est l'espace insécable des textes. Les heures de HA sont en UTC : 16:00 UTC le 13/10 = 18h à Paris.
//           Les seuils (40 km/h, 0,5 mm) sont testés à leur bord et dans une autre unité (m/s, inch).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { projeter } from '../serveur/ha/entites.js';
import { analyserAir, analyserPluie, analyserSemaine } from '../serveur/sources/open-meteo.js';
import { niveauPollen, TAXONS } from '../web/src/air.js';
import {
  credits, vueAirPollens, vueDansLHeure, vueHeures, vueJours, vueMaintenant, vueMeteoEcran,
} from '../web/src/ecrans/meteo-donnees.js';

const lire = (nom) => JSON.parse(readFileSync(new URL(`./fixtures/${nom}`, import.meta.url), 'utf8'));
const ENTITES = projeter(Object.fromEntries(lire('ha_states.json').map((etat) => [etat.entity_id, etat])));
const HORAIRE = lire('ha-meteo-horaire.json');
const AIR = analyserAir(lire('open-meteo-air.json'), '2026-10-11');
const PLUIE = analyserPluie(lire('open-meteo-pluie.json'));
const SEMAINE = analyserSemaine(lire('open-meteo-semaine.json'), '2026-10-11T14:00');
const ESP = '\u00a0';
const utc = (texte) => Date.parse(`${texte}Z`);
const A_18H10 = utc('2026-10-13T16:10');
const taxon = (nom) => TAXONS.filter((t) => t.nom === nom)[0];

test('maintenant : température, pictogramme et ciel de weather.forecast_maison, sans le vent s\'il est faible', () => {
  assert.deepEqual(vueMaintenant(ENTITES), {
    temperature: '14°', picto: 'i-partly', libelle: 'Éclaircies', vent: null,
  }, '14,4 km/h : vent faible, pas affiché');
  const avecVent = (vitesse, unite = 'km/h') => {
    const entites = structuredClone(ENTITES);
    Object.assign(entites['weather.forecast_maison'].attributes, { wind_speed: vitesse, wind_speed_unit: unite });
    return vueMaintenant(entites).vent;
  };
  assert.equal(avecVent(39.9), null, 'juste sous le seuil');
  assert.equal(avecVent(40), `40${ESP}km/h`, 'seuil : 40 km/h, début de la force 6 de Beaufort');
  assert.equal(avecVent(52.6), `53${ESP}km/h`);
  assert.equal(avecVent(11.2, 'm/s'), `11${ESP}m/s`, '11,2 m/s = 40,3 km/h : converti avant d\'être comparé');
  assert.equal(avecVent(10, 'm/s'), null, '10 m/s = 36 km/h');
  assert.equal(avecVent(80, 'beaufort'), null, 'unité inconnue : jamais affiché');
  const indisponible = structuredClone(ENTITES);
  indisponible['weather.forecast_maison'].state = 'unavailable';
  delete indisponible['weather.forecast_maison'].attributes.temperature;
  assert.deepEqual(vueMaintenant(indisponible), {
    temperature: null, picto: null, libelle: 'Météo indisponible', vent: null,
  });
  assert.equal(vueMaintenant({}), null);
});

test('48 heures : à partir de l\'heure en cours, heure de Paris, nom du jour sur la première heure et à minuit', () => {
  const vue = vueHeures(HORAIRE, ENTITES, A_18H10);
  assert.equal(vue.heures.length, 48);
  assert.deepEqual(vue.heures[0], {
    heure: '18h', jour: 'Aujourd\'hui', picto: 'i-partly', libelle: 'Éclaircies', temperature: '19°', pluie: null,
  });
  assert.deepEqual(vue.heures.map((h) => h.jour).filter(Boolean), ['Aujourd\'hui', 'Demain', 'Jeu 15']);
  assert.equal(vue.heures[6].heure, '0h');
  assert.equal(vue.heures[6].jour, 'Demain');
  assert.equal(vue.heures[2].picto, 'i-moon', 'clear-night de met.no');
  assert.equal(vue.etiquettePluie, 'Pluie en mm', 'unité de la pluie dans l\'étiquette de la goutte, pas de légende');
  assert.equal(vue.avecPluie, false, 'aucune heure pluvieuse le 13/10 : pas de rangée de pluie');
  // Chaque température est celle de la source, arrondie.
  vue.heures.forEach((h, i) => assert.equal(h.temperature, `${Math.round(HORAIRE.horaire[i].temperature)}°`));
});

test('48 heures, le soir : « Aujourd\'hui » n\'est pas écrit à moins de 3 colonnes avant minuit (il chevauchait « Demain »)', () => {
  const heures = (ms) => vueHeures(HORAIRE, ENTITES, ms).heures;
  const a21h10 = utc('2026-10-13T19:10');
  assert.deepEqual(heures(a21h10).slice(0, 4).map((h) => [h.heure, h.jour]), [['21h', 'Aujourd\'hui'], ['22h', null], ['23h', null], ['0h', 'Demain']], '3 colonnes : le nom tient');
  const a22h10 = utc('2026-10-13T20:10');
  assert.deepEqual(heures(a22h10).slice(0, 3).map((h) => [h.heure, h.jour]), [['22h', null], ['23h', null], ['0h', 'Demain']]);
  const a23h50 = utc('2026-10-13T21:50');
  assert.deepEqual(heures(a23h50).slice(0, 2).map((h) => [h.heure, h.jour]), [['23h', null], ['0h', 'Demain']]);
});

test('48 heures : une heure passée disparaît, la pluie n\'est donnée que sur les heures où elle est prévue', () => {
  assert.equal(vueHeures(HORAIRE, ENTITES, utc('2026-10-13T17:00')).heures[0].heure, '19h');
  assert.equal(vueHeures(HORAIRE, ENTITES, utc('2026-10-13T17:00')).heures.length, 47);
  assert.ok(vueHeures(HORAIRE, ENTITES, A_18H10).heures.every((h) => h.pluie === null), 'aucune pluie prévue le 13/10 : aucune goutte');
  const mouille = structuredClone(HORAIRE);
  mouille.horaire[1].precipitation = 1.25;
  mouille.horaire[2].precipitation = null;
  mouille.horaire[3].precipitation = 0;
  const vue = vueHeures(mouille, ENTITES, A_18H10);
  assert.deepEqual(vue.heures.slice(0, 4).map((h) => h.pluie), [null, '1,3', null, null]);
  assert.equal(vue.avecPluie, true);
  const pouces = structuredClone(ENTITES);
  pouces['weather.forecast_maison'].attributes.precipitation_unit = 'in';
  pouces['weather.forecast_maison'].attributes.temperature_unit = '°F';
  const enPouces = vueHeures(HORAIRE, pouces, A_18H10);
  assert.equal(enPouces.etiquettePluie, 'Pluie en in', 'unité lue dans l\'entité');
  assert.equal(enPouces.heures[0].temperature, `19${ESP}°F`);
  assert.equal(vueHeures(null, ENTITES, A_18H10), null);
});

test('pluie dans l\'heure : heure sèche sans total, sinon les 4 quarts d\'heure à l\'échelle du plus fort (plancher 1 mm) et le total', () => {
  const a14h20 = utc('2026-10-11T12:20');
  const seche = vueDansLHeure(PLUIE, a14h20);
  assert.deepEqual(seche.pas.map((p) => p.heure), ['14:30', '14:45', '15:00', '15:15']);
  assert.equal(seche.total, null, 'heure sèche : l\'écran dit « Pas de pluie », sans barres');
  assert.ok(seche.pas.every((p) => p.part === 0));
  const mouille = { ...PLUIE, pas: PLUIE.pas.map((p, i) => ({ ...p, precipitation: [0, 0.2, 0.6, 2, 0.1][i] === undefined ? p.precipitation : [0, 0.2, 0.6, 2, 0.1][i] })) };
  const vue = vueDansLHeure(mouille, a14h20);
  assert.deepEqual(vue.pas.map((p) => p.part), [0.1, 0.3, 1, 0.05]);
  assert.equal(vue.total, `2,9${ESP}mm`);
  const bruine = { ...PLUIE, pas: PLUIE.pas.map((p) => ({ ...p, precipitation: 0.2 })) };
  assert.ok(vueDansLHeure(bruine, a14h20).pas.every((p) => p.part === 0.2), 'plancher de 1 mm : une bruine ne remplit pas la barre');
  assert.equal(vueDansLHeure(bruine, a14h20).total, `0,8${ESP}mm`);
  assert.equal(vueDansLHeure(PLUIE, utc('2026-10-11T16:00')), null, 'données trop anciennes');
  assert.equal(vueDansLHeure(null, a14h20), null);
});

test('7 jours : nom, ciel, maxi et mini ; ni pluie ni vent sous leur seuil (réponse réelle du 11/10, sèche et calme)', () => {
  const jours = vueJours(SEMAINE, utc('2026-10-11T12:20'));
  assert.equal(jours.length, 7);
  const source = SEMAINE.jours[0];
  assert.deepEqual(jours[0], {
    nom: 'Aujourd\'hui',
    aujourdhui: true,
    picto: 'i-cloud',
    libelle: 'Couvert',
    maxi: `${Math.round(source.temperature_2m_max)}°`,
    mini: `${Math.round(source.temperature_2m_min)}°`,
    pluie: null,
    vent: null,
  });
  assert.deepEqual(jours.map((j) => j.nom), ['Aujourd\'hui', 'Demain', 'Mar 13', 'Mer 14', 'Jeu 15', 'Ven 16', 'Sam 17']);
  assert.ok(jours.every((j) => j.pluie === null && j.vent === null), '0 mm et 16 km/h au plus : rien à signaler');
  assert.equal(vueJours(null, 0), null);
});

test('7 jours : pluie au-delà de 0,5 mm, vent à partir de 40 km/h, valeurs converties depuis leur unité', () => {
  const jour = (champs, unites = {}) => {
    const semaine = structuredClone(SEMAINE);
    Object.assign(semaine.jours[0], champs);
    Object.assign(semaine.unites, unites);
    const { pluie, vent } = vueJours(semaine, utc('2026-10-11T12:20'))[0];
    return [pluie, vent];
  };
  assert.deepEqual(jour({ precipitation_sum: 0.5, wind_speed_10m_max: 39.4 }), [null, null], 'au seuil de pluie, sous le seuil de vent');
  assert.deepEqual(jour({ precipitation_sum: 0.6, wind_speed_10m_max: 40 }), [`0,6${ESP}mm`, `40${ESP}km/h`]);
  assert.deepEqual(jour({ precipitation_sum: 24.1, wind_speed_10m_max: 61.7 }), [`24,1${ESP}mm`, `62${ESP}km/h`]);
  assert.deepEqual(
    jour({ precipitation_sum: 0.1, wind_speed_10m_max: 25 }, { precipitation_sum: 'inch', wind_speed_10m_max: 'mp/h' }),
    [`0,1${ESP}inch`, `25${ESP}mp/h`],
    '0,1 inch = 2,5 mm et 25 mp/h = 40,2 km/h : convertis avant d\'être comparés',
  );
  assert.deepEqual(jour({ precipitation_sum: null, wind_speed_10m_max: null }), [null, null]);
  assert.deepEqual(jour({ precipitation_sum: 3, wind_speed_10m_max: 90 }, { precipitation_sum: '?', wind_speed_10m_max: '?' }), [null, null], 'unité inconnue : rien');
});

test('niveaux de pollen par taxon : aucun sous 1 grain/m³, puis faible, moyen et élevé aux seuils [S] ; null = inconnu', () => {
  const bouleau = taxon('bouleau');
  const cas = [[0, 'aucun'], [0.9, 'aucun'], [1, 'faible'], [9.9, 'faible'], [10, 'moyen'], [99, 'moyen'], [100, 'élevé'], [800, 'élevé']];
  for (const [valeur, libelle] of cas) assert.equal(niveauPollen(bouleau, valeur).libelle, libelle, `bouleau ${valeur}`);
  assert.equal(niveauPollen(taxon('graminées'), 50).libelle, 'élevé');
  assert.equal(niveauPollen(taxon('ambroisie'), 5).libelle, 'moyen', 'ambroisie : moyen dès 5');
  assert.equal(niveauPollen(bouleau, null), null);
  assert.deepEqual(TAXONS.map((t) => t.nom), ['aulne', 'bouleau', 'olivier', 'graminées', 'armoise', 'ambroisie']);
});

test('air : niveau avec sa pastille, « indice 25 » (un nombre seul se lisait comme une température), demain seulement s\'il est pire qu\'aujourd\'hui (réponse réelle du 11/10)', () => {
  const vue = vueAirPollens(AIR, utc('2026-10-11T12:20'));
  assert.deepEqual([vue.classe, vue.libelle, vue.indice], ['aqi-2', 'Moyen', 'indice 25']);
  assert.equal(AIR.jours[1].european_aqi, 34, 'maximum du 12/10 dans la réponse réelle');
  assert.equal(vue.demain, null, 'maximum de 34 demain, de 27 aujourd\'hui : moyen les deux jours, rien à signaler');
  const pire = structuredClone(AIR);
  pire.jours[1].european_aqi = 47;
  assert.deepEqual(vueAirPollens(pire, utc('2026-10-11T12:20')).demain, { classe: 'aqi-3', libelle: 'dégradé' });
  pire.jours[0].european_aqi = 45;
  assert.equal(vueAirPollens(pire, utc('2026-10-11T12:20')).demain, null, 'dégradé aussi aujourd\'hui (maximum), même si l\'indice du moment est moyen');
  pire.jours[1].european_aqi = 12;
  assert.equal(vueAirPollens(pire, utc('2026-10-11T12:20')).demain, null, 'meilleur demain : rien');
  const sansAujourdhui = structuredClone(AIR);
  sansAujourdhui.jours[0].european_aqi = 47;
  assert.deepEqual(vueAirPollens(sansAujourdhui, utc('2026-10-10T12:00')).demain, { classe: 'aqi-3', libelle: 'dégradé' }, 'le 10/10 n\'est pas dans la réponse : comparé à l\'indice du moment (25)');
  assert.equal(vueAirPollens(AIR, utc('2026-10-14T12:00')).demain, null, 'demain hors de la réponse');
  const sansIndice = structuredClone(AIR);
  sansIndice.actuel.european_aqi = null;
  const vide = vueAirPollens(sansIndice, utc('2026-10-11T12:20'));
  assert.deepEqual([vide.classe, vide.libelle, vide.indice, vide.demain], [null, 'Indice indisponible', '', null]);
  assert.equal(vueAirPollens(null, 0), null);
});

test('pollens : seulement les taxons présents aujourd\'hui, du plus fort au plus faible ; sinon une seule ligne', () => {
  const a14h20 = utc('2026-10-11T12:20');
  assert.deepEqual(vueAirPollens(AIR, a14h20).pollens, { lignes: [], message: 'Pas de pollen' }, '0,1 grain/m³ de graminées : une trace');
  const air = structuredClone(AIR);
  Object.assign(air.jours[0], { grass_pollen: 2, ragweed_pollen: 12.4, birch_pollen: 150 });
  air.jours[1].alder_pollen = 300;
  assert.deepEqual(vueAirPollens(air, a14h20).pollens, {
    lignes: [
      { nom: 'Bouleau', niveau: 'élevé', rang: 3 },
      { nom: 'Ambroisie', niveau: 'moyen', rang: 2 },
      { nom: 'Graminées', niveau: 'faible', rang: 1 },
    ],
    message: null,
  }, 'l\'aulne de demain ne compte pas');
  const partiel = structuredClone(AIR);
  partiel.jours[0].olive_pollen = null;
  assert.equal(vueAirPollens(partiel, a14h20).pollens.message, 'Pas de pollen');
  const inconnu = structuredClone(AIR);
  TAXONS.forEach((t) => { inconnu.jours[0][t.cle] = null; });
  assert.deepEqual(vueAirPollens(inconnu, a14h20).pollens, { lignes: [], message: `Pollens${ESP}: pas de donnée` }, 'jamais « pas de pollen » sans donnée');
  assert.equal(vueAirPollens(AIR, utc('2026-10-20T12:00')).pollens.message, `Pollens${ESP}: pas de donnée`, 'jour absent de la réponse');
});

test('crédits : une seule ligne, met.no (attribution lue dans HA), Open-Meteo (CC BY 4.0) et CAMS/Copernicus', () => {
  assert.equal(credits(ENTITES), `Sources${ESP}: met.no · Open-Meteo.com (CC BY 4.0) · CAMS/Copernicus`);
  assert.equal(credits({}), `Sources${ESP}: Open-Meteo.com (CC BY 4.0) · CAMS/Copernicus`);
  const autre = structuredClone(ENTITES);
  autre['weather.forecast_maison'].attributes.attribution = 'Données Météo-France';
  assert.equal(credits(autre), `Sources${ESP}: Données Météo-France · Open-Meteo.com (CC BY 4.0) · CAMS/Copernicus`, 'autre fournisseur : attribution reprise telle quelle');
});

test('vue complète avant toute donnée : chaque bloc vide, crédits Open-Meteo seuls', () => {
  assert.deepEqual(vueMeteoEcran({ entites: {}, meteo: null, pluie: null, semaine: null, air: null }, A_18H10), {
    maintenant: null, heures: null, dansLHeure: null, jours: null, air: null, credits: credits({}),
  });
});
