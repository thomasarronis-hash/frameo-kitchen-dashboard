// tests/agenda.test.js
//
// Rôle    : prouver serveur/ha/agenda.js : liste vide publiée sans appel à HA ; lecture par calendar.get_events
//           sur quatre semaines (de la précédente à la deuxième suivante, bornes à minuit de Paris, changement d'heure
//           compris) de chaque calendrier de la liste blanche (et d'aucun autre), UN appel par calendrier, en parallèle
//           (un calendrier lent ne retient pas les autres) ; projection sans description ni participants, lien du lieu remplacé par
//           « Visio », rattachée à la personne du calendrier ; UN SEUL agenda : rendez-vous de tous les
//           calendriers fusionnés, triés à l'heure de Paris, sans doublon pour une même personne ; personnes dans
//           l'ordre de AGENDA_CALENDRIERS ; calendrier absent de HA ; calendrier en erreur qui garde ses
//           rendez-vous précédents ; relectures (premiers états reçus, changement d'un calendrier, reconnexion,
//           15 min).
// Entrées : tests/fixtures/ha-calendrier-evenements.json, réponse de calendar.get_events pour un calendrier, de la
//           forme relevée le 13/10 sur les vrais calendriers iCloud de Thomas (start, end, summary ; description et
//           location quand l'événement en a), titres et lieux INVENTÉS. Une fausse connexion (lire simulé) et une
//           fausse SourceEntites.
// Sorties : node --test.
// Pièges  : les minuteries sont simulées (t.mock.timers) ; laisserFinir() vide les microtâches pour que les
//           lectures simulées (sans minuterie) se terminent. Le 14/10, Paris est à UTC+2.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  fenetreDeLecture, fusionner, lieuSansLien, projeterEvenement, SourceAgenda,
} from '../serveur/ha/agenda.js';

const MINUTE = 60_000;
const REPONSE = JSON.parse(readFileSync(new URL('./fixtures/ha-calendrier-evenements.json', import.meta.url), 'utf8'));
const DOMICILE = { id: 'calendar.domicile', personne: 'Thomas' };
const TRAVAIL = { id: 'calendar.travail', personne: 'Thomas' };
const DOMICILE_2 = { id: 'calendar.domicile_2', personne: 'Agathe' };
const MERCREDI_14 = () => Date.parse('2026-10-14T08:00:00Z');
const BORNES_14 = { start_date_time: '2026-10-05T00:00:00+02:00', end_date_time: '2026-11-02T00:00:00+01:00' };

function journalCapture() {
  const lignes = [];
  return { lignes, info: (m) => lignes.push(m), warn: (m) => lignes.push(m), error: (m) => lignes.push(m) };
}

async function laisserFinir() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

// reponses : entity_id -> réponse (ou Error). Les appels sont relevés.
function fausseConnexion(reponses) {
  const connexion = new EventEmitter();
  connexion.etat = 'ok';
  connexion.appels = [];
  connexion.lire = async (service, entite, donnees) => {
    connexion.appels.push({ service, entite, donnees });
    const reponse = reponses[entite];
    if (reponse instanceof Error) throw reponse;
    return structuredClone(reponse);
  };
  return connexion;
}

function fauxEntites(valeur = {}, recue = true) {
  const entites = new EventEmitter();
  entites.valeur = valeur;
  entites.recue = recue;
  return entites;
}

const calendrier = (nom) => ({ state: 'off', last_changed: '2026-10-13T16:00:00.000Z', attributes: { friendly_name: nom } });
const ETATS = {
  'calendar.domicile': calendrier('Domicile'), 'calendar.travail': calendrier('Travail'), 'calendar.domicile_2': calendrier('Domicile'),
};
const evt = (start, end, summary, location) => ({ start, end, summary, ...(location ? { location } : {}) });

test('aucun calendrier configuré : agenda vide publié tout de suite, sans aucun appel à HA ni relecture', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const connexion = fausseConnexion({});
  const entites = fauxEntites(ETATS);
  const agenda = new SourceAgenda(connexion, entites, [], journalCapture());
  const maj = [];
  agenda.on('maj', (valeur) => maj.push(valeur));
  agenda.demarrer();
  assert.deepEqual(agenda.valeur, {
    personnes: [], fenetre: null, calendriers: [], evenements: [],
  });
  assert.equal(maj.length, 1);
  connexion.emit('prete');
  entites.emit('maj', { 'calendar.domicile': calendrier('Domicile') });
  t.mock.timers.tick(60 * MINUTE);
  await laisserFinir();
  assert.deepEqual(connexion.appels, []);
  agenda.arreter();
});

