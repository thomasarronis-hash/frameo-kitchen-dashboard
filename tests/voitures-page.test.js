// tests/voitures-page.test.js
//
// Rôle    : prouver les voitures côté page : les règles sans DOM (web/src/ecrans/voitures-donnees.js : état de la carte,
//           « prête vers », carte grisée au-delà de 6 h avec « vu il y a N h », état vide sans configuration, alerte du
//           soir à partir de 18 h à 25 % ou moins et débranchée, reprise dans la page Aujourd'hui et le compteur de son encart ;
//           commandes et niveaux tirés du flux, « Mode essai », réglage pas à pas, valeur en vol, écart compté depuis la
//           réponse face au vrai serveur, message d'une ligne), l'écran sur le faux DOM (web/src/ecrans/voitures.js et
//           voitures-commandes.js : cartes, boutons de commande, réglages, retour, colonne des commandes à deux voitures) et
//           le menu (web/src/composants/menu.js : 9 entrées dans l'ordre, Clims en dernier depuis le 16/10, plus de Photos,
//           chacune qui navigue).
// Entrées : valeurs voitures écrites ici au format du flux (serveur/ha/voitures.js) ; faux DOM (tests/faux-dom.js) ; un
//           faux client (poster noté, réponse choisie par le test, ou retenue jusqu'à ce que le test la libère) et une
//           fausse horloge monotone ; pour l'écart, serveur/ha/actions-voiture.js monté avec une VOITURES aux noms neutres.
// Sorties : node --test.
// Pièges  : heures construites avec leur décalage (+02:00, Paris en octobre avant le 25). ESP est l'espace insécable.
//           L'anti-répétition des boutons (300 ms, appui.js) suit la vraie horloge : un test n'appuie qu'une fois par
//           bouton, les suites d'appuis sont prouvées sur creerReglage.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lireVoitures } from '../serveur/config.js';
import { creerActionsVoiture } from '../serveur/ha/actions-voiture.js';
import { projeterVoitures } from '../serveur/ha/voitures.js';
import { encartAujourdhui, vueAujourdhui } from '../web/src/ecrans/aujourdhui-donnees.js';
import {
  alertesVoitures, ATTENTE_REGLAGE_MS, COMMANDES, creerReglage, ECART_REGLAGE_MS, messageVoiture, REGLAGES, vueVoitures,
} from '../web/src/ecrans/voitures-donnees.js';
import {
  appuyer, installerFauxDom, parClasse, texte,
} from './faux-dom.js';

installerFauxDom();
const { creerVoitures } = await import('../web/src/ecrans/voitures.js');
const { creerMenu, ENTREES } = await import('../web/src/composants/menu.js');

const ESP = '\u00a0';
const paris = (heure) => Date.parse(`2026-10-14T${heure}:00+02:00`);
const voiture = (autres = {}) => ({
  nom: 'Mégane', batterie: 72, autonomie: { valeur: 214, unite: 'km' }, branchee: true, charge: 'not_in_charge', vu_le: '2026-10-14T16:30:00+02:00', fin_charge: null, ...autres,
});

test('carte : pourcentage, jauge, autonomie, et l\'état dans l\'ordre erreur, en charge, programmée, branchée, débranchée', () => {
  const ms = paris('17:00');
  const carte = (autres) => vueVoitures([voiture(autres)], ms).cartes[0];
  assert.deepEqual(carte({}), {
    nom: 'Mégane', pourcentage: '72', unite: '%', niveau: 0.72, bas: false, autonomie: `214${ESP}km`,
    etat: 'branchee', icone: 'i-prise', libelle: 'Branchée', detail: null, perimee: false,
    commandes: [], niveaux: { charge_min: null, charge_cible: null }, pilotable: false,
  });
  assert.deepEqual([carte({ branchee: false }).etat, carte({ branchee: false }).icone, carte({ branchee: false }).libelle], ['debranchee', 'i-debranchee', 'Débranchée']);
  assert.deepEqual([carte({ charge: 'charge_in_progress' }).icone, carte({ charge: 'charge_in_progress' }).libelle], ['i-eclair', 'En charge']);
  assert.deepEqual([carte({ charge: 'waiting_for_a_planned_charge' }).icone, carte({ charge: 'waiting_for_a_planned_charge' }).libelle], ['i-moon', 'Charge programmée']);
  assert.deepEqual([carte({ charge: 'charge_error', branchee: true }).icone, carte({ charge: 'charge_error' }).libelle], ['i-alert', 'Erreur de charge']);
  assert.deepEqual([carte({ charge: 'charge_ended' }).libelle, carte({ charge: null, branchee: false }).libelle], ['Branchée', 'Débranchée'], 'prise d\'abord quand la charge ne dit rien');
  assert.deepEqual([carte({ charge: null, branchee: null }).etat, carte({ charge: null, branchee: null }).icone], ['inconnu', null]);
  assert.deepEqual([carte({ batterie: 25 }).bas, carte({ batterie: 26 }).bas], [true, false]);
  const inconnue = carte({ batterie: null, autonomie: null });
  assert.deepEqual([inconnue.pourcentage, inconnue.unite, inconnue.niveau, inconnue.bas, inconnue.autonomie], ['?', null, 0, false, null]);
});

