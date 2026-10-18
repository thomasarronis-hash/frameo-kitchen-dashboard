// tests/accueil-donnees.test.js
//
// Rôle    : prouver web/src/ecrans/accueil-donnees.js, la vue de l'Accueil calculée sans DOM : température,
//           pluie dans l'heure (écrite seulement s'il pleut), météo actuelle, courses, niveau de l'air et pollen
//           dominant avec son niveau, plus de carte « À faire » (14/10), 7 jours de la semaine avec leurs repas et la
//           pastille Tempo d'aujourd'hui et de demain, case Tempo de la barre du bas, état de l'alarme, et l'assemblage
//           complet (bloc « Ce soir » compris, avec le vrai menu du 10/10).
// Entrées : fixtures réelles anonymisées (ha_states.json, réponses Open-Meteo du 11/10), passées par les
//           analyseurs du serveur : la page est testée sur la forme exacte de ce que le flux lui envoie.
// Sorties : node --test.
// Pièges  : ESP est l'espace insécable des textes (devant « : », « % » et les unités).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { projeter } from '../serveur/ha/entites.js';
import { analyserAir, analyserPluie, analyserSemaine } from '../serveur/sources/open-meteo.js';
import { niveauAir } from '../web/src/air.js';
import { temperature } from '../web/src/format.js';
import {
  alarmeAccueil, pluieDansLHeure, vueAccueil, vueAir, vueCourses, vueMeteo, vueSemaine,
} from '../web/src/ecrans/accueil-donnees.js';

const lire = (nom) => JSON.parse(readFileSync(new URL(`./fixtures/${nom}`, import.meta.url), 'utf8'));
const ENTITES = projeter(Object.fromEntries(lire('ha_states.json').map((etat) => [etat.entity_id, etat])));
const AIR = analyserAir(lire('open-meteo-air.json'), '2026-10-11');
const PLUIE = analyserPluie(lire('open-meteo-pluie.json'));
const SEMAINE = analyserSemaine(lire('open-meteo-semaine.json'), '2026-10-11T14:00');
const MENU = lire('menu-2026-10-10.json');
const ESP = '\u00a0';
const utc = (texte) => Date.parse(`${texte}Z`);
const A_14H20 = utc('2026-10-11T12:20');

const avecPluie = (valeurs) => ({ ...PLUIE, pas: PLUIE.pas.map((pas) => ({ ...pas, precipitation: pas.time in valeurs ? valeurs[pas.time] : pas.precipitation })) });

test('température arrondie, trait d\'union pour le signe moins (lisible en Fraunces), unité de l\'attribut', () => {
  assert.equal(temperature(14.1, '°C'), '14°');
  assert.equal(temperature(14.5, '°C'), '15°');
  assert.equal(temperature(-0.4, '°C'), '0°');
  assert.equal(temperature(-2.6, '°C'), '-3°');
  assert.equal(temperature(57, '°F'), `57${ESP}°F`);
  assert.equal(temperature(null, '°C'), null);
  assert.equal(temperature(undefined, '°C'), null);
});

test('pluie dans l\'heure : les pas dont l\'heure tombe dans les 60 minutes qui viennent ; rien d\'écrit quand c\'est sec', () => {
  assert.deepEqual(PLUIE.pas.map((pas) => pas.time).slice(0, 2), ['2026-10-11T14:15', '2026-10-11T14:30']);
  assert.equal(pluieDansLHeure(PLUIE, A_14H20), null, 'heure sèche : la ligne du ciel ne dit que le ciel');
  assert.equal(pluieDansLHeure(avecPluie({ '2026-10-11T14:45': 0.4, '2026-10-11T15:15': 0.2 }), A_14H20), `0,6${ESP}mm dans l'heure`);
  // 14:15 est déjà passé, 15:30 est au-delà de l'heure : ni l'un ni l'autre ne compte.
  assert.equal(pluieDansLHeure(avecPluie({ '2026-10-11T14:15': 3, '2026-10-11T15:30': 2 }), A_14H20), null);
});

