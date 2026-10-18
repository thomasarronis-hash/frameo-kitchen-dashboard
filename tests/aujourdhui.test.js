// tests/aujourdhui.test.js
//
// Rôle    : prouver web/src/ecrans/aujourdhui-donnees.js sans DOM : la page « Aujourd'hui » qui remplace le brief du
//           matin (décision de Thomas du 14/10), contenu selon l'heure (périodes, rappels, gamelle et rendez-vous passés
//           retirés) et selon chaque source (met.no via HA, menu, agenda, entités, air et pollens), chaque chiffre
//           identique à sa source, rendez-vous à l'heure avant la ligne « Journée », alertes seulement à partir des
//           seuils qui demandent d'agir, les cas vides, la place (lignes gardées avec et sans la bande des alertes) et
//           l'encart de l'Accueil.
// Entrées : fixtures réelles : ha-meteo-horaire.json (met.no via HA, capturé le 13/10 à 18h10), ha_states.json, menu du
//           10/10, réponse Open-Meteo de l'air ; agenda écrit à la main passé par la projection du serveur. Les valeurs
//           attendues sont RECALCULÉES ici depuis les fixtures, indépendamment du code testé.
// Sorties : node --test.
// Pièges  : heures construites en UTC (Paris = UTC+2 en octobre avant le 25). ESP est l'espace insécable.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { projeterEvenement } from '../serveur/ha/agenda.js';
import { projeter } from '../serveur/ha/entites.js';
import { analyserAir } from '../serveur/sources/open-meteo.js';
import { encartAujourdhui, periodesDuJour, vueAujourdhui } from '../web/src/ecrans/aujourdhui-donnees.js';

const lire = (nom) => JSON.parse(readFileSync(new URL(`./fixtures/${nom}`, import.meta.url), 'utf8'));
const utc = (texte) => Date.parse(`${texte}Z`);
const ESP = ' ';
const ENTITES = projeter(Object.fromEntries(lire('ha_states.json').map((etat) => [etat.entity_id, etat])));
const METEO_ENTITE = ENTITES['weather.forecast_maison'];
const METEO = lire('ha-meteo-horaire.json');
const MENU = lire('menu-2026-10-10.json');
const AIR = analyserAir(lire('open-meteo-air.json'), '2026-10-14');
const A_7H15 = utc('2026-10-14T05:15');
const AGENDA = {
  personnes: ['Thomas', 'Agathe'],
  calendriers: [
    { id: 'calendar.domicile', nom: 'Domicile', personne: 'Thomas', etat: 'ok' },
    { id: 'calendar.domicile_2', nom: 'Domicile', personne: 'Agathe', etat: 'ok' },
  ],
  evenements: [
    projeterEvenement({ start: '2026-10-14T09:30:00+02:00', end: '2026-10-14T10:00:00+02:00', summary: 'Dentiste' }, 'Thomas'),
    projeterEvenement({ start: '2026-10-14', end: '2026-10-15', summary: 'Sortie scolaire' }, 'Agathe'),
    projeterEvenement({ start: '2026-10-15T09:00:00+02:00', end: '2026-10-15T10:00:00+02:00', summary: 'Demain' }, 'Thomas'),
  ],
};
const THOMAS = { couleur: 1, initiale: 'T', personne: 'Thomas' };
const AGATHE = { couleur: 2, initiale: 'A', personne: 'Agathe' };
const AIR_BON = { ...AIR, actuel: { ...AIR.actuel, european_aqi: 12 } };
const donnees = (autres = {}) => ({
  entites: ENTITES, meteo: METEO, menu: MENU, agenda: null, air: AIR_BON, ...autres,
});

// Heures de la source le 14/10 à Paris (UTC+2) d'une plage [debut, fin[, à partir de l'heure UTC donnée.
function heuresSource(debutParis, finParis, depuisUtc) {
  return METEO.horaire.filter((h) => {
    const heureParis = Number(h.datetime.slice(11, 13)) + 2;
    return h.datetime >= depuisUtc && h.datetime.startsWith('2026-10-14') && heureParis >= debutParis && heureParis < finParis;
  });
}
const plusBasse = (heures) => Math.round(Math.min(...heures.map((h) => h.temperature)));
const plusHaute = (heures) => Math.round(Math.max(...heures.map((h) => h.temperature)));