test('en charge : « prête vers » à l\'heure de Paris, seulement si l\'heure de fin est connue et pas encore passée', () => {
  const ms = paris('17:00');
  const enCharge = (fin) => vueVoitures([voiture({ charge: 'charge_in_progress', fin_charge: fin })], ms).cartes[0].detail;
  assert.equal(enCharge('2026-10-15T04:40:00Z'), `prête vers 6${ESP}h${ESP}40`);
  assert.equal(enCharge(null), null);
  assert.equal(enCharge('2026-10-14T14:00:00Z'), null, 'heure passée : rien');
  assert.equal(vueVoitures([voiture({ fin_charge: '2026-10-15T04:40:00Z' })], ms).cartes[0].detail, null, 'pas en charge : rien');
});

test('donnée de plus de 6 h : carte grisée et « vu il y a N h » (en jours au-delà de 48 h) ; sans heure connue, jamais grisée', () => {
  const vu = (heure, ms) => vueVoitures([voiture({ vu_le: heure, charge: 'charge_in_progress', fin_charge: '2026-10-15T04:40:00Z' })], ms).cartes[0];
  const fraiche = vu('2026-10-14T11:00:00+02:00', paris('17:00'));
  assert.deepEqual([fraiche.perimee, fraiche.detail], [false, `prête vers 6${ESP}h${ESP}40`], '6 h pile : encore fraîche');
  const vieille = vu('2026-10-14T08:00:00+02:00', paris('17:00'));
  assert.deepEqual([vieille.perimee, vieille.detail], [true, `vu il y a 9${ESP}h`], 'le détail de charge laisse la place');
  assert.equal(vu('2026-10-12T15:00:00+02:00', paris('17:00')).detail, `vu il y a 2${ESP}jours`);
  assert.equal(vu('2026-10-12T18:00:00+02:00', paris('17:00')).detail, `vu il y a 47${ESP}h`);
  assert.equal(vu(null, paris('17:00')).perimee, false);
  assert.deepEqual([vu('2026-10-14T10:59:00+02:00', paris('17:00')).perimee, vu('2026-10-14T10:00:00+02:00', paris('17:00')).detail], [true, `vu il y a 7${ESP}h`],
    '6 h 01 : grisée ; 7 h : « vu il y a 7 h »');
  assert.equal(vu('2026-10-14T18:00:00+02:00', paris('17:00')).perimee, false, 'heure en avance (horloge) : fraîche');
});

test('écran : attente avant le flux, « Voiture pas encore reliée » sans configuration, deux cartes au plus', () => {
  assert.deepEqual(vueVoitures(null, paris('17:00'), true), { etat: 'attente', essai: false, cartes: [] });
  assert.deepEqual(vueVoitures([], paris('17:00'), true), { etat: 'vide', essai: false, cartes: [] });
  assert.equal(vueVoitures([voiture(), voiture({ nom: 'Zoé' }), voiture({ nom: 'Trop' })], paris('17:00')).cartes.length, 2);
});

test('alerte du soir : à partir de 18 h, batterie à 25 % ou moins et prise débranchée ; jamais sur une donnée inconnue', () => {
  const basse = voiture({ batterie: 22, branchee: false });
  const attendue = [{ icone: 'i-voiture', titre: 'Mégane', valeur: `22${ESP}% · à brancher` }];
  assert.deepEqual(alertesVoitures([basse], paris('17:59')), [], 'avant 18 h : rien');
  assert.deepEqual(alertesVoitures([basse], paris('18:00')), attendue);
  assert.deepEqual(alertesVoitures([basse], paris('23:59')), attendue);
  assert.deepEqual(alertesVoitures([basse], Date.parse('2026-10-15T00:30:00+02:00')), [], 'après minuit : plus rien');
  assert.deepEqual(alertesVoitures([voiture({ batterie: 25, branchee: false })], paris('19:00')).length, 1, '25 % pile : alerte (« alerte à 25 % »)');
  assert.deepEqual(alertesVoitures([voiture({ batterie: 26, branchee: false })], paris('19:00')), [], '26 % : rien');
  assert.deepEqual(alertesVoitures([voiture({ batterie: 22, branchee: true })], paris('19:00')), [], 'branchée');
  assert.deepEqual(alertesVoitures([voiture({ batterie: 22, branchee: null })], paris('19:00')), [], 'prise inconnue');
  assert.deepEqual(alertesVoitures([voiture({ batterie: null, branchee: false })], paris('19:00')), [], 'batterie inconnue');
  assert.deepEqual(alertesVoitures([voiture({ batterie: 22, branchee: false, vu_le: '2026-10-14T07:00:00+02:00' })], paris('19:00')).length, 1, 'donnée vieille : alerte quand même');
  assert.deepEqual(alertesVoitures(null, paris('19:00')), []);
  assert.deepEqual(alertesVoitures([], paris('19:00')), []);
});

