// web/src/ecrans/aujourdhui-donnees.js
//
// Rôle    : calculer, sans DOM, la page « Aujourd'hui » (décision de Thomas du 14/10 : elle remplace le brief du matin
//           en phrases de l'Accueil) : ce qui reste à venir aujourd'hui, une carte par sujet, en icônes et en chiffres ;
//           et l'encart « Aujourd'hui » de l'Accueil qui y mène.
// Entrées : donnees (etat.js : entites, meteo, air, menu, agenda, draps, tempo, voitures), ms (heure corrigée par le
//           serveur).
// Sorties : vueAujourdhui(donnees, ms) -> { titre, meteo, rappels, repas, rendezVous, alertes, tempo } :
//             meteo : null (pas encore reçue) ou { periodes: [{ cle, nom, temperature, picto, libelle, pluie }] } (pluie :
//               « 0,8 mm » ou null quand rien n'est prévu ; une période passée n'est pas dans la liste) ;
//             rappels : { lignes: [{ moment, texte }], plus } (ceux dont le moment n'est pas passé) ;
//             repas : { message, midi: { intitule, titre } ou null (passé 14h : null), soir: { titre, temps, repasId }
//               ou null } ;
//             rendezVous : { etat (attente, vide ou ok), lignes: [{ horaire, aLHeure, titre, couleur, initiale,
//               personne }] (à l'heure seulement), plus, journee: { evenements: [{ texte, couleur, initiale,
//               personne }], plus } ou null } (journee : les événements sur toute la journée, sur une seule ligne) ;
//             alertes : { lignes: [{ icone, titre, valeur }], plus } ;
//             tempo : null (pas encore lu) ou { pastille (couleur du jour Tempo en cours, pastilleDuJour), fiche
//               (ficheTempo) } : l'entrée de la fiche Tempo, toute l'année (hors période, l'Accueil n'en montre rien) ;
//           encartAujourdhui(vue) -> { badges: [{ icone, nombre, alerte }], etiquette } pour l'Accueil (alerte : vrai
//             pour le badge des alertes, écrit en couleur d'alerte) ;
//           pour les tests : periodesDuJour(meteo, entite, ms).
// Pièges  :
//   - Aucun appel externe : tout vient de ce que le flux apporte déjà (met.no via HA pour les heures, menu publié,
//     agenda, entités, Open-Meteo pour l'air et les pollens). Une source absente donne un état vide écrit, jamais une
//     valeur inventée.
//   - Ce qui est passé disparaît, comme sur l'Accueil : périodes de la météo, rappels (matin passé midi, midi passé
//     14h, après-midi passé 18h ; le soir reste jusqu'à minuit), gamelle et midi du week-end passé 14h (l'heure de
//     bascule de « Ce midi », repas-donnees.js), rendez-vous finis (evenementsDuJour d'agenda-donnees.js). L'encart ne
//     compte donc que ce qui reste à faire.
//   - Périodes du jour sur les heures de met.no encore à venir (heure en cours comprise) : matin de 6h à 11h, après-midi
//     de 12h à 17h, soir de 18h à 23h. Température : la plus basse le matin et le soir, la plus haute l'après-midi (de
//     quoi s'habiller). Pictogramme : la condition la plus fréquente de la période, la plus sévère en cas d'égalité
//     (GRAVITE). Pluie : le cumul de la période, dans l'unité de l'entité, seulement s'il dépasse 0.
//   - Rappels : ceux du menu datés d'aujourd'hui, rangés par moment (matin, midi, après-midi, soir). C'est le seul
//     texte en phrase de la page : il n'est affiché nulle part ailleurs.
//   - Repas : en semaine, le midi est la gamelle (repas dont gamelles.pour vaut aujourd'hui) ; le week-end, le vrai repas
//     de midi du menu (sa recette s'ouvre depuis « Ce midi » de l'Accueil ou l'écran Repas). Le bouton Recette est celui
//     du soir : repasId seulement si la recette existe (pas de bouton vers « Recette à venir »).
//   - Rendez-vous : ceux À L'HEURE d'abord (ceux pour lesquels on ouvre la page le matin ; « fin 00:30 » pour un
//     rendez-vous commencé la veille, aLHeure faux : un mot et non une heure), puis UNE ligne « Journée » qui réunit les
//     événements sur toute la journée (2 au plus, « +N » pour le reste) : un anniversaire ou des vacances ne prennent
//     plus la place des rendez-vous.
//   - Alertes, seulement s'il y en a, et seulement ce qui demande d'agir, dans cet ordre : veille d'un jour Tempo rouge
//     ou blanc (dès la pré-annonce, choix de Thomas, tempo.js), ouvertures ouvertes (même règle que le bouton Alarme),
//     voiture à brancher (à partir de 18 h, batterie à 25 % ou moins et prise débranchée : voitures-donnees.js ; avant les draps,
//     elle se règle ce soir), draps (rappel 2 jours avant l'échéance, puis à changer : draps-donnees.js), air à partir de « dégradé » (pastille
//     jaune : « moyen » est le niveau de presque tous les jours chez nous, 96 heures sur 96 dans la réponse du
//     11/10), pollen « élevé » (seuils [S] de air.js), encre sous 15 %, piles faibles (maison-donnees.js). Seuils de
//     l'air choisis le 14/10, à valider par Thomas. Les rappels nouveaux (draps, Tempo, voiture) vont ici et dans le compteur de
//     l'encart, jamais sur l'Accueil (décision de Thomas du 14/10), sauf la case Tempo de la barre du bas.
//   - Place (mesurée sur capture du pire cas) : avec la bande des alertes, la carte Rendez-vous garde 4 lignes et la
//     carte À prévoir 2 rappels, sans elle 7 et 3 ; la ligne « Journée » compte pour une ligne ; au-delà, la dernière
//     ligne à l'heure devient « + N autres ». Alertes : 4 au plus, ou 3 et « + N ».
//   - Encart de l'Accueil : un badge par sujet non vide (rendez-vous, rappels, alertes), avec le nombre TOTAL (pas
//     seulement ce que la page montre) ; aucun badge : l'encart dit « rien de prévu ».