test('périodes du 14/10 à 7h15 : le plus frais le matin et le soir, le plus chaud l\'après-midi, condition la plus fréquente, sans pluie', () => {
  const matin = heuresSource(6, 12, '2026-10-14T05:00');
  const apresMidi = heuresSource(12, 18, '2026-10-14T05:00');
  const soir = heuresSource(18, 24, '2026-10-14T05:00');
  assert.deepEqual([plusBasse(matin), plusHaute(apresMidi), plusBasse(soir)], [14, 20, 15], 'fixture : 13,9° à 7h, 20,3° à 17h, 14,5° à 23h');
  assert.deepEqual(periodesDuJour(METEO, METEO_ENTITE, A_7H15), [
    { cle: 'matin', nom: 'Matin', temperature: '14°', picto: 'i-fog', libelle: 'Brouillard', pluie: null },
    { cle: 'apres_midi', nom: 'Après-midi', temperature: '20°', picto: 'i-cloud', libelle: 'Nuageux', pluie: null },
    { cle: 'soir', nom: 'Soir', temperature: '15°', picto: 'i-moon', libelle: 'Nuit claire', pluie: null },
  ]);
});

test('périodes : une période passée disparaît, l\'heure en cours compte encore ; pluie cumulée dans l\'unité de l\'entité', () => {
  const a14h10 = periodesDuJour(METEO, METEO_ENTITE, utc('2026-10-14T12:10'));
  assert.deepEqual(a14h10.map((p) => p.cle), ['apres_midi', 'soir'], 'à 14h10, plus de matin');
  assert.equal(a14h10[0].temperature, `${plusHaute(heuresSource(12, 18, '2026-10-14T12:00'))}°`);
  assert.deepEqual(periodesDuJour(METEO, METEO_ENTITE, utc('2026-10-14T21:30')).map((p) => [p.cle, p.temperature]), [['soir', '15°']], 'à 23h30, l\'heure de 23h compte encore : 14,5°');
  const mouille = structuredClone(METEO);
  mouille.horaire.forEach((h) => {
    if (h.datetime === '2026-10-14T13:00:00+00:00') h.precipitation = 0.6;
    if (h.datetime === '2026-10-14T19:00:00+00:00') h.precipitation = 1.8;
    if (h.datetime === '2026-10-14T20:00:00+00:00') h.precipitation = 0.15;
    if (h.datetime === '2026-10-14T23:00:00+00:00') h.precipitation = 5;
  });
  assert.deepEqual(periodesDuJour(mouille, METEO_ENTITE, A_7H15).map((p) => p.pluie), [null, `0,6${ESP}mm`, `2${ESP}mm`], '1,8 + 0,15 le soir ; 23h UTC = 1h le 15 : pas compté');
});

test('pictogramme d\'une période : à égalité, la condition la plus sévère ; conditions inconnues ignorées ; sans entité, unité absente', () => {
  const meteo = structuredClone(METEO);
  meteo.horaire.forEach((h) => {
    if (['05', '06', '07'].includes(h.datetime.slice(11, 13)) && h.datetime.startsWith('2026-10-14')) h.condition = 'rainy';
    if (['08', '09'].includes(h.datetime.slice(11, 13)) && h.datetime.startsWith('2026-10-14')) h.condition = 'unavailable';
  });
  const matin = periodesDuJour(meteo, METEO_ENTITE, utc('2026-10-14T04:00'))[0];
  assert.deepEqual([matin.picto, matin.libelle], ['i-rain', 'Pluie'], '3 heures de pluie contre 1 de brouillard ; les heures inconnues ne comptent pas');
  meteo.horaire.forEach((h) => {
    if (h.datetime === '2026-10-14T04:00:00+00:00' || h.datetime === '2026-10-14T07:00:00+00:00') h.condition = 'sunny';
  });
  const egalite = periodesDuJour(meteo, METEO_ENTITE, utc('2026-10-14T04:00'))[0];
  assert.equal(egalite.picto, 'i-rain', '2 heures de pluie contre 2 de soleil : la pluie');
  assert.equal(periodesDuJour(METEO, undefined, A_7H15)[0].temperature, `14${ESP}`, 'sans entité météo, aucune unité inventée');
});