test('page Aujourd\'hui : l\'alerte voiture après les ouvertures et avant les draps, comptée par l\'encart ; rien avant 18 h', () => {
  const donnees = {
    entites: {}, meteo: null, menu: null, agenda: null, air: null, draps: { timo: '2026-09-20', pablo: null, parents: null },
    voitures: [voiture({ batterie: 18, branchee: false })],
  };
  const soir = vueAujourdhui(donnees, paris('18:30'));
  assert.deepEqual(soir.alertes.lignes.map((ligne) => ligne.icone), ['i-voiture', 'i-lit']);
  assert.equal(soir.alertes.lignes[0].valeur, `18${ESP}% · à brancher`);
  assert.deepEqual(encartAujourdhui(soir).badges.filter((badge) => badge.alerte), [{ icone: 'i-alert', nombre: 2, alerte: true }]);
  const apresMidi = vueAujourdhui(donnees, paris('17:30'));
  assert.deepEqual(apresMidi.alertes.lignes.map((ligne) => ligne.icone), ['i-lit']);
});

test('écran sur le faux DOM : état vide, une carte (classes d\'état, grisée, jauge), deux cartes', () => {
  const { conteneur } = installerFauxDom();
  const ecran = creerVoitures(conteneur, { client: fauxClient().client, monotone: () => 0 });
  const vide = parClasse(conteneur, 'voitures-vide')[0];
  const liste = parClasse(conteneur, 'voitures-liste')[0];
  const cartes = parClasse(conteneur, 'voiture');
  const blocs = parClasse(conteneur, 'voiture-bloc');
  ecran.mettreAJour(vueVoitures(null, paris('17:00')));
  assert.deepEqual([vide.hidden, liste.hidden], [true, true], 'avant le flux : rien');
  ecran.mettreAJour(vueVoitures([], paris('17:00')));
  assert.deepEqual([vide.hidden, liste.hidden], [false, true]);
  assert.equal(texte(vide), 'Voiture pas encore reliée');

  ecran.mettreAJour(vueVoitures([voiture({ batterie: 22, branchee: false, vu_le: '2026-10-14T07:00:00+02:00' })], paris('17:00')));
  assert.deepEqual([vide.hidden, liste.hidden, blocs[0].hidden, blocs[1].hidden], [true, false, false, true]);
  assert.equal(texte(parClasse(cartes[0], 'voiture-nom')[0]), 'Mégane');
  assert.equal(texte(parClasse(cartes[0], 'voiture-pourcentage')[0]), '22%');
  assert.equal(parClasse(cartes[0], 'voiture-unite')[0].hidden, false);
  assert.equal(texte(parClasse(cartes[0], 'voiture-autonomie')[0]), `214${ESP}km`);
  assert.equal(texte(parClasse(cartes[0], 'voiture-etat-libelle')[0]), 'Débranchée');
  assert.equal(texte(parClasse(cartes[0], 'voiture-etat-detail')[0]), `vu il y a 10${ESP}h`);
  assert.equal(parClasse(cartes[0], 'voiture-niveau')[0].style.transform, 'scaleX(0.22)');
  for (const classe of ['voiture-etat-debranchee', 'voiture-bas', 'voiture-perimee']) assert.ok(cartes[0].classList.contains(classe), classe);
  assert.ok(!liste.classList.contains('voitures-deux'));

  ecran.mettreAJour(vueVoitures([voiture({ charge: 'charge_in_progress', fin_charge: '2026-10-15T04:40:00Z' }), voiture({ nom: 'Zoé', autonomie: null })], paris('17:00')));
  assert.deepEqual([blocs[0].hidden, blocs[1].hidden], [false, false]);
  assert.ok(liste.classList.contains('voitures-deux'));
  assert.ok(cartes[0].classList.contains('voiture-etat-en-charge') && !cartes[0].classList.contains('voiture-etat-debranchee'));
  assert.ok(!cartes[0].classList.contains('voiture-perimee') && !cartes[0].classList.contains('voiture-bas'));
  assert.equal(texte(parClasse(cartes[0], 'voiture-etat-detail')[0]), `prête vers 6${ESP}h${ESP}40`);
  assert.equal(parClasse(cartes[1], 'voiture-autonomie')[0].hidden, true, 'sans autonomie : rien');
  assert.equal(parClasse(cartes[1], 'voiture-etat-detail')[0].hidden, true);
});