test('projection : personne, titre (bords retirés), début, fin, journée entière, lieu (null si vide) ; ni description ni participants', () => {
  const evenements = REPONSE.events.map((evenement) => projeterEvenement(evenement, 'Thomas'));
  assert.deepEqual(evenements[0], {
    personne: 'Thomas', titre: 'Sortie scolaire au musée', debut: '2026-10-14', fin: '2026-10-15', journee: true, lieu: null,
  });
  assert.deepEqual(evenements[1], {
    personne: 'Thomas',
    titre: 'Dentiste',
    debut: '2026-10-14T09:30:00+02:00',
    fin: '2026-10-14T10:00:00+02:00',
    journee: false,
    lieu: 'Cabinet du centre, Paris',
  });
  assert.equal(evenements[2].lieu, null, 'lieu fait d\'espaces : null');
  assert.equal(projeterEvenement(evt('2026-10-14', '2026-10-15', '  Piscine '), 'Agathe').titre, 'Piscine');
  const json = JSON.stringify(evenements);
  for (const fuite of ['description', 'pique-nique', 'visio', '06 00', 'attendees', 'calendar.']) assert.ok(!json.includes(fuite), fuite);
});

test('lieu : tout lien (visio Zoom avec son mot de passe, Meet, Teams, sans schéma) devient « Visio », le reste est gardé', () => {
  const zoom = projeterEvenement(evt('2026-10-14T18:00:00+02:00', '2026-10-14T19:00:00+02:00', 'Point projet', 'https://us02web.zoom.us/j/81234567890?pwd=SeCrEt123'), 'Thomas');
  assert.equal(zoom.lieu, 'Visio');
  assert.ok(!JSON.stringify(zoom).includes('pwd') && !JSON.stringify(zoom).includes('SeCrEt123'), 'ni l\'URL ni le mot de passe ne sortent');
  assert.equal(lieuSansLien('Salle B, https://meet.google.com/abc-defg-hij'), 'Salle B, Visio');
  assert.equal(lieuSansLien('zoom.us/j/987654321?pwd=abc'), 'Visio');
  assert.equal(lieuSansLien('Salle 3 - https://teams.microsoft.com/l/meetup-join/19%3a?x=1 ; https://zoom.us/j/2'), 'Salle 3 - Visio');
  assert.equal(lieuSansLien('Cabinet (www.exemple.fr/rdv)'), 'Cabinet (Visio)');
  for (const lieu of ['12 rue de la Paix, 75011 Paris', 'Gymnase J. Prévert', 'Cabinet du centre, Paris']) assert.equal(lieuSansLien(lieu), lieu);
});

test('fusion : un seul agenda trié à l\'heure de Paris, journée entière avant l\'heure du même jour, puis par titre', () => {
  const thomas = [
    projeterEvenement(evt('2026-10-15T08:00:00Z', '2026-10-15T09:00:00Z', 'Kiné'), 'Thomas'),
    projeterEvenement(evt('2026-10-14T18:00:00+02:00', '2026-10-14T19:00:00+02:00', 'Foot'), 'Thomas'),
  ];
  const agathe = [
    projeterEvenement(evt('2026-10-15', '2026-10-16', 'Grève des transports'), 'Agathe'),
    projeterEvenement(evt('2026-10-15T09:30:00+02:00', '2026-10-15T10:00:00+02:00', 'Banque'), 'Agathe'),
    projeterEvenement(evt('2026-10-15T10:00:00+02:00', '2026-10-15T11:00:00+02:00', 'Atelier'), 'Agathe'),
  ];
  assert.deepEqual(fusionner([thomas, agathe]).map((e) => `${e.personne} ${e.titre}`), [
    'Thomas Foot', 'Agathe Grève des transports', 'Agathe Banque', 'Agathe Atelier', 'Thomas Kiné',
  ], '08:00 UTC = 10:00 à Paris : Kiné après Banque (09:30), à égalité avec Atelier (10:00), départagé par le titre');
});

test('doublons : même personne, même titre, même début dans deux calendriers -> un seul ; deux personnes gardent chacune le leur', () => {
  const reunion = evt('2026-10-21T06:00:00+02:00', '2026-10-21T07:00:00+02:00', 'Réunion');
  const fusion = fusionner([
    [projeterEvenement(reunion, 'Thomas')],
    [projeterEvenement({ ...reunion, end: '2026-10-21T07:30:00+02:00', location: 'Bureau' }, 'Thomas')],
    [projeterEvenement(reunion, 'Agathe')],
    [projeterEvenement({ ...reunion, summary: 'Réunion parents' }, 'Thomas')],
  ]);
  assert.deepEqual(fusion.map((e) => [e.personne, e.titre, e.lieu]), [
    ['Thomas', 'Réunion', null], ['Agathe', 'Réunion', null], ['Thomas', 'Réunion parents', null],
  ], 'le premier calendrier de la liste l\'emporte (sans lieu ici) ; même heure et même titre : ordre de la liste');
});