test('vue du 14/10 à 7h15 : titre, météo, rappel du jour, gamelle (plat de la veille), plat du soir, son temps et sa recette', () => {
  const vue = vueAujourdhui(donnees(), A_7H15);
  const gamelle = MENU.repas.filter((r) => r.gamelles && r.gamelles.pour === '2026-10-14')[0];
  const soir = MENU.repas.filter((r) => r.date === '2026-10-14' && r.creneau === 'soir')[0];
  const rappel = MENU.rappels.filter((r) => r.date === '2026-10-14')[0];
  assert.equal(vue.titre, 'Mercredi 14 octobre');
  assert.deepEqual(vue.meteo.periodes.map((p) => p.temperature), ['14°', '20°', '15°']);
  assert.deepEqual(vue.rappels, { lignes: [{ moment: 'Matin', texte: rappel.texte }], plus: 0 });
  assert.deepEqual(vue.repas, {
    message: null, midi: { intitule: 'Gamelle', titre: gamelle.titre }, soir: { titre: soir.titre, temps: `${soir.temps_min} min`, repasId: soir.id },
  });
  assert.deepEqual(vue.rendezVous, {
    etat: 'attente', lignes: [], plus: 0, journee: null,
  });
  assert.deepEqual(vue.alertes, { lignes: [], plus: 0 }, 'inventaire réel, air bon : aucune alerte');
});

test('repas : le vrai midi le week-end, pas de bouton vers « Recette à venir », menu absent ou hors cycle, journée sans repas', () => {
  const dimanche = vueAujourdhui(donnees(), utc('2026-10-11T06:00')).repas;
  assert.deepEqual(dimanche.midi, { intitule: 'Midi', titre: 'Rôti de porc' });
  assert.equal(dimanche.soir.titre, 'Tartines gratinées aux aubergines et à la mozzarella');
  const sansRecette = structuredClone(MENU);
  sansRecette.repas.filter((r) => r.id === '2026-10-14-soir')[0].recette = null;
  assert.equal(vueAujourdhui(donnees({ menu: sansRecette }), A_7H15).repas.soir.repasId, null);
  assert.deepEqual(vueAujourdhui(donnees({ menu: null }), A_7H15).repas, { message: 'Menu pas encore publié', midi: null, soir: null });
  assert.deepEqual(vueAujourdhui(donnees(), utc('2026-10-17T06:00')).repas.message, 'Menu pas encore publié');
  const vide = { ...MENU, repas: MENU.repas.filter((r) => r.date !== '2026-10-14' && !(r.gamelles && r.gamelles.pour === '2026-10-14')) };
  assert.deepEqual(vueAujourdhui(donnees({ menu: vide }), A_7H15).repas, { message: 'Pas de repas prévu', midi: null, soir: null });
});

test('repas : la gamelle et le midi du week-end disparaissent à 14h, le soir reste', () => {
  assert.equal(vueAujourdhui(donnees(), utc('2026-10-14T11:59')).repas.midi.intitule, 'Gamelle', '13h59');
  const a14h = vueAujourdhui(donnees(), utc('2026-10-14T12:00')).repas;
  assert.deepEqual([a14h.message, a14h.midi, a14h.soir.titre], [null, null, 'Riz cantonais maison'], '14h : plus de gamelle');
  assert.equal(vueAujourdhui(donnees(), utc('2026-10-11T12:30')).repas.midi, null, 'dimanche 14h30 : le rôti est passé');
});