// Faux client : note chaque poster et répond ce que le test a choisi (reponse), comme client.poster d'api.js.
function fauxClient(reponse = { ok: true, donnees: { ok: true, simulation: true } }) {
  const envois = [];
  const client = {
    reponse,
    poster(chemin, corps) {
      envois.push({ chemin, corps });
      return Promise.resolve(client.reponse);
    },
  };
  return { client, envois };
}
const laisserRepondre = () => new Promise((resoudre) => setImmediate(resoudre));
const NIVEAUX = { charge_min: { valeur: 45, min: 15, max: 45, pas: 5 }, charge_cible: { valeur: 100, min: 55, max: 100, pas: 5 } };
const pilotee = (autres = {}) => voiture({ commandes: ['charger', 'clim', 'phares', 'klaxon'], niveaux: NIVEAUX, ...autres });

test('commandes : celles du flux dans l\'ordre Charger, Clim, Phares, Klaxon ; niveaux contrôlés ; serveur ancien : rien à piloter', () => {
  assert.deepEqual(COMMANDES.map((c) => [c.cle, c.libelle]), [['charger', 'Charger'], ['clim', 'Clim'], ['phares', 'Phares'], ['klaxon', 'Klaxon']]);
  assert.deepEqual(REGLAGES.map((r) => [r.cle, r.libelle]), [['charge_min', 'Charge mini'], ['charge_cible', 'Charge cible']]);
  const carte = (autres) => vueVoitures([voiture(autres)], paris('17:00')).cartes[0];
  const complete = carte({ commandes: ['klaxon', 'ouvrir', 'charger'], niveaux: NIVEAUX });
  assert.deepEqual([complete.commandes, complete.niveaux, complete.pilotable], [['charger', 'klaxon'], NIVEAUX, true]);
  const bornesFausses = carte({ commandes: [], niveaux: { charge_min: { valeur: 45, min: 45, max: 15, pas: 5 }, charge_cible: { valeur: '100', min: 55, max: 100, pas: 5 } } });
  assert.deepEqual([bornesFausses.niveaux, bornesFausses.pilotable], [{ charge_min: null, charge_cible: null }, false]);
  const seulNiveau = carte({ commandes: [], niveaux: { charge_min: null, charge_cible: NIVEAUX.charge_cible } });
  assert.equal(seulNiveau.pilotable, true, 'un seul réglage suffit');
  const ancienne = carte({});
  assert.deepEqual([ancienne.commandes, ancienne.niveaux, ancienne.pilotable], [[], { charge_min: null, charge_cible: null }, false]);
});

test('« Mode essai » : seulement si le serveur simule (simulation_voiture: true) et qu\'il y a quelque chose à piloter', () => {
  const ms = paris('17:00');
  assert.equal(vueVoitures([pilotee()], ms, true).essai, true);
  assert.equal(vueVoitures([pilotee()], ms, false).essai, false);
  assert.equal(vueVoitures([pilotee()], ms, null).essai, false, 'signal absent : pas d\'essai affiché');
  assert.equal(vueVoitures([voiture()], ms, true).essai, false, 'lecture seule : rien à dire');
  assert.equal(vueVoitures([voiture(), pilotee({ nom: 'Zoé' })], ms, true).essai, true);
});

test('réglage pas à pas : un pas par appui, bornes et grille, envoi 1,5 s après le dernier appui et 10 s après le précédent', () => {
  const niveau = NIVEAUX.charge_min;
  const reglage = creerReglage();
  assert.equal(reglage.affichee(niveau, 0), 45);
  assert.equal(reglage.appuyer(1, niveau, 0), 45, 'déjà au maximum');
  assert.equal(reglage.echue(niveau, ATTENTE_REGLAGE_MS), null, 'revenue à la valeur actuelle : rien ne part');
  assert.equal(reglage.enCours(), false);
  [100, 400, 700].forEach((ms) => reglage.appuyer(-1, niveau, ms));
  assert.deepEqual([reglage.affichee(niveau, 800), reglage.enCours()], [30, true]);
  assert.equal(reglage.echue(niveau, 700 + ATTENTE_REGLAGE_MS - 1), null, 'doigt pas encore au repos depuis 1,5 s');
  assert.equal(reglage.echue(niveau, 700 + ATTENTE_REGLAGE_MS), 30);
  assert.equal(reglage.enCours(), false);
  reglage.recu(30, { ok: true, donnees: { ok: true, simulation: false } }, 2200);
  assert.equal(reglage.affichee(niveau, 3000), 30, 'envoyée pour de vrai : affichée en attendant le flux');
  reglage.appuyer(-1, niveau, 3000);
  assert.equal(reglage.affichee(niveau, 3000), 25, 'part de la valeur affichée, pas de celle du flux');
  assert.equal(reglage.echue(niveau, 3000 + ATTENTE_REGLAGE_MS), null, 'moins de 10 s après la réponse au précédent envoi : attend');
  assert.equal(reglage.echue(niveau, 2200 + ECART_REGLAGE_MS), 25, '10 s après la réponse : part');
  reglage.recu(25, { ok: false, statut: 429 }, 12300);
  assert.equal(reglage.affichee(niveau, 12300), 45, 'refusée : retour à la valeur du flux');
  for (let i = 0; i < 12; i += 1) reglage.appuyer(-1, niveau, 20000 + i);
  assert.equal(reglage.affichee(niveau, 20020), 15, 'jamais sous le minimum');
  assert.equal(reglage.echue(null, 30000), null, 'réglage disparu du flux : rien ne part');
  assert.equal(reglage.enCours(), false);
});