test('fenêtre : du lundi de la semaine précédente au lundi qui suit la deuxième semaine suivante, minuit de Paris et son décalage', () => {
  assert.deepEqual(fenetreDeLecture(MERCREDI_14()), { debut: '2026-10-05', fin: '2026-11-02', ...BORNES_14 }, 'commence en heure d\'été, finit en heure d\'hiver (25/10)');
  assert.equal(fenetreDeLecture(Date.parse('2026-10-11T21:59:00Z')).debut, '2026-09-28', 'dimanche 23:59 à Paris : encore la semaine du 5');
  assert.equal(fenetreDeLecture(Date.parse('2026-10-11T22:00:00Z')).debut, '2026-10-05', 'lundi 00:00 à Paris (22:00 UTC) : la fenêtre glisse');
  assert.deepEqual(fenetreDeLecture(Date.parse('2026-12-31T23:30:00Z')), {
    debut: '2026-12-21', fin: '2027-01-18', start_date_time: '2026-12-21T00:00:00+01:00', end_date_time: '2027-01-18T00:00:00+01:00',
  }, '1er janvier 00:30 à Paris, un vendredi : semaine du 28 décembre');
  assert.equal(fenetreDeLecture(Date.parse('2026-03-30T10:00:00Z')).end_date_time, '2026-04-20T00:00:00+02:00', 'printemps : la fin passe en heure d\'été');
});

test('lecture : calendar.get_events sur la fenêtre, UN appel par calendrier de AGENDA_CALENDRIERS, dans l\'ordre ; personnes, fenêtre et calendriers', async () => {
  const connexion = fausseConnexion({
    'calendar.domicile': REPONSE,
    'calendar.travail': { events: [evt('2026-10-14T09:30:00+02:00', '2026-10-14T10:00:00+02:00', 'Dentiste')] },
    'calendar.domicile_2': { events: [evt('2026-10-14T12:30:00+02:00', '2026-10-14T13:30:00+02:00', 'Déjeuner')] },
  });
  const agenda = new SourceAgenda(connexion, fauxEntites(ETATS), [TRAVAIL, DOMICILE_2, DOMICILE], journalCapture(), MERCREDI_14);
  await agenda.actualiser();
  assert.deepEqual(connexion.appels.map((a) => [a.service, a.entite, a.donnees]), [
    ['calendar.get_events', 'calendar.travail', BORNES_14],
    ['calendar.get_events', 'calendar.domicile_2', BORNES_14],
    ['calendar.get_events', 'calendar.domicile', BORNES_14],
  ]);
  assert.deepEqual(agenda.valeur.personnes, ['Thomas', 'Agathe'], 'ordre de première apparition');
  assert.deepEqual(agenda.valeur.fenetre, { debut: '2026-10-05', fin: '2026-11-02' });
  assert.deepEqual(agenda.valeur.calendriers, [
    { id: 'calendar.travail', nom: 'Travail', personne: 'Thomas', etat: 'ok' },
    { id: 'calendar.domicile_2', nom: 'Domicile', personne: 'Agathe', etat: 'ok' },
    { id: 'calendar.domicile', nom: 'Domicile', personne: 'Thomas', etat: 'ok' },
  ]);
  // Le Dentiste de 09:30 est dans travail ET domicile pour Thomas : un seul.
  assert.equal(agenda.valeur.evenements.length, REPONSE.events.length + 1);
  assert.deepEqual(agenda.valeur.evenements.slice(0, 4).map((e) => `${e.personne} ${e.titre}`), [
    'Thomas Sortie scolaire au musée', 'Thomas Dentiste', 'Agathe Déjeuner', 'Thomas Entraînement de foot',
  ]);
});

test('calendrier absent de HA : signalé « absent », jamais lu ; les autres le sont', async () => {
  const connexion = fausseConnexion({ 'calendar.domicile': REPONSE });
  const agenda = new SourceAgenda(connexion, fauxEntites({ 'calendar.domicile': ETATS['calendar.domicile'] }), [DOMICILE, DOMICILE_2], journalCapture());
  await agenda.actualiser();
  assert.deepEqual(connexion.appels.map((appel) => appel.entite), ['calendar.domicile']);
  assert.deepEqual(agenda.valeur.calendriers[1], { id: 'calendar.domicile_2', nom: 'calendar.domicile_2', personne: 'Agathe', etat: 'absent' });
  assert.deepEqual(agenda.valeur.personnes, ['Thomas', 'Agathe'], 'une personne reste dans la légende même si son calendrier manque');
});