test('rappels : seulement ceux du jour, rangés par moment ; 3 sans alertes, 2 avec ; au-delà « + N »', () => {
  const menu = structuredClone(MENU);
  menu.rappels = [
    { date: '2026-10-14', moment: 'soir', texte: 'Sortir le poisson' },
    { date: '2026-10-14', moment: 'matin', texte: 'Cuire le riz' },
    { date: '2026-10-15', moment: 'matin', texte: 'Demain' },
    { date: '2026-10-14', moment: 'apres_midi', texte: 'Pain' },
    { date: '2026-10-14', moment: 'midi', texte: 'Gamelle de Léa' },
  ];
  const plein = vueAujourdhui(donnees({ menu }), A_7H15).rappels;
  assert.deepEqual(plein.lignes.map((r) => `${r.moment} ${r.texte}`), ['Matin Cuire le riz', 'Midi Gamelle de Léa'], '4 rappels pour 3 places : 2 et « + 2 »');
  assert.equal(plein.plus, 2);
  menu.rappels.splice(4, 1);
  assert.deepEqual(vueAujourdhui(donnees({ menu }), A_7H15).rappels.lignes.map((r) => r.moment), ['Matin', 'Après-midi', 'Soir']);
  const entites = structuredClone(ENTITES);
  entites['binary_sensor.garage_battery_low'].state = 'on';
  const reduit = vueAujourdhui(donnees({ menu, entites }), A_7H15).rappels;
  assert.deepEqual([reduit.lignes.length, reduit.plus], [1, 2], 'avec la bande des alertes : 2 places');
  assert.deepEqual(vueAujourdhui(donnees({ menu: null }), A_7H15).rappels, { lignes: [], plus: 0 });
});

test('rappels : un moment passé disparaît (matin à midi, midi à 14h, après-midi à 18h), le soir reste jusqu\'à minuit', () => {
  const menu = structuredClone(MENU);
  menu.rappels = ['matin', 'midi', 'apres_midi', 'soir'].map((moment) => ({ date: '2026-10-14', moment, texte: moment }));
  const moments = (heureUtc) => vueAujourdhui(donnees({ menu }), utc(`2026-10-14T${heureUtc}`)).rappels;
  assert.deepEqual(moments('09:59').plus, 2, '11h59 : les quatre, 2 montrés et « + 2 »');
  assert.deepEqual(moments('10:00').lignes.map((r) => r.texte), ['midi', 'apres_midi', 'soir'], '12h : plus le matin');
  assert.deepEqual(moments('12:00').lignes.map((r) => r.texte), ['apres_midi', 'soir'], '14h : plus le midi');
  assert.deepEqual(moments('16:00').lignes.map((r) => r.texte), ['soir'], '18h : plus l\'après-midi');
  assert.deepEqual(moments('21:59').lignes.map((r) => r.texte), ['soir'], '23h59');
});

test('rendez-vous : agenda pas lu, aucun calendrier, à l\'heure d\'abord puis une ligne « Journée », finis écartés, heure ou mot', () => {
  assert.equal(vueAujourdhui(donnees({ agenda: null }), A_7H15).rendezVous.etat, 'attente');
  assert.deepEqual(vueAujourdhui(donnees({ agenda: { personnes: [], calendriers: [], evenements: [] } }), A_7H15).rendezVous, {
    etat: 'vide', lignes: [], plus: 0, journee: null,
  });
  assert.deepEqual(vueAujourdhui(donnees({ agenda: AGENDA }), A_7H15).rendezVous, {
    etat: 'ok',
    lignes: [{ horaire: '09:30', aLHeure: true, titre: 'Dentiste', ...THOMAS }],
    plus: 0,
    journee: { evenements: [{ texte: 'Sortie scolaire', ...AGATHE }], plus: 0 },
  });
  const apres = vueAujourdhui(donnees({ agenda: AGENDA }), utc('2026-10-14T08:05')).rendezVous;
  assert.deepEqual([apres.lignes, apres.journee.evenements.map((e) => e.texte)], [[], ['Sortie scolaire']], 'dentiste fini à 10h');
  const veille = { ...AGENDA, evenements: [projeterEvenement({ start: '2026-10-13T23:00:00+02:00', end: '2026-10-14T00:30:00+02:00', summary: 'Retour' }, 'Thomas')] };
  const retour = vueAujourdhui(donnees({ agenda: veille }), utc('2026-10-13T22:10')).rendezVous;
  assert.deepEqual([retour.lignes[0], retour.journee], [{ horaire: 'fin 00:30', aLHeure: false, titre: 'Retour', ...THOMAS }, null], 'commencé la veille : un rendez-vous, pas une journée');
  assert.equal(vueAujourdhui(donnees({ agenda: { ...AGENDA, evenements: [] } }), A_7H15).rendezVous.etat, 'ok', 'agenda relié, rien aujourd\'hui : « Rien de prévu »');
});