test('réglage : valeur attendue jusqu\'à ce que le flux la rapporte (2 min au plus) ; mode essai : retour immédiat ; grille du minimum', () => {
  const reglage = creerReglage();
  const cible = NIVEAUX.charge_cible;
  reglage.appuyer(-1, cible, 0);
  assert.equal(reglage.echue(cible, ATTENTE_REGLAGE_MS), 95);
  reglage.recu(95, { ok: true, donnees: { ok: true, simulation: false } }, 2000);
  assert.equal(reglage.affichee(cible, 60000), 95);
  assert.equal(reglage.affichee({ ...cible, valeur: 95 }, 61000), 95, 'le flux la rapporte');
  assert.equal(reglage.affichee(cible, 62000), 100, 'ensuite, c\'est de nouveau le flux qui compte');
  reglage.appuyer(-1, cible, 70000);
  assert.equal(reglage.echue(cible, 70000 + ATTENTE_REGLAGE_MS), 95);
  reglage.recu(95, { ok: true, donnees: { ok: true, simulation: false } }, 72000);
  assert.equal(reglage.affichee(cible, 72000 + 119999), 95);
  assert.equal(reglage.affichee(cible, 72000 + 120000), 100, 'jamais rapportée : 2 min plus tard, la valeur du flux');
  const essai = creerReglage();
  essai.appuyer(-1, cible, 0);
  essai.echue(cible, ATTENTE_REGLAGE_MS);
  essai.recu(95, { ok: true, donnees: { ok: true, simulation: true } }, 2000);
  assert.equal(essai.affichee(cible, 2000), 100, 'mode essai : rien n\'a changé dans la voiture');
  const decale = creerReglage();
  assert.equal(decale.appuyer(1, { valeur: 17, min: 15, max: 45, pas: 5 }, 0), 20, 'valeur hors grille : ramenée sur min + k x pas');
});

test('réglage en vol : la valeur partie reste affichée jusqu\'à la réponse, rien d\'autre ne part ; 10 s comptées depuis la réponse', () => {
  const cible = NIVEAUX.charge_cible;
  const reglage = creerReglage();
  reglage.appuyer(-1, cible, 0);
  assert.equal(reglage.echue(cible, 2000), 95);
  assert.deepEqual([reglage.affichee(cible, 2000), reglage.enCours()], [95, false], 'partie : affichée, plus en cours de choix');
  assert.equal(reglage.affichee(cible, 6000), 95, 'réponse qui tarde : toujours la valeur partie, jamais celle du flux');
  assert.equal(reglage.appuyer(-1, cible, 3000), 90, 'un appui pendant l\'envoi part de la valeur partie');
  assert.equal(reglage.echue(cible, 20000), null, 'rien ne part tant que la réponse n\'est pas là');
  assert.equal(reglage.enCours(), true);
  reglage.recu(95, { ok: true, donnees: { ok: true, simulation: false } }, 21000);
  assert.equal(reglage.echue(cible, 21000 + ECART_REGLAGE_MS - 1), null, '10 s comptées depuis la réponse, pas depuis le départ');
  assert.equal(reglage.echue(cible, 21000 + ECART_REGLAGE_MS), 90);
  assert.equal(reglage.affichee(cible, 31000), 90);
});

