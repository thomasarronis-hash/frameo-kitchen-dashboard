// tests/open-meteo.test.js
//
// Rôle    : prouver serveur/sources/open-meteo.js : analyse des réponses (maxima par jour J, J+1, J+2, unités
//           reprises, 7 jours de la semaine, ciel de la journée tiré des heures, null gérés, réponses
//           malformées refusées) ET branchement des trois sources (URL exactes de la conception §2.2,
//           rythme de relecture, erreur HTTP d'Open-Meteo).
// Entrées : tests/fixtures/open-meteo-air.json et open-meteo-pluie.json, réponses réelles enregistrées le
//           11/10/2026 vers 14h20 (heure de Paris), et open-meteo-semaine.json, enregistrée le même jour à
//           16h39 ; docs/conception.md (§2.2), d'où les URL attendues sont relues.
// Sorties : node --test.
// Pièges  :
//   - Les réponses réelles du 11/10 n'ont aucun null : les null sont injectés dans une copie.
//   - Les URL attendues viennent du tableau du §2.2 : modifier une URL dans le code sans la conception
//     (ou l'inverse) fait échouer le test.
//   - fetch est remplacé par un faux (t.mock.method) et les minuteries sont simulées (t.mock.timers) ;
//     setImmediate reste réel et sert à laisser finir les lectures asynchrones.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dateParis, debutHeureParis } from '../serveur/heure-paris.js';
import {
  analyserAir, analyserPluie, analyserSemaine, cielDeLaJournee, creerSourcesOpenMeteo,
} from '../serveur/sources/open-meteo.js';

const lire = (nom) => JSON.parse(readFileSync(new URL(`./fixtures/${nom}`, import.meta.url), 'utf8'));
const AIR = lire('open-meteo-air.json');
const PLUIE = lire('open-meteo-pluie.json');
const SEMAINE = lire('open-meteo-semaine.json');
const TAXONS = ['alder_pollen', 'birch_pollen', 'grass_pollen', 'mugwort_pollen', 'olive_pollen', 'ragweed_pollen'];
const MINUTE = 60_000;

// Maximum attendu, recalculé ici indépendamment du code testé.
function maxDuJour(json, variable, date) {
  const valeurs = json.hourly.time.flatMap((heure, i) => (heure.startsWith(date) && json.hourly[variable][i] !== null ? [json.hourly[variable][i]] : []));
  return valeurs.length ? Math.max(...valeurs) : null;
}

test('air : valeurs actuelles et unités reprises telles quelles', () => {
  const air = analyserAir(AIR, '2026-10-11');
  assert.deepEqual(air.actuel, { time: '2026-10-11T14:00', european_aqi: 25, pm2_5: 3.5, pm10: 7.1, ozone: 69, nitrogen_dioxide: 0.8 });
  assert.equal(air.unites.european_aqi, 'EAQI');
  assert.equal(air.unites.pm2_5, 'μg/m³');
  for (const taxon of TAXONS) assert.equal(air.unites[taxon], 'grains/m³');
});

test('air : J, J+1 et J+2 avec le maximum de chaque journée', () => {
  const air = analyserAir(AIR, '2026-10-11');
  assert.deepEqual(air.jours.map((jour) => jour.date), ['2026-10-11', '2026-10-12', '2026-10-13']);
  for (const jour of air.jours) {
    for (const variable of ['european_aqi', ...TAXONS]) {
      assert.equal(jour[variable], maxDuJour(AIR, variable, jour.date), `${jour.date} ${variable}`);
    }
  }
});

test('air : « aujourd\'hui » décale la fenêtre ; les jours passés de la réponse sont ignorés', () => {
  const air = analyserAir(AIR, '2026-10-12');
  assert.deepEqual(air.jours.map((jour) => jour.date), ['2026-10-12', '2026-10-13', '2026-10-14']);
  assert.equal(analyserAir(AIR, '2026-10-20').jours.length, 0);
});

test('air : null gérés (valeur actuelle nulle, heures nulles ignorées, journée toute nulle = null)', () => {
  const copie = structuredClone(AIR);
  copie.current.european_aqi = null;
  copie.hourly.time.forEach((heure, i) => {
    if (heure.startsWith('2026-10-12')) copie.hourly.grass_pollen[i] = null;
    if (heure === '2026-10-11T00:00') copie.hourly.european_aqi[i] = null;
  });
  const air = analyserAir(copie, '2026-10-11');
  assert.equal(air.actuel.european_aqi, null);
  assert.equal(air.jours[1].grass_pollen, null);
  assert.equal(air.jours[0].european_aqi, maxDuJour(copie, 'european_aqi', '2026-10-11'));
  assert.notEqual(air.jours[0].european_aqi, null);
});