test('pluie dans l\'heure : null ignorés, rien de connu = rien d\'affiché', () => {
  assert.equal(pluieDansLHeure(avecPluie({ '2026-10-11T14:30': null, '2026-10-11T14:45': 1.25 }), A_14H20), `1,3${ESP}mm dans l'heure`);
  const touteNulle = avecPluie(Object.fromEntries(PLUIE.pas.map((pas) => [pas.time, null])));
  assert.equal(pluieDansLHeure(touteNulle, A_14H20), null);
  assert.equal(pluieDansLHeure(PLUIE, utc('2026-10-11T16:00')), null, 'données trop anciennes');
  assert.equal(pluieDansLHeure(null, A_14H20), null);
});

test('météo actuelle depuis weather.forecast_maison (état et attributs projetés)', () => {
  assert.deepEqual(vueMeteo(ENTITES, PLUIE, A_14H20), {
    temperature: '14°', picto: 'i-partly', libelle: 'Éclaircies', pluie: null,
  });
  assert.equal(vueMeteo({}, PLUIE, A_14H20), null);
  const indisponible = { 'weather.forecast_maison': { state: 'unavailable', last_changed: '', attributes: {} } };
  assert.deepEqual(vueMeteo(indisponible, null, A_14H20), { temperature: null, picto: null, libelle: 'Météo indisponible', pluie: null });
});

test('courses : articles à faire seulement, 4 au plus, nombre dans le titre, états vides honnêtes', () => {
  assert.deepEqual(vueCourses(null), { titre: 'Courses', articles: [], message: 'Liste pas encore lue' });
  assert.deepEqual(vueCourses({ articles: [] }), { titre: 'Courses · 0', articles: [], message: 'Liste vide' });
  const articles = ['lait', 'potiron', 'pain de mie', 'emmental', 'crème fraîche', 'oeufs'].map((summary, i) => ({
    uid: `u${i}`, summary, status: i === 2 ? 'completed' : 'needs_action',
  }));
  assert.deepEqual(vueCourses({ articles }), { titre: 'Courses · 5', articles: ['lait', 'potiron', 'emmental', 'crème fraîche'], message: null });
});

test('niveaux de l\'indice européen de l\'air', () => {
  const cas = [[0, 'Bon', 1], [19.9, 'Bon', 1], [20, 'Moyen', 2], [39, 'Moyen', 2], [40, 'Dégradé', 3], [60, 'Mauvais', 4],
    [80, 'Très mauvais', 5], [99.9, 'Très mauvais', 5], [100, 'Extrêmement mauvais', 6], [180, 'Extrêmement mauvais', 6]];
  for (const [indice, libelle, rang] of cas) assert.deepEqual(niveauAir(indice), { libelle, classe: `aqi-${rang}`, rang }, String(indice));
});

test('air et pollens sur la réponse réelle du 11/10 : indice actuel ; une trace de pollen n\'est pas « dominante »', () => {
  assert.equal(AIR.jours[0].grass_pollen, 0.1, 'la réponse réelle n\'a qu\'une trace de graminées');
  assert.deepEqual(vueAir(AIR, A_14H20), {
    libelle: 'Moyen', classe: 'aqi-2', indice: 'indice 25', pollen: 'Pas de pollen',
  });
});