test('rendez-vous : trois journées entières tiennent sur la ligne « Journée » (2 et « +1 ») sans cacher un rendez-vous à l\'heure', () => {
  const agenda = structuredClone(AGENDA);
  agenda.evenements = [
    projeterEvenement({ start: '2026-10-10', end: '2026-10-27', summary: 'Vacances de la Toussaint' }, 'Agathe'),
    projeterEvenement({ start: '2026-10-14', end: '2026-10-15', summary: 'Anniversaire de Mamie' }, 'Agathe'),
    projeterEvenement({ start: '2026-10-14', end: '2026-10-15', summary: 'Journée pédagogique' }, 'Thomas'),
    projeterEvenement({ start: '2026-10-14T09:00:00+02:00', end: '2026-10-14T09:30:00+02:00', summary: 'Kiné' }, 'Agathe'),
    projeterEvenement({ start: '2026-10-14T09:30:00+02:00', end: '2026-10-14T10:00:00+02:00', summary: 'Appel banque' }, 'Thomas'),
    projeterEvenement({ start: '2026-10-14T17:00:00+02:00', end: '2026-10-14T18:00:00+02:00', summary: 'Dentiste Tom' }, 'Thomas'),
  ];
  const entites = structuredClone(ENTITES);
  entites['binary_sensor.garage_battery_low'].state = 'on';
  const rdv = vueAujourdhui(donnees({ agenda, entites }), utc('2026-10-14T06:00')).rendezVous;
  assert.deepEqual(rdv.lignes.map((r) => `${r.horaire} ${r.titre}`), ['09:00 Kiné', '09:30 Appel banque', '17:00 Dentiste Tom'], 'avec la bande des alertes (4 places), les trois rendez-vous à l\'heure restent');
  assert.deepEqual([rdv.plus, rdv.journee.evenements.map((e) => e.texte), rdv.journee.plus], [0, ['Anniversaire de Mamie', 'Journée pédagogique'], 1]);
});

test('rendez-vous : 7 lignes sans alertes, 4 avec, la ligne « Journée » comprise ; au-delà, la dernière ligne à l\'heure devient « + N autres »', () => {
  const charge = structuredClone(AGENDA);
  ['10', '11', '12', '13', '14', '15', '16'].forEach((h) => charge.evenements.push(projeterEvenement({ start: `2026-10-14T${h}:00:00+02:00`, end: `2026-10-14T${h}:30:00+02:00`, summary: `RDV ${h}h` }, 'Agathe')));
  const plein = vueAujourdhui(donnees({ agenda: charge }), A_7H15).rendezVous;
  assert.deepEqual([plein.lignes.length, plein.plus, plein.journee.evenements.length], [5, 3, 1], '8 rendez-vous à l\'heure et une journée pour 7 lignes');
  charge.evenements.splice(-2, 2);
  const sept = vueAujourdhui(donnees({ agenda: charge }), A_7H15).rendezVous;
  assert.deepEqual([sept.lignes.length, sept.plus], [6, 0], '6 à l\'heure et la journée tiennent');
  const entites = structuredClone(ENTITES);
  entites['sensor.hp_deskjet_2800_series_black_ink'].state = '12';
  const reduit = vueAujourdhui(donnees({ agenda: charge, entites }), A_7H15).rendezVous;
  assert.deepEqual([reduit.lignes.length, reduit.plus], [2, 4]);
});