import { niveauAir, pollensDuJour } from '../air.js';
import { cielHA } from '../ciel.js';
import { avecUnite, ESP, estNombre, temperature } from '../format.js';
import {
  dateParis, partiesParis, texteDate, texteDuree,
} from '../heure.js';
import {
  alerteTempo, ficheTempo, jourTempo, pastilleDuJour, vueTempo,
} from '../tempo.js';
import { evenementsDuJour } from './agenda-donnees.js';
import { alertesDraps } from './draps-donnees.js';
import { encres, pilesFaibles, vueOuvertures } from './maison-donnees.js';
import { repasDuJour } from './repas-donnees.js';
import { alertesVoitures } from './voitures-donnees.js';

const ENTITE_METEO = 'weather.forecast_maison';
const HEURE_MS = 3600000;
const HEURE_FIN_MIDI = 14;
const RANG_ALERTE_AIR = 3;
const RANG_ALERTE_POLLEN = 3;
const ALERTES_MAX = 4;
const JOURNEE_MAX = 2;
const PLACE = { pleine: { rendezVous: 7, rappels: 3 }, reduite: { rendezVous: 4, rappels: 2 } };
const PERIODES = [
  { cle: 'matin', nom: 'Matin', debut: 6, fin: 12, garder: Math.min },
  { cle: 'apres_midi', nom: 'Après-midi', debut: 12, fin: 18, garder: Math.max },
  { cle: 'soir', nom: 'Soir', debut: 18, fin: 24, garder: Math.min },
];
// Moments des rappels du menu, dans l'ordre, avec l'heure (Paris) où ils sont passés.
const MOMENTS = [
  { cle: 'matin', nom: 'Matin', fin: 12 },
  { cle: 'midi', nom: 'Midi', fin: 14 },
  { cle: 'apres_midi', nom: 'Après-midi', fin: 18 },
  { cle: 'soir', nom: 'Soir', fin: 24 },
];
// Conditions de HA de la moins à la plus sévère : départage les égalités du pictogramme d'une période.
const GRAVITE = ['clear-night', 'sunny', 'partlycloudy', 'cloudy', 'windy-variant', 'windy', 'fog', 'rainy', 'snowy-rainy',
  'snowy', 'pouring', 'hail', 'lightning', 'lightning-rainy', 'exceptional'];

// Heures de met.no d'aujourd'hui encore à venir (heure en cours comprise), à l'heure de Paris.
function heuresDuJour(meteo, ms) {
  const aujourdhui = dateParis(ms);
  const debutHeure = ms - (ms % HEURE_MS);
  return meteo.horaire
    .map((h) => ({ instant: Date.parse(h.datetime), h }))
    .filter(({ instant }) => instant >= debutHeure && dateParis(instant) === aujourdhui)
    .map(({ instant, h }) => ({
      heure: partiesParis(instant).heure, temperature: h.temperature, precipitation: h.precipitation, condition: h.condition,
    }));
}