test('air et pollens : taxon dominant avec son niveau, comme l\'écran Météo (plus haut niveau, puis plus forte concentration), pas de pollen, pollens inconnus, indice absent, pas de données', () => {
  const avecPollen = (valeurs) => ({ ...AIR, jours: AIR.jours.map((jour) => ({ ...jour, ...valeurs })) });
  assert.equal(vueAir(avecPollen({ ragweed_pollen: 12.4, grass_pollen: 3 }), A_14H20).pollen, 'Ambroisie · moyen');
  assert.equal(vueAir(avecPollen({ ragweed_pollen: 6, grass_pollen: 9 }), A_14H20).pollen, 'Ambroisie · moyen', 'ambroisie moyenne dès 5, graminées faibles sous 10 : le niveau d\'abord');
  assert.equal(vueAir(avecPollen({ grass_pollen: 3, birch_pollen: 4 }), A_14H20).pollen, 'Bouleau · faible', 'même niveau : la plus forte concentration');
  assert.equal(vueAir(avecPollen({ birch_pollen: 1 }), A_14H20).pollen, 'Bouleau · faible');
  assert.equal(vueAir(avecPollen({ birch_pollen: 0.9 }), A_14H20).pollen, 'Pas de pollen');
  const sansPollen = { ...AIR, jours: AIR.jours.map((jour) => ({ ...jour, grass_pollen: 0, mugwort_pollen: 0 })) };
  assert.equal(vueAir(sansPollen, A_14H20).pollen, 'Pas de pollen');
  const inconnus = { ...AIR, jours: AIR.jours.map((jour) => ({ date: jour.date, european_aqi: jour.european_aqi })) };
  assert.equal(vueAir(inconnus, A_14H20).pollen, null);
  assert.equal(vueAir(AIR, utc('2026-10-20T10:00')).pollen, null, 'jour absent de la réponse');
  const sansIndice = { ...AIR, actuel: { ...AIR.actuel, european_aqi: null } };
  assert.deepEqual({ ...vueAir(sansIndice, A_14H20), pollen: undefined }, { libelle: 'Indice indisponible', classe: null, indice: '', pollen: undefined });
  assert.equal(vueAir(null, A_14H20), null);
});

const INCONNU = { couleur: null, provisoire: false, etiquette: 'Tempo : pas encore connu' };

test('plus de carte « À faire » (décision du 14/10) : encre et piles faibles ne sont plus dans la vue de l\'Accueil', () => {
  const entites = structuredClone(ENTITES);
  entites['sensor.hp_deskjet_2800_series_black_ink'].state = '12';
  entites['binary_sensor.salon_battery_low'].state = 'on';
  const vue = vueAccueil({ ha: 'ok', entites, courses: null, air: null, pluie: null, semaine: null, menu: null }, A_14H20);
  assert.equal('aFaire' in vue, false);
  assert.ok(!JSON.stringify(vue).includes('Pile faible') && !JSON.stringify(vue).includes('Encre'));
});

test('Tempo : pastille à côté d\'aujourd\'hui et de demain seulement, du 1er novembre au 31 mars (couleur du jour de la ligne, pointillés si pré-annoncée, « ? » sinon) ; en octobre, aucune', () => {
  const tempo = (mois) => ({
    jours: [{ date: `2026-${mois}-11`, couleur: 'bleu', statut: 'confirme' }, { date: `2026-${mois}-12`, couleur: 'blanc', statut: 'provisoire' }],
    restants: { rouge: 22, blanc: 42, bleu: 255 }, saison: '2026-2027', source: 'rte', lu_le: `2026-${mois}-11T07:31:00.000Z`,
  });
  assert.deepEqual(vueSemaine(SEMAINE, A_14H20, null, null, tempo('10')).map((jour) => jour.tempo), [null, null, null, null, null, null, null],
    'octobre : rien de Tempo sur l\'Accueil (décision de Thomas du 14/10)');
  const novembre = structuredClone(SEMAINE);
  novembre.jours.forEach((jour) => { jour.date = jour.date.replace('2026-10-', '2026-11-'); });
  const le11novembre = Date.parse('2026-11-11T14:20:00+01:00');
  assert.deepEqual(vueSemaine(novembre, le11novembre, null, null, tempo('11')).map((jour) => jour.tempo), [
    { couleur: 'bleu', provisoire: false, etiquette: 'Tempo : bleu' },
    { couleur: 'blanc', provisoire: true, etiquette: 'Tempo : blanc, pré-annonce' },
    null, null, null, null, null,
  ]);
  assert.deepEqual(vueSemaine(novembre, le11novembre, null, null, null).slice(0, 3).map((jour) => jour.tempo), [INCONNU, INCONNU, null], 'pas encore lu : « ? » gris');
});