test('calendrier en erreur ou de réponse inattendue : « erreur », rendez-vous précédents gardés, les autres à jour', async () => {
  const reponses = { 'calendar.domicile': REPONSE, 'calendar.travail': { events: [evt('2026-10-15', '2026-10-16', 'Séminaire')] } };
  const connexion = fausseConnexion(reponses);
  const journal = journalCapture();
  const agenda = new SourceAgenda(connexion, fauxEntites(ETATS), [DOMICILE, TRAVAIL], journal);
  await agenda.actualiser();
  reponses['calendar.domicile'] = new Error('calendar.get_events : home_assistant_error : intégration indisponible');
  reponses['calendar.travail'] = { events: [] };
  await agenda.actualiser();
  assert.deepEqual(agenda.valeur.calendriers.map((c) => c.etat), ['erreur', 'ok']);
  assert.equal(agenda.valeur.evenements.length, REPONSE.events.length, 'domicile garde ses rendez-vous, travail n\'en a plus');
  assert.match(journal.lignes.join('\n'), /calendar\.domicile illisible, événements précédents gardés/);

  reponses['calendar.domicile'] = { events: [{ start: '14/10/2026', end: '15/10/2026', summary: 'mal formé' }] };
  await agenda.actualiser();
  assert.equal(agenda.valeur.calendriers[0].etat, 'erreur');
  assert.equal(agenda.valeur.evenements.length, REPONSE.events.length);

  const neuve = new SourceAgenda(fausseConnexion({ 'calendar.domicile': new Error('refus') }), fauxEntites(ETATS), [DOMICILE], journalCapture());
  await neuve.actualiser();
  assert.deepEqual(neuve.valeur.evenements, [], 'échec dès la première lecture : rien, sans planter');
});

test('lecture en parallèle : un calendrier lent ne retient pas les autres ; en échec (délai dépassé), il est « erreur » et le reste publié', async () => {
  const appels = [];
  let lacherTravail;
  const connexion = new EventEmitter();
  connexion.etat = 'ok';
  connexion.lire = (_service, entite) => {
    appels.push(entite);
    if (entite === 'calendar.travail') return new Promise((_r, rejeter) => { lacherTravail = () => rejeter(new Error('calendar.get_events : délai dépassé (25 s)')); });
    return Promise.resolve(structuredClone(REPONSE));
  };
  const agenda = new SourceAgenda(connexion, fauxEntites(ETATS), [TRAVAIL, DOMICILE], journalCapture());
  const lecture = agenda.actualiser();
  await laisserFinir();
  assert.deepEqual(appels, ['calendar.travail', 'calendar.domicile'], 'domicile est demandé sans attendre la réponse de travail');
  lacherTravail();
  await lecture;
  assert.deepEqual(agenda.valeur.calendriers.map((c) => c.etat), ['erreur', 'ok']);
  assert.equal(agenda.valeur.evenements.length, REPONSE.events.length, 'les rendez-vous de domicile sont publiés');
});

test('relectures : premiers états reçus, changement d\'un calendrier configuré (pas des autres entités), reconnexion, 15 min', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const connexion = fausseConnexion({ 'calendar.domicile': REPONSE });
  const entites = fauxEntites({}, false);
  const agenda = new SourceAgenda(connexion, entites, [DOMICILE], journalCapture());
  agenda.demarrer();

  connexion.emit('prete');
  t.mock.timers.tick(15 * MINUTE);
  await laisserFinir();
  assert.equal(connexion.appels.length, 0, 'avant les premiers états de HA : rien n\'est lu');

  entites.valeur = { 'calendar.domicile': ETATS['calendar.domicile'], 'sun.sun': { state: 'above_horizon', last_changed: '', attributes: {} } };
  entites.recue = true;
  entites.emit('maj', { 'sun.sun': entites.valeur['sun.sun'] });
  await laisserFinir();
  assert.equal(connexion.appels.length, 1, 'premiers états : première lecture, quelle que soit l\'entité');

  entites.emit('maj', { 'sun.sun': entites.valeur['sun.sun'] });
  await laisserFinir();
  assert.equal(connexion.appels.length, 1, 'une autre entité ne relit pas');

  entites.emit('maj', { 'calendar.domicile': { ...ETATS['calendar.domicile'], state: 'on' } });
  await laisserFinir();
  assert.equal(connexion.appels.length, 2, 'un calendrier qui passe à on relit');

  connexion.emit('prete');
  await laisserFinir();
  assert.equal(connexion.appels.length, 3, 'reconnexion à HA');

  t.mock.timers.tick(15 * MINUTE);
  await laisserFinir();
  assert.equal(connexion.appels.length, 4, 'relecture toutes les 15 min');

  connexion.etat = 'ko';
  t.mock.timers.tick(15 * MINUTE);
  await laisserFinir();
  assert.equal(connexion.appels.length, 4, 'HA déconnecté : pas de relecture');
  agenda.arreter();
});