test('réglage face au serveur (creerActionsVoiture) : un premier envoi plus lent à arriver que le second ne fait plus refuser le second', async () => {
  const voitures = lireVoitures({
    VOITURES: 'Mégane: batterie=sensor.megane_batterie, branchee=binary_sensor.megane_prise, charge_cible=number.megane_niveau_de_charge_cible',
  });
  const etats = { 'number.megane_niveau_de_charge_cible': { state: '100', attributes: { min: 55, max: 100, step: 5 } } };
  const horloge = { ms: 0 };
  const serveur = creerActionsVoiture({
    connexion: { ecrireVoiture: async () => {} }, voitures, source: { valeur: projeterVoitures(etats, voitures) },
    reelles: true, journal: { info() {}, error() {} }, monotone: () => horloge.ms,
  });
  const poster = (valeur) => serveur.executer('voiture_niveau', { voiture: 'Mégane', reglage: 'charge_cible', valeur })
    .then((donnees) => ({ ok: true, donnees }), (err) => ({ ok: false, statut: err.statusCode, code: err.code }));
  // Une seule horloge pour la page et le serveur. Le premier envoi met 300 ms à arriver (Wi-Fi du cadre qui décroche),
  // le second 15 ms ; la réponse revient 50 ms après l'arrivée. Compté au départ (ancienne règle), le second partait à
  // 12 000 ms et arrivait 9 715 ms après le premier : 429 trop_tot, valeur perdue.
  const latences = [300, 15];
  const appuis = { 0: -1, 4000: -1 };
  const reglage = creerReglage();
  const envois = [];
  for (let ms = 0; ms <= 20000; ms += 1000) {
    if (appuis[ms]) reglage.appuyer(appuis[ms], NIVEAUX.charge_cible, ms);
    const valeur = reglage.echue(NIVEAUX.charge_cible, ms);
    if (valeur !== null) {
      horloge.ms = ms + latences[envois.length];
      const reponse = await poster(valeur);
      envois.push([ms, valeur, reponse.ok ? 'accepté' : reponse.code]);
      reglage.recu(valeur, reponse, horloge.ms + 50);
    }
  }
  assert.deepEqual(envois, [[2000, 95, 'accepté'], [13000, 90, 'accepté']], 'le second part 10 s après la réponse (2 350 ms)');
});

test('message d\'une ligne : envoyé, mode essai, trop tôt, voiture qui ne répond pas, serveur muet, refus', () => {
  assert.equal(messageVoiture({ ok: true, donnees: { ok: true, simulation: false } }, 'Mégane'), 'Envoyé');
  assert.equal(messageVoiture({ ok: true, donnees: { ok: true, simulation: true } }, 'Mégane'), 'Mode essai : rien n\'est envoyé');
  assert.equal(messageVoiture({ ok: false, statut: 429, code: 'trop_tot' }, 'Mégane'), 'Trop tôt, réessayer dans un moment');
  assert.equal(messageVoiture({ ok: false, statut: 502 }, 'Mégane'), 'La Mégane ne répond pas');
  assert.equal(messageVoiture({ ok: false, statut: 503 }, 'Zoé'), 'La Zoé ne répond pas');
  assert.equal(messageVoiture({ ok: false, statut: 0 }, 'Mégane'), 'Pas de réponse du serveur du cadre');
  assert.equal(messageVoiture({ ok: false, statut: 400 }, 'Mégane'), 'Commande refusée par le serveur');
  assert.equal(messageVoiture({ ok: false, statut: 404 }, 'Mégane'), 'Commande refusée par le serveur');
});

test('écran sur le faux DOM : 4 boutons d\'un mot, un appui = une commande sans confirmation, retour d\'une ligne effacé après 8 s', async () => {
  const { conteneur } = installerFauxDom();
  const horloge = { ms: 0 };
  const { client, envois } = fauxClient();
  const ecran = creerVoitures(conteneur, { client, monotone: () => horloge.ms });
  ecran.mettreAJour(vueVoitures([pilotee()], paris('17:00'), true));
  const essai = parClasse(conteneur, 'voitures-essai')[0];
  assert.deepEqual([essai.hidden, texte(essai)], [false, 'Mode essai : rien n\'est envoyé']);
  const [bloc] = parClasse(conteneur, 'voiture-bloc');
  assert.ok(bloc.classList.contains('voiture-bloc-pilotable'));
  const boutons = parClasse(bloc, 'voiture-commande');
  assert.deepEqual(boutons.map((b) => [texte(b), b.hidden]), [['Charger', false], ['Clim', false], ['Phares', false], ['Klaxon', false]]);
  assert.deepEqual(boutons.map((b) => b.childNodes[0].getAttribute('class')), Array(4).fill('ico voiture-commande-icone'), 'un pictogramme chacun');
  const message = parClasse(bloc, 'voiture-message')[0];
  appuyer(boutons[3]);
  assert.deepEqual(envois, [{ chemin: '/api/action/voiture_commande', corps: { voiture: 'Mégane', commande: 'klaxon' } }], 'parti au premier appui');
  await laisserRepondre();
  assert.equal(texte(message), 'Mode essai : rien n\'est envoyé');
  client.reponse = { ok: false, statut: 429, code: 'trop_tot' };
  horloge.ms = 1000;
  appuyer(boutons[2]);
  await laisserRepondre();
  assert.deepEqual([texte(message), message.classList.contains('voiture-message-alerte')], ['Trop tôt, réessayer dans un moment', true]);
  client.reponse = { ok: false, statut: 502 };
  appuyer(boutons[0]);
  await laisserRepondre();
  assert.equal(texte(message), 'La Mégane ne répond pas');
  client.reponse = { ok: true, donnees: { ok: true, simulation: false } };
  appuyer(boutons[1]);
  await laisserRepondre();
  assert.deepEqual([texte(message), message.classList.contains('voiture-message-alerte')], ['Envoyé', false]);
  assert.deepEqual(envois.map((e) => e.corps.commande), ['klaxon', 'phares', 'charger', 'clim']);
  horloge.ms = 1000 + 7999;
  ecran.entretenir();
  assert.equal(texte(message), 'Envoyé');
  horloge.ms = 1000 + 8000;
  ecran.entretenir();
  assert.equal(texte(message), '', 'effacé au bout de 8 s');
});