test('pluie : 8 pas de 15 min en heure de Paris, unité reprise de la réponse', () => {
  const pluie = analyserPluie(PLUIE);
  assert.equal(pluie.unite, 'mm');
  assert.equal(pluie.pas.length, 8);
  assert.deepEqual(pluie.pas[0], { time: '2026-10-11T14:15', precipitation: 0 });
  assert.equal(pluie.pas[7].time, '2026-10-11T16:00');
});

test('pluie : un pas sans valeur reste null', () => {
  const copie = structuredClone(PLUIE);
  copie.minutely_15.precipitation[2] = null;
  copie.minutely_15.precipitation[3] = 0.4;
  const pluie = analyserPluie(copie);
  assert.equal(pluie.pas[2].precipitation, null);
  assert.equal(pluie.pas[3].precipitation, 0.4);
});

test('réponses malformées ou d\'erreur refusées', () => {
  assert.throws(() => analyserAir({ error: true, reason: 'Cannot initialize WeatherVariable' }, '2026-10-11'), /réponse inattendue/);
  assert.throws(() => analyserPluie({ error: true, reason: 'x' }), /réponse inattendue/);
  const texte = structuredClone(PLUIE);
  texte.minutely_15.precipitation[0] = '0.0';
  assert.throws(() => analyserPluie(texte), /réponse inattendue/);
  const tronquee = structuredClone(AIR);
  tronquee.hourly.birch_pollen.pop();
  assert.throws(() => analyserAir(tronquee, '2026-10-11'), /birch_pollen n'a pas autant de valeurs/);
});

test('ciel de la journée : le plus sévère qui couvre 3 heures, sinon le plus fréquent (le plus sévère à égalité)', () => {
  assert.equal(cielDeLaJournee([45, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 0, 'une heure de brouillard ne fait pas la journée');
  assert.equal(cielDeLaJournee([0, 0, 0, 61, 61, 61, 3, 3, 3, 3, 3, 3]), 61, '3 heures de pluie suffisent');
  assert.equal(cielDeLaJournee([0, 0, 0, 0, 2, 2, 2, 2, 3, 3, 95, 95]), 2, '2 heures d\'orage ne suffisent pas');
  assert.equal(cielDeLaJournee([0, 0, 1, 1, 2, 2]), 2, 'aucun code sur 3 heures : le plus fréquent, le plus sévère à égalité');
  assert.equal(cielDeLaJournee([1, 3]), 3, 'moins de 3 heures : il faut les couvrir toutes, sinon le plus sévère des plus fréquents');
  assert.equal(cielDeLaJournee([2, 2]), 2);
  assert.equal(cielDeLaJournee([]), null);
});

test('semaine : 7 jours, températures et unités reprises telles quelles, ciel tiré des heures de jour', () => {
  const semaine = analyserSemaine(SEMAINE, '2026-10-11T00:00');
  assert.deepEqual(semaine.jours.map((jour) => jour.date), ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
  assert.deepEqual(semaine.jours[1], {
    date: '2026-10-12',
    code_ciel: 0,
    temperature_2m_max: 17.7,
    temperature_2m_min: 6.5,
    precipitation_sum: 0,
    wind_speed_10m_max: 10.6,
  });
  assert.equal(semaine.jours[6].temperature_2m_min, 12.9);
  assert.deepEqual(semaine.unites, {
    temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_sum: 'mm', wind_speed_10m_max: 'km/h',
  });
  // Réponse réelle du 11/10 : le code quotidien d'Open-Meteo (le pire des 24 h) donnait « brouillard » 6 jours
  // sur 7 ; les heures de jour donnent : 13/10 couvert (5 h), 15/10 éclaircies (le brouillard s'arrête à 9h),
  // 16/10 ensoleillé, 17/10 couvert. Le 11 et le 14, le brouillard tient de 8h à 11h : 3 heures de jour.
  assert.deepEqual(semaine.jours.map((jour) => jour.code_ciel), [45, 0, 3, 45, 2, 0, 3]);
});

test('semaine : aujourd\'hui, seules les heures restantes comptent ; après 20h, celles qui restent jusqu\'à minuit', () => {
  assert.equal(analyserSemaine(SEMAINE, '2026-10-11T16:00').jours[0].code_ciel, 3, '16h : le brouillard du matin est passé');
  assert.equal(analyserSemaine(SEMAINE, '2026-10-11T21:00').jours[0].code_ciel, 2, '21h : 21h, 22h et 23h');
  assert.equal(analyserSemaine(SEMAINE, '2026-10-12T00:30').jours[0].code_ciel, null, 'jour passé : plus aucune heure');
  assert.deepEqual(analyserSemaine(SEMAINE, '2026-10-11T16:00').jours.slice(1), analyserSemaine(SEMAINE, '2026-10-11T00:00').jours.slice(1), 'les autres jours ne bougent pas');
});

test('semaine : null gardés tels quels ; heures sans code ignorées, journée sans code = null', () => {
  const copie = structuredClone(SEMAINE);
  copie.daily.temperature_2m_max[5] = null;
  copie.daily.precipitation_sum[4] = null;
  copie.hourly.time.forEach((heure, i) => {
    if (heure.startsWith('2026-10-17')) copie.hourly.weather_code[i] = null;
    if (heure === '2026-10-15T12:00' || heure === '2026-10-15T13:00') copie.hourly.weather_code[i] = null;
  });
  const { jours } = analyserSemaine(copie, '2026-10-11T00:00');
  assert.equal(jours[6].code_ciel, null);
  assert.equal(jours[5].temperature_2m_max, null);
  assert.equal(jours[4].precipitation_sum, null);
  assert.equal(jours[4].temperature_2m_max, 24);
  assert.equal(jours[4].code_ciel, 0, 'les éclaircies du 15 tombent à 1 heure : ciel dégagé');
});

test('semaine : réponses malformées ou d\'erreur refusées', () => {
  const maintenant = '2026-10-11T00:00';
  assert.throws(() => analyserSemaine({ error: true, reason: 'Data corrupted' }, maintenant), /réponse inattendue/);
  const codeDecimal = structuredClone(SEMAINE);
  codeDecimal.hourly.weather_code[0] = 45.5;
  assert.throws(() => analyserSemaine(codeDecimal, maintenant), /réponse inattendue/);
  const dateHoraire = structuredClone(SEMAINE);
  dateHoraire.daily.time[0] = '2026-10-11T00:00';
  assert.throws(() => analyserSemaine(dateHoraire, maintenant), /réponse inattendue/);
  const sansHoraire = structuredClone(SEMAINE);
  delete sansHoraire.hourly;
  assert.throws(() => analyserSemaine(sansHoraire, maintenant), /réponse inattendue/);
  const sansVent = structuredClone(SEMAINE);
  delete sansVent.daily.wind_speed_10m_max;
  assert.throws(() => analyserSemaine(sansVent, maintenant), /réponse inattendue/);
  const tronquee = structuredClone(SEMAINE);
  tronquee.daily.temperature_2m_min.pop();
  assert.throws(() => analyserSemaine(tronquee, maintenant), /temperature_2m_min n'a pas autant de valeurs/);
  const codesTronques = structuredClone(SEMAINE);
  codesTronques.hourly.weather_code.pop();
  assert.throws(() => analyserSemaine(codesTronques, maintenant), /weather_code n'a pas autant de valeurs/);
});

test('dateParis et debutHeureParis : la date et l\'heure de Paris, pas celles d\'UTC', () => {
  assert.equal(dateParis(new Date('2026-10-10T22:30:00Z')), '2026-10-11');
  assert.equal(dateParis(new Date('2026-12-31T22:59:00Z')), '2026-12-31');
  assert.equal(dateParis(new Date('2026-12-31T23:00:00Z')), '2027-01-01');
  assert.equal(debutHeureParis(new Date('2026-10-10T22:30:00Z')), '2026-10-11T00:00');
  assert.equal(debutHeureParis(new Date('2026-10-11T12:59:59Z')), '2026-10-11T14:00');
  assert.equal(debutHeureParis(new Date('2026-10-25T01:30:00Z')), '2026-10-25T02:00', 'heure d\'hiver (CET)');
});

// --- Branchement des sources ---

const CONCEPTION = readFileSync(new URL('../docs/conception.md', import.meta.url), 'utf8');
const URL_CONCEPTION = [...CONCEPTION.matchAll(/`(https:\/\/[a-z-]+\.open-meteo\.com\/[^`]+)`/g)].map((m) => m[1]);
const PARIS = { nom: 'Paris', latitude: 48.8566, longitude: 2.3522 };
const REPONSES = [[/air-quality/, AIR], [/minutely_15/, PLUIE], [/forecast_days=7/, SEMAINE]];

function journalCapture() {
  const lignes = [];
  return { lignes, info: (m) => lignes.push(m), warn: (m) => lignes.push(m), error: (m) => lignes.push(m) };
}

// Faux fetch : la réponse enregistrée qui correspond à l'URL, ou l'erreur imposée par panne.erreur.
function fauxFetch(panne) {
  const appels = [];
  const fetch = async (url) => {
    appels.push(url);
    if (panne.erreur) return { ok: false, status: 400, json: async () => panne.erreur };
    const [, corps] = REPONSES.find(([motif]) => motif.test(url));
    return { ok: true, status: 200, json: async () => structuredClone(corps) };
  };
  return { appels, fetch };
}

const laisserFinir = () => new Promise((resoudre) => setImmediate(resoudre));

test('sources Open-Meteo : air, pluie et semaine appellent chacune exactement une URL du §2.2, puis publient', async (t) => {
  assert.equal(URL_CONCEPTION.length, 3, 'le §2.2 doit citer 3 URL Open-Meteo');
  const { appels, fetch } = fauxFetch({});
  t.mock.method(globalThis, 'fetch', fetch);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sources = creerSourcesOpenMeteo(journalCapture(), PARIS);
  t.after(() => Object.values(sources).forEach((source) => source.arreter()));
  assert.deepEqual(Object.keys(sources), ['air', 'pluie', 'semaine']);
  for (const source of Object.values(sources)) source.demarrer();
  await laisserFinir();
  assert.deepEqual([...appels].sort(), [...URL_CONCEPTION].sort());
  assert.equal(sources.semaine.valeur.jours.length, 7);
  assert.equal(sources.semaine.valeur.lieu, 'Paris', 'la semaine porte le nom du lieu, écrit sur l\'Accueil');
  assert.equal(sources.pluie.valeur.pas.length, 8);
  assert.equal(sources.air.valeur.actuel.european_aqi, 25);
});

test('sources Open-Meteo : pluie relue toutes les 15 min, air et semaine toutes les heures', async (t) => {
  const { appels, fetch } = fauxFetch({});
  t.mock.method(globalThis, 'fetch', fetch);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sources = creerSourcesOpenMeteo(journalCapture(), PARIS);
  t.after(() => Object.values(sources).forEach((source) => source.arreter()));
  for (const source of Object.values(sources)) source.demarrer();
  await laisserFinir();
  const compter = (motif) => appels.filter((url) => motif.test(url)).length;
  // Par quarts d'heure, en laissant finir chaque lecture (deux relectures simultanées se fondraient en une).
  const attendus = [[1, 2, 1], [1, 3, 1], [1, 4, 1], [2, 5, 2]];
  for (const [i, attendu] of attendus.entries()) {
    t.mock.timers.tick(15 * MINUTE);
    await laisserFinir();
    assert.deepEqual([compter(/air-quality/), compter(/minutely_15/), compter(/forecast_days=7/)], attendu, `à ${15 * (i + 1)} min`);
  }
});

test('sources Open-Meteo : HTTP 400 journalisé avec sa raison, dernière valeur gardée, nouvel essai à 30 s', async (t) => {
  const panne = {};
  const { appels, fetch } = fauxFetch(panne);
  t.mock.method(globalThis, 'fetch', fetch);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const journal = journalCapture();
  const { semaine } = creerSourcesOpenMeteo(journal, PARIS);
  t.after(() => semaine.arreter());
  semaine.demarrer();
  await laisserFinir();
  const avant = semaine.valeur;
  panne.erreur = { error: true, reason: 'Cannot initialize WeatherVariable from invalid String value x' };
  await semaine.actualiser();
  assert.equal(semaine.valeur, avant);
  assert.match(journal.lignes.join('\n'), /semaine \(7 jours\) : lecture échouée, dernière valeur gardée, nouvel essai dans 30 s \(HTTP 400 : Cannot initialize WeatherVariable from invalid String value x\)/);
  const appelsAvant = appels.length;
  t.mock.timers.tick(30_000 - 1);
  await laisserFinir();
  assert.equal(appels.length, appelsAvant);
  t.mock.timers.tick(1);
  await laisserFinir();
  assert.equal(appels.length, appelsAvant + 1, 'nouvel essai au bout de 30 s');
});