function conditionDominante(heures) {
  const comptes = {};
  heures.forEach((h) => {
    if (GRAVITE.indexOf(h.condition) !== -1) comptes[h.condition] = (comptes[h.condition] || 0) + 1;
  });
  let dominante = null;
  Object.keys(comptes).forEach((condition) => {
    const devant = dominante === null || comptes[condition] > comptes[dominante]
      || (comptes[condition] === comptes[dominante] && GRAVITE.indexOf(condition) > GRAVITE.indexOf(dominante));
    if (devant) dominante = condition;
  });
  return dominante;
}

export function periodesDuJour(meteo, entite, ms) {
  const a = entite ? entite.attributes : {};
  const heures = heuresDuJour(meteo, ms);
  return PERIODES
    .map((periode) => ({ periode, siennes: heures.filter((h) => h.heure >= periode.debut && h.heure < periode.fin) }))
    .filter(({ siennes }) => siennes.length > 0)
    .map(({ periode, siennes }) => {
      const temperatures = siennes.filter((h) => estNombre(h.temperature)).map((h) => h.temperature);
      const cumul = siennes.filter((h) => estNombre(h.precipitation)).reduce((somme, h) => somme + h.precipitation, 0);
      const ciel = cielHA(conditionDominante(siennes));
      const retenue = temperatures.length > 0 ? periode.garder.apply(null, temperatures) : null;
      return {
        cle: periode.cle,
        nom: periode.nom,
        temperature: temperature(retenue, a.temperature_unit),
        picto: ciel.picto,
        libelle: ciel.libelle,
        pluie: cumul > 0 ? avecUnite(cumul, a.precipitation_unit) : null,
      };
    });
}

// Les premières lignes et le reste compté : au-delà de max, max - 1 lignes et « + N autres » à la place de la dernière.
function plafonner(liste, max) {
  if (liste.length <= max) return { lignes: liste, plus: 0 };
  return { lignes: liste.slice(0, max - 1), plus: liste.length - (max - 1) };
}

function rappelsDuJour(menu, aujourdhui, heure) {
  if (!menu || !menu.rappels) return [];
  const rang = (rappel) => MOMENTS.findIndex((m) => m.cle === rappel.moment);
  return menu.rappels
    .filter((rappel) => rappel.date === aujourdhui && rang(rappel) !== -1 && heure < MOMENTS[rang(rappel)].fin)
    .map((rappel, ordre) => ({ rappel, ordre }))
    .sort((x, y) => (rang(x.rappel) - rang(y.rappel)) || (x.ordre - y.ordre))
    .map(({ rappel }) => ({ moment: MOMENTS[rang(rappel)].nom, texte: rappel.texte }));
}

function repasDuJourVue(menu, aujourdhui, heure) {
  if (!menu || aujourdhui < menu.cycle.debut || aujourdhui > menu.cycle.fin) {
    return { message: 'Menu pas encore publié', midi: null, soir: null };
  }
  const jour = repasDuJour(menu, aujourdhui);
  let midi = null;
  if (heure < HEURE_FIN_MIDI && jour.midi) midi = { intitule: 'Midi', titre: jour.midi.titre };
  else if (heure < HEURE_FIN_MIDI && jour.gamelle) midi = { intitule: 'Gamelle', titre: jour.gamelle.titre };
  let soir = null;
  if (jour.soir) {
    soir = {
      titre: jour.soir.titre,
      temps: texteDuree(jour.soir.temps_min * 60000),
      repasId: jour.soir.recette !== null ? jour.soir.id : null,
    };
  }
  return { message: midi || soir ? null : 'Pas de repas prévu', midi, soir };
}