test('Tempo : case de la barre du bas la veille d\'un rouge ou d\'un blanc, dès la pré-annonce ; « Heures creuses, les machines ! » à 22 h', () => {
  const donnees = (couleur, statut = 'provisoire') => ({
    ha: 'ok', entites: {}, courses: null, air: null, pluie: null, semaine: null, menu: null,
    tempo: { jours: [{ date: '2026-11-17', couleur, statut }], restants: null, saison: null, source: 'rte', lu_le: null },
  });
  const lundi = (heure) => Date.parse(`2026-11-16T${heure}:00+01:00`);
  assert.deepEqual(vueAccueil(donnees('rouge'), lundi('07:40')).tempo, { couleur: 'rouge', creuses: false, nom: 'Demain rouge', detail: null });
  assert.deepEqual(vueAccueil(donnees('rouge', 'confirme'), lundi('21:59')).tempo.nom, 'Demain rouge');
  assert.deepEqual(vueAccueil(donnees('rouge'), lundi('22:00')).tempo, { couleur: 'rouge', creuses: true, nom: 'Heures creuses,', detail: 'les machines !' });
  assert.deepEqual(vueAccueil(donnees('blanc'), lundi('10:00')).tempo, { couleur: 'blanc', creuses: false, nom: 'Demain blanc', detail: null });
  assert.equal(vueAccueil(donnees('bleu'), lundi('10:00')).tempo, null, 'veille d\'un bleu : le bouton Wi-Fi invités reste');
  assert.equal(vueAccueil({ ...donnees('rouge'), tempo: null }, lundi('10:00')).tempo, null);
});