test('alertes : ouverture ouverte, air à partir de « dégradé », pollen « élevé », encre sous 15 %, piles faibles, dans cet ordre ; 4 au plus', () => {
  const entites = structuredClone(ENTITES);
  entites['binary_sensor.porte_garage_sensor_open'] = { state: 'on', last_changed: '2026-10-14T05:12:00+00:00', attributes: {} };
  entites['sensor.hp_deskjet_2800_series_black_ink'].state = '12';
  entites['binary_sensor.salon_battery_low'].state = 'on';
  const air = structuredClone(AIR);
  air.actuel.european_aqi = 40;
  const jour = air.jours.filter((j) => j.date === '2026-10-14')[0];
  jour.grass_pollen = 50;
  jour.ragweed_pollen = 49;
  const vue = vueAujourdhui(donnees({ entites, air }), A_7H15);
  assert.deepEqual(vue.alertes.lignes.slice(0, 3), [
    { icone: 'i-door', titre: 'Porte du garage', valeur: `ouverte depuis 7${ESP}h${ESP}12` },
    { icone: 'i-leaf', titre: 'Air', valeur: 'dégradé' },
    { icone: 'i-leaf', titre: 'Graminées', valeur: 'pollen élevé' },
  ], 'ambroisie à 49 : moyenne, pas d\'alerte');
  assert.equal(vue.alertes.plus, 2, 'encre et pile : 5 alertes pour 4 cases, 3 montrées et « + 2 »');
  delete entites['binary_sensor.porte_garage_sensor_open'];
  air.actuel.european_aqi = 39.9;
  jour.grass_pollen = 49.9;
  assert.deepEqual(vueAujourdhui(donnees({ entites, air }), A_7H15).alertes, {
    lignes: [
      { icone: 'i-print', titre: 'Encre noire', valeur: `12${ESP}%` },
      { icone: 'i-battery', titre: 'Détecteur du salon', valeur: 'pile faible' },
    ],
    plus: 0,
  }, 'air moyen (39,9) et graminées moyennes : le niveau de presque tous les jours, aucune alerte');
  assert.deepEqual(vueAujourdhui(donnees({ air: null }), A_7H15).alertes, { lignes: [], plus: 0 });
});

test('alertes nouvelles du 14/10 : veille d\'un Tempo rouge en tête (dès la pré-annonce), draps après les ouvertures ; comptées dans l\'encart, jamais sur l\'Accueil', () => {
  const entites = structuredClone(ENTITES);
  entites['binary_sensor.porte_garage_sensor_open'] = { state: 'on', last_changed: '2026-10-14T05:12:00+00:00', attributes: {} };
  const tempo = { jours: [{ date: '2026-10-15', couleur: 'rouge', statut: 'provisoire' }], restants: null, saison: null, source: 'rte', lu_le: null };
  const draps = { timo: '2026-10-01', pablo: '2026-09-29', parents: '2026-10-10' };
  const vue = vueAujourdhui(donnees({ entites, tempo, draps }), A_7H15);
  assert.deepEqual(vue.alertes.lignes, [
    { icone: 'i-eclair', titre: 'Demain rouge', valeur: 'machines après 22 h' },
    { icone: 'i-door', titre: 'Porte du garage', valeur: `ouverte depuis 7${ESP}h${ESP}12` },
    { icone: 'i-lit', titre: 'Lit de Pablo', valeur: 'draps à changer' },
    { icone: 'i-lit', titre: 'Lit de Timo', valeur: `draps dans 2${ESP}jours` },
  ], 'Pablo au 15e jour (le jour J) avant Timo au 13e (rappel), notre chambre au 4e (rien)');
  assert.equal(vue.alertes.plus, 0);
  assert.equal(encartAujourdhui(vue).badges.filter((b) => b.alerte)[0].nombre, 4);
  const soir = vueAujourdhui(donnees({ tempo }), utc('2026-10-14T20:30'));
  assert.deepEqual(soir.alertes.lignes[0], { icone: 'i-eclair', titre: 'Demain rouge', valeur: 'lancer les machines' }, '22 h 30 à Paris');
  const blanc = { ...tempo, jours: [{ date: '2026-10-15', couleur: 'blanc', statut: 'confirme' }] };
  assert.equal(vueAujourdhui(donnees({ tempo: blanc }), A_7H15).alertes.lignes[0].titre, 'Demain blanc');
  const bleu = { ...tempo, jours: [{ date: '2026-10-15', couleur: 'bleu', statut: 'confirme' }] };
  assert.deepEqual(vueAujourdhui(donnees({ tempo: bleu, draps: { timo: '2026-10-10', pablo: null, parents: null } }), A_7H15).alertes, { lignes: [], plus: 0 }, 'veille d\'un bleu, draps récents ou jamais notés : rien');
});