// Rendez-vous du jour : à l'heure d'abord, plafonnés à la place qui reste, puis la ligne « Journée ».
function rendezVousDuJour(agenda, aujourdhui, ms, place) {
  if (!agenda) return { etat: 'attente', lignes: [], plus: 0, journee: null };
  if (agenda.calendriers.length === 0) return { etat: 'vide', lignes: [], plus: 0, journee: null };
  const evenements = evenementsDuJour(agenda, aujourdhui, ms);
  const journees = evenements.filter((e) => e.horaire === 'Journée');
  const heures = evenements.filter((e) => e.horaire !== 'Journée').map((e) => ({
    horaire: e.horaire,
    aLHeure: /^\d\d:\d\d$/.test(e.horaire),
    titre: e.titre,
    couleur: e.couleur,
    initiale: e.initiale,
    personne: e.personne,
  }));
  const journee = journees.length === 0 ? null : {
    evenements: journees.slice(0, JOURNEE_MAX).map((e) => ({
      texte: e.titre, couleur: e.couleur, initiale: e.initiale, personne: e.personne,
    })),
    plus: Math.max(0, journees.length - JOURNEE_MAX),
  };
  return Object.assign({ etat: 'ok', journee }, plafonner(heures, place - (journee ? 1 : 0)));
}

function alertesDuJour(donnees, ms) {
  const { entites, air } = donnees;
  const tempo = alerteTempo(vueTempo(donnees.tempo, ms));
  const alertes = (tempo ? [tempo] : []).concat(vueOuvertures(entites, ms).lignes
    .filter((ligne) => ligne.etat === 'ouverte')
    .map((ligne) => ({ icone: 'i-door', titre: ligne.nom, valeur: ligne.depuis || 'ouverte' })))
    .concat(alertesVoitures(donnees.voitures, ms))
    .concat(alertesDraps(donnees.draps, ms));
  if (air) {
    const indice = air.actuel.european_aqi;
    if (estNombre(indice) && niveauAir(indice).rang >= RANG_ALERTE_AIR) {
      alertes.push({ icone: 'i-leaf', titre: 'Air', valeur: niveauAir(indice).libelle.toLowerCase() });
    }
    const jour = air.jours.filter((candidat) => candidat.date === dateParis(ms))[0];
    pollensDuJour(jour).lignes
      .filter((pollen) => pollen.rang >= RANG_ALERTE_POLLEN)
      .forEach((pollen) => alertes.push({ icone: 'i-leaf', titre: pollen.nom, valeur: `pollen ${pollen.niveau}` }));
  }
  encres(entites)
    .filter((encre) => encre.alerte)
    .forEach((encre) => alertes.push({ icone: 'i-print', titre: encre.nom, valeur: encre.texte }));
  pilesFaibles(entites).forEach((nom) => alertes.push({ icone: 'i-battery', titre: nom, valeur: 'pile faible' }));
  return alertes;
}

export function vueAujourdhui(donnees, ms) {
  const aujourdhui = dateParis(ms);
  const heure = partiesParis(ms).heure;
  const alertes = alertesDuJour(donnees, ms);
  const place = PLACE[alertes.length > 0 ? 'reduite' : 'pleine'];
  return {
    titre: texteDate(ms),
    meteo: donnees.meteo ? { periodes: periodesDuJour(donnees.meteo, donnees.entites[ENTITE_METEO], ms) } : null,
    rappels: plafonner(rappelsDuJour(donnees.menu, aujourdhui, heure), place.rappels),
    repas: repasDuJourVue(donnees.menu, aujourdhui, heure),
    rendezVous: rendezVousDuJour(donnees.agenda, aujourdhui, ms, place.rendezVous),
    alertes: plafonner(alertes, ALERTES_MAX),
    tempo: donnees.tempo ? { pastille: pastilleDuJour(donnees.tempo, jourTempo(ms)), fiche: ficheTempo(vueTempo(donnees.tempo, ms)) } : null,
  };
}

export function encartAujourdhui(vue) {
  const total = (bloc) => bloc.lignes.length + bloc.plus;
  const journee = vue.rendezVous.journee;
  const journees = journee ? journee.evenements.length + journee.plus : 0;
  const sujets = [
    { icone: 'i-cal', nombre: total(vue.rendezVous) + journees, noms: ['rendez-vous', 'rendez-vous'] },
    { icone: 'i-note', nombre: total(vue.rappels), noms: ['rappel', 'rappels'] },
    { icone: 'i-alert', nombre: total(vue.alertes), noms: ['alerte', 'alertes'] },
  ].filter((sujet) => sujet.nombre > 0);
  const detail = sujets.map((s) => `${s.nombre}${ESP}${s.noms[s.nombre > 1 ? 1 : 0]}`);
  return {
    badges: sujets.map((s) => ({ icone: s.icone, nombre: s.nombre, alerte: s.icone === 'i-alert' })),
    etiquette: `Aujourd'hui${ESP}: ${detail.length > 0 ? detail.join(', ') : 'rien de prévu'}`,
  };
}