test('écran sur le faux DOM : réglage « − 45 % + », valeur en cours en accent, envoyée 1,5 s après le dernier appui, bornes désactivées', async () => {
  const { conteneur } = installerFauxDom();
  const horloge = { ms: 0 };
  const { client, envois } = fauxClient({ ok: true, donnees: { ok: true, simulation: false } });
  const ecran = creerVoitures(conteneur, { client, monotone: () => horloge.ms });
  ecran.mettreAJour(vueVoitures([pilotee()], paris('17:00'), false));
  assert.equal(parClasse(conteneur, 'voitures-essai')[0].hidden, true, 'réel : pas de « Mode essai »');
  const [mini, cible] = parClasse(conteneur, 'voiture-reglage');
  assert.deepEqual([texte(mini), texte(cible)], ['Charge mini45%', 'Charge cible100%']);
  const [moins, plus] = parClasse(mini, 'voiture-pas-bouton');
  assert.deepEqual([moins.getAttribute('aria-label'), plus.getAttribute('aria-label')], ['Baisser la charge mini', 'Monter la charge mini']);
  assert.deepEqual([moins.disabled, plus.disabled], [false, true], '45 % : déjà au maximum');
  appuyer(moins);
  assert.deepEqual([texte(parClasse(mini, 'voiture-reglage-valeur')[0]), mini.classList.contains('voiture-reglage-en-cours')], ['40%', true]);
  assert.equal(plus.disabled, false);
  horloge.ms = ATTENTE_REGLAGE_MS - 1;
  ecran.entretenir();
  assert.deepEqual(envois, [], 'pas avant 1,5 s sans appui');
  horloge.ms = ATTENTE_REGLAGE_MS;
  ecran.entretenir();
  assert.deepEqual(envois, [{ chemin: '/api/action/voiture_niveau', corps: { voiture: 'Mégane', reglage: 'charge_min', valeur: 40 } }]);
  assert.equal(mini.classList.contains('voiture-reglage-en-cours'), false);
  await laisserRepondre();
  assert.equal(texte(parClasse(conteneur, 'voiture-message')[0]), 'Envoyé');
  assert.equal(texte(parClasse(mini, 'voiture-reglage-valeur')[0]), '40%', 'attendue jusqu\'au flux');
  ecran.mettreAJour(vueVoitures([pilotee({ niveaux: { ...NIVEAUX, charge_min: { ...NIVEAUX.charge_min, valeur: 40 } } })], paris('17:01'), false));
  assert.equal(texte(parClasse(mini, 'voiture-reglage-valeur')[0]), '40%');
  ecran.entretenir();
  assert.equal(envois.length, 1, 'rien de plus ne part');
});

// Client dont les réponses attendent le test (requêtes en route) : repondre(reponse) libère la plus ancienne.
function clientEnAttente() {
  const envois = [];
  const attentes = [];
  const client = {
    poster(chemin, corps) {
      envois.push({ chemin, corps });
      return new Promise((resoudre) => { attentes.push(resoudre); });
    },
  };
  return { client, envois, repondre: (reponse) => attentes.shift()(reponse) };
}