test('alertes : sur la réponse réelle (air moyen, pollens absents), aucune ; deux pollens élevés, le plus concentré d\'abord', () => {
  assert.equal(AIR.actuel.european_aqi >= 20 && AIR.actuel.european_aqi < 40, true, 'réponse réelle : air moyen');
  assert.deepEqual(vueAujourdhui(donnees({ air: AIR }), A_7H15).alertes, { lignes: [], plus: 0 });
  const air = structuredClone(AIR);
  Object.assign(air.jours.filter((j) => j.date === '2026-10-14')[0], { grass_pollen: 64, birch_pollen: 150 });
  assert.deepEqual(vueAujourdhui(donnees({ air }), A_7H15).alertes.lignes.map((a) => a.titre), ['Bouleau', 'Graminées']);
});

test('avant toute donnée : rien d\'inventé, chaque carte a son état vide', () => {
  const vue = vueAujourdhui({ entites: {}, meteo: null, menu: null, agenda: null, air: null }, A_7H15);
  assert.deepEqual(vue, {
    titre: 'Mercredi 14 octobre',
    meteo: null,
    rappels: { lignes: [], plus: 0 },
    repas: { message: 'Menu pas encore publié', midi: null, soir: null },
    rendezVous: {
      etat: 'attente', lignes: [], plus: 0, journee: null,
    },
    alertes: { lignes: [], plus: 0 },
    tempo: null,
  });
});

test('encart de l\'Accueil : un badge par sujet non vide avec le nombre TOTAL, alerte marquée, étiquette lue ; sinon « rien de prévu »', () => {
  assert.deepEqual(encartAujourdhui(vueAujourdhui({ entites: {}, meteo: null, menu: null, agenda: null, air: null }, A_7H15)), {
    badges: [], etiquette: `Aujourd'hui${ESP}: rien de prévu`,
  });
  const entites = structuredClone(ENTITES);
  ['garage', 'salon', 'porte_d_entree', 'fenetre_cuisine', 'baie_vitree_droit'].forEach((nom) => { entites[`binary_sensor.${nom}_battery_low`].state = 'on'; });
  const encart = encartAujourdhui(vueAujourdhui(donnees({ entites, agenda: AGENDA }), A_7H15));
  assert.deepEqual(encart.badges, [
    { icone: 'i-cal', nombre: 2, alerte: false },
    { icone: 'i-note', nombre: 1, alerte: false },
    { icone: 'i-alert', nombre: 5, alerte: true },
  ], 'le dentiste et la sortie scolaire ; 5 piles : la page en montre 3 et « + 2 », l\'encart compte les 5');
  assert.equal(encart.etiquette, `Aujourd'hui${ESP}: 2${ESP}rendez-vous, 1${ESP}rappel, 5${ESP}alertes`);
  const seul = encartAujourdhui(vueAujourdhui(donnees({ menu: null, agenda: { ...AGENDA, evenements: AGENDA.evenements.slice(0, 1) } }), A_7H15));
  assert.deepEqual(seul, { badges: [{ icone: 'i-cal', nombre: 1, alerte: false }], etiquette: `Aujourd'hui${ESP}: 1${ESP}rendez-vous` });
});

test('encart de l\'Accueil le soir : le rappel du matin, la gamelle et le dentiste sont passés, seule la sortie scolaire compte', () => {
  const soir = encartAujourdhui(vueAujourdhui(donnees({ agenda: AGENDA }), utc('2026-10-14T17:30')));
  assert.deepEqual(soir, { badges: [{ icone: 'i-cal', nombre: 1, alerte: false }], etiquette: `Aujourd'hui${ESP}: 1${ESP}rendez-vous` });
});