test('semaine : 7 jours à partir d\'aujourd\'hui, pictogramme du ciel des heures de jour, maxi et mini', () => {
  const semaine = vueSemaine(SEMAINE, A_14H20, null);
  assert.equal(semaine.length, 7);
  assert.deepEqual(semaine[0], {
    jour: 'Dim', aujourdhui: true, picto: 'i-cloud', libelle: 'Couvert', maxi: '16°', mini: '8°', repas: [], agenda: [], tempo: null,
  });
  assert.deepEqual(semaine[1], {
    jour: 'Lun', aujourdhui: false, picto: 'i-sun', libelle: 'Ensoleillé', maxi: '18°', mini: '7°', repas: [], agenda: [], tempo: null,
  });
  assert.equal(semaine.filter((jour) => jour.picto === 'i-fog').length, 1, 'un seul jour de brouillard (le 14, de 8h à 11h), et non 6 sur 7');
  assert.deepEqual(semaine.map((jour) => jour.jour), ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']);
  assert.equal(semaine.filter((jour) => jour.aujourdhui).length, 1);
});

test('semaine avec le menu du 10/10 : le dimanche à 14h20, le soir seul (midi passé), le soir en semaine, rien le samedi 17 (hors menu)', () => {
  const semaine = vueSemaine(SEMAINE, A_14H20, MENU);
  assert.deepEqual(semaine.map((jour) => jour.repas), [
    ['Tartines gratinées aux aubergines et à la mozzarella'],
    ['Colin façon fish & chips'],
    ['Gratin de pâtes au jambon et petits pois'],
    ['Riz cantonais maison'],
    ['Boulettes à la sauce tomate et aux courgettes'],
    ['Quiche poireau et lardons'],
    [],
  ]);
});

test('semaine : un jour passé est écarté, null gardés vides, pas de données = null', () => {
  const lendemain = vueSemaine(SEMAINE, utc('2026-10-11T22:30'));
  assert.equal(lendemain.length, 6);
  assert.deepEqual([lendemain[0].jour, lendemain[0].aujourdhui], ['Lun', true]);
  const avecNull = structuredClone(SEMAINE);
  avecNull.jours[3].code_ciel = null;
  avecNull.jours[3].temperature_2m_max = null;
  const jour = vueSemaine(avecNull, A_14H20)[3];
  assert.deepEqual([jour.picto, jour.libelle, jour.maxi, jour.mini], [null, '', null, '11°']);
  assert.equal(vueSemaine(null, A_14H20), null);
});

test('bouton Alarme : état en français, alerte si déclenchée, résumé des ouvertures sous l\'état', () => {
  const avec = (state, ouvertes = []) => {
    const entites = structuredClone(ENTITES);
    entites['alarm_control_panel.alarme_maison'].state = state;
    ouvertes.forEach((nom) => { entites[`binary_sensor.${nom}_sensor_open`].state = 'on'; });
    return alarmeAccueil(entites, A_14H20);
  };
  assert.deepEqual(avec('armed_home'), { libelle: 'Maison', alerte: false, ouvertures: 'tout fermé', ouverturesAlerte: false });
  assert.deepEqual(avec('armed_night', ['porte_d_entree']), { libelle: 'Nuit', alerte: false, ouvertures: `1${ESP}ouverture`, ouverturesAlerte: true });
  assert.deepEqual(avec('disarmed', ['porte_d_entree', 'fenetre_cuisine']), { libelle: 'Désarmée', alerte: false, ouvertures: `2${ESP}ouvertures`, ouverturesAlerte: true });
  assert.deepEqual(avec('triggered'), { libelle: 'Déclenchée', alerte: true, ouvertures: 'tout fermé', ouverturesAlerte: false });
  assert.equal(avec('armed_away').libelle, 'Absent');
  assert.equal(alarmeAccueil({}, A_14H20), null, 'alarme pas encore lue : rien');
});

test('vue complète de l\'Accueil sur les fixtures réelles', () => {
  const vue = vueAccueil({ ha: 'ok', entites: ENTITES, courses: { articles: [] }, air: AIR, pluie: PLUIE, semaine: { ...SEMAINE, lieu: 'Paris' }, menu: MENU }, utc('2026-10-11T13:34'));
  assert.equal(vue.heure, '15:34');
  assert.equal(vue.date, 'Dimanche 11 octobre · Paris');
  assert.equal(vueAccueil({ entites: ENTITES }, utc('2026-10-11T13:34')).date, 'Dimanche 11 octobre', 'semaine pas encore lue : la date seule');
  assert.equal(vue.meteo.temperature, '14°');
  assert.equal(vue.courses.message, 'Liste vide');
  assert.equal(vue.air.libelle, 'Moyen');
  assert.equal(vue.tempo, null);
  assert.equal(vue.semaine.length, 7);
  assert.deepEqual(vue.alarme, { libelle: 'Maison', alerte: false, ouvertures: 'tout fermé', ouverturesAlerte: false });
  assert.deepEqual(vue.repas, {
    intitule: 'Ce soir', titre: 'Tartines gratinées aux aubergines et à la mozzarella', details: '20 min · Salade verte', repasId: '2026-10-11-soir', message: null,
  });
  assert.deepEqual(vue.semaine[0].repas, ['Tartines gratinées aux aubergines et à la mozzarella'], '15:34 : le midi est passé, le titre complet du soir est dans « La semaine »');
});

test('vue de l\'Accueil avant toute donnée : rien d\'inventé', () => {
  const vue = vueAccueil({ ha: null, entites: {}, courses: null, air: null, pluie: null, semaine: null, menu: null }, utc('2026-10-11T13:34'));
  assert.equal(vue.meteo, null);
  assert.equal(vue.air, null);
  assert.equal(vue.semaine, null);
  assert.equal(vue.alarme, null);
  assert.equal(vue.tempo, null);
  assert.deepEqual(vue.ficheTempo.jours.map((jour) => jour.texte), ['Pas encore connu', 'Pas encore connu']);
  assert.equal(vue.courses.message, 'Liste pas encore lue');
  assert.equal(vue.repas.message, 'Menu pas encore publié');
});