test('écran sur le faux DOM : pendant l\'envoi d\'un réglage, la valeur choisie reste affichée jusqu\'à la réponse', async () => {
  const { conteneur } = installerFauxDom();
  const horloge = { ms: 0 };
  const { client, envois, repondre } = clientEnAttente();
  const ecran = creerVoitures(conteneur, { client, monotone: () => horloge.ms });
  ecran.mettreAJour(vueVoitures([pilotee()], paris('17:00'), false));
  const [mini, cible] = parClasse(conteneur, 'voiture-reglage');
  const valeur = (bloc) => texte(parClasse(bloc, 'voiture-reglage-valeur')[0]);
  const message = parClasse(conteneur, 'voiture-message')[0];
  appuyer(parClasse(mini, 'voiture-pas-bouton')[0]);
  horloge.ms = ATTENTE_REGLAGE_MS;
  ecran.entretenir();
  assert.equal(envois.length, 1);
  assert.deepEqual([valeur(mini), mini.classList.contains('voiture-reglage-en-cours')], ['40%', false], 'partie : affichée, plus en accent');
  horloge.ms = 4000;
  ecran.entretenir();
  await laisserRepondre();
  ecran.mettreAJour(vueVoitures([pilotee()], paris('17:00'), false));
  assert.equal(valeur(mini), '40%', 'réponse qui tarde, flux qui dit encore 45 : toujours 40 %');
  repondre({ ok: true, donnees: { ok: true, simulation: false } });
  await laisserRepondre();
  assert.deepEqual([valeur(mini), texte(message)], ['40%', 'Envoyé']);

  appuyer(parClasse(cible, 'voiture-pas-bouton')[0]);
  horloge.ms = 4000 + ATTENTE_REGLAGE_MS;
  ecran.entretenir();
  assert.equal(envois.length, 2);
  ecran.mettreAJour(vueVoitures([pilotee({ nom: 'Zoé' })], paris('17:00'), false));
  repondre({ ok: true, donnees: { ok: true, simulation: false } });
  await laisserRepondre();
  assert.deepEqual([valeur(cible), texte(message)], ['100%', ''], 'autre voiture à la place : la réponse de l\'ancienne ne la touche pas');
});

test('écran sur le faux DOM : seulement les commandes du flux ; sans rien à piloter, pas de panneau ; deux voitures', () => {
  const { conteneur } = installerFauxDom();
  const ecran = creerVoitures(conteneur, { client: fauxClient().client, monotone: () => 0 });
  ecran.mettreAJour(vueVoitures([pilotee({ commandes: ['klaxon'], niveaux: { charge_min: null, charge_cible: NIVEAUX.charge_cible } })], paris('17:00'), true));
  const [bloc1, bloc2] = parClasse(conteneur, 'voiture-bloc');
  assert.deepEqual(parClasse(bloc1, 'voiture-commande').map((b) => b.hidden), [true, true, true, false]);
  assert.deepEqual(parClasse(bloc1, 'voiture-reglage').map((r) => r.hidden), [true, false]);
  assert.equal(bloc2.hidden, true);
  const liste = parClasse(conteneur, 'voitures-liste')[0];
  assert.ok(liste.classList.contains('voitures-pilotables'));
  ecran.mettreAJour(vueVoitures([pilotee(), voiture({ nom: 'Zoé' })], paris('17:00'), true));
  assert.ok(liste.classList.contains('voitures-deux'));
  assert.ok(liste.classList.contains('voitures-pilotables'), 'une voiture pilotable : colonne des commandes sur les deux blocs');
  assert.equal(bloc2.hidden, false);
  assert.equal(parClasse(bloc2, 'voiture-commandes')[0].hidden, true, 'Zoé en lecture seule : pas de panneau');
  assert.ok(!bloc2.classList.contains('voiture-bloc-pilotable'));
  ecran.mettreAJour(vueVoitures([voiture(), voiture({ nom: 'Zoé' })], paris('17:00'), true));
  assert.ok(!liste.classList.contains('voitures-pilotables'), 'rien à piloter : les cartes sur toute la largeur');
  ecran.mettreAJour(vueVoitures([voiture()], paris('17:00'), true));
  assert.equal(parClasse(conteneur, 'voitures-essai')[0].hidden, true, 'plus rien à piloter : plus de « Mode essai »');
  assert.equal(parClasse(bloc1, 'voiture-commandes')[0].hidden, true);
});

test('menu : 9 entrées dans l\'ordre, Clims en dernier, plus de Photos ; chacune navigue vers son écran', () => {
  assert.deepEqual(ENTREES.map((e) => e.nom), ['Accueil', 'Météo', 'Repas', 'Courses', 'Maison', 'Agenda', 'Enfants', 'Voitures', 'Clims']);
  assert.deepEqual(ENTREES.map((e) => e.icone).slice(-3), ['i-etoile', 'i-voiture', 'i-clim']);
  const { conteneur } = installerFauxDom();
  const navigations = [];
  creerMenu(conteneur, { surNavigation: (nom) => navigations.push(nom) });
  const boutons = parClasse(conteneur, 'menu-entree');
  assert.equal(boutons.length, 9);
  boutons.forEach((bouton) => appuyer(bouton));
  assert.deepEqual(navigations, ['accueil', 'meteo', 'repas', 'courses', 'maison', 'agenda', 'enfants', 'voitures', 'clims']);
});
