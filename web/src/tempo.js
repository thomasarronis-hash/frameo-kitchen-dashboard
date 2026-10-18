// web/src/tempo.js
//
// Rôle    : les règles EDF Tempo de la page, sans DOM (testées) : le jour Tempo en cours (de 6 h à 6 h), la couleur
//           d'une date, la veille d'un jour rouge ou blanc (dès la pré-annonce, choix de Thomas), les heures creuses
//           (22 h à 6 h), le liseré d'un jour rouge (6 h à 22 h), la période où Tempo se montre sur l'Accueil, et ce que
//           montrent la pastille de « La semaine », la case de la barre du bas de l'Accueil, l'alerte et l'entrée de la
//           page Aujourd'hui et la fiche.
// Entrées : la valeur tempo du flux (serveur/sources/tempo.js : { jours: [{ date, couleur, statut }], restants, saison,
//           source, lu_le }, ou null avant la première lecture) ; ms, l'heure corrigée par le serveur.
// Sorties : jourTempo(ms) « 2026-10-14 » ; tempoSurAccueil(ms) -> vrai du 1er novembre au 31 mars (jour Tempo) ;
//           vueTempo(tempo, ms) -> { aujourdhui, demain ({ date, couleur, statut }, couleur null et statut inconnu quand
//           elle n'est pas connue), veille (rouge, blanc ou null), creuses, liseret (jour rouge, 6 h à 22 h, dans la
//           période de l'Accueil), accueil (tempoSurAccueil), restants, source, luLe } ;
//           pastilleDuJour(tempo, date) -> { couleur (ou null : « ? » gris), provisoire, etiquette } ;
//           caseTempo(vue) -> null (hors période de l'Accueil, ou pas de veille) ou { couleur (rouge ou blanc), creuses,
//           nom, detail } ;
//           alerteTempo(vue) -> null ou { icone, titre, valeur } (bande Alertes de la page Aujourd'hui) ;
//           ficheTempo(vue) -> { jours: [{ nom, couleur, texte, note (« pré-annonce » ou null), provisoire }],
//           restants: [{ couleur, nombre }] ou null, finRouge (texte ou null), credit }.
// Pièges  :
//   - Jour Tempo de 6 h à 6 h : de minuit à 6 h, « aujourd'hui » est encore la veille (et son tarif court jusqu'à
//     6 h). La pastille de « La semaine », elle, suit la date de la ligne : la couleur du jour qui commence ce
//     matin-là à 6 h.
//   - Veille d'un rouge ou d'un blanc : dès que la couleur de demain est connue, même pré-annoncée (choix de Thomas du
//     14/10) ; de 22 h à 6 h, ce sont déjà les heures creuses de la veille, d'où « Heures creuses, les machines ! »
//     (l'écran passe en nuit à 20 h 30, et la nuit n'affiche que l'heure).
//   - Pré-annonce : statut « provisoire » (lue la veille avant 10 h 40, serveur) : pastille cerclée de pointillés, et
//     « pré-annonce » en petit sous la couleur dans la fiche. La couleur peut encore changer jusque vers midi : la page
//     suit le flux.
//   - Aucune couleur inventée : inconnue, la pastille est grise avec « ? », la case et l'alerte n'existent pas.
//   - Sur l'Accueil, Tempo n'apparaît que du 1er novembre au 31 mars (décision de Thomas du 14/10) : pastilles de « La
//     semaine », case de la veille d'un rouge ou d'un blanc, liseré d'un jour rouge. Bornes jugées sur le jour Tempo
//     (de 6 h à 6 h, comme le reste). Hors période, l'alerte « Demain blanc » de la page Aujourd'hui reste (un blanc
//     tombe aussi en octobre ou en avril), et la fiche s'ouvre toute l'année depuis l'entrée Tempo de cette page.

import {
  ajouterJours, dateParis, partiesParis, texteHeure, texteJourMois,
} from './heure.js';

const HEURE_CHANGEMENT = 6;
const HEURE_CREUSES = 22;
const NOMS = { bleu: 'Bleu', blanc: 'Blanc', rouge: 'Rouge' };
const MOIS_ACCUEIL = [11, 12, 1, 2, 3];
const SOURCES = { rte: 'Source : RTE', 'api-couleur-tempo': 'Source : api-couleur-tempo.fr (données RTE)' };

export function jourTempo(ms) {
  const date = dateParis(ms);
  return partiesParis(ms).heure < HEURE_CHANGEMENT ? ajouterJours(date, -1) : date;
}

export const tempoSurAccueil = (ms) => MOIS_ACCUEIL.indexOf(Number(jourTempo(ms).slice(5, 7))) !== -1;

function jourDe(tempo, date) {
  const trouve = tempo ? tempo.jours.filter((jour) => jour.date === date)[0] : undefined;
  return trouve ? { date, couleur: trouve.couleur, statut: trouve.statut } : { date, couleur: null, statut: 'inconnu' };
}

export function vueTempo(tempo, ms) {
  const enCours = jourTempo(ms);
  const heure = partiesParis(ms).heure;
  const aujourdhui = jourDe(tempo, enCours);
  const demain = jourDe(tempo, ajouterJours(enCours, 1));
  const creuses = heure >= HEURE_CREUSES || heure < HEURE_CHANGEMENT;
  const accueil = tempoSurAccueil(ms);
  return {
    aujourdhui,
    demain,
    veille: demain.couleur === 'rouge' || demain.couleur === 'blanc' ? demain.couleur : null,
    creuses,
    liseret: accueil && aujourdhui.couleur === 'rouge' && !creuses,
    accueil,
    restants: tempo ? tempo.restants : null,
    source: tempo ? tempo.source : null,
    luLe: tempo && tempo.lu_le ? Date.parse(tempo.lu_le) : null,
  };
}

export function pastilleDuJour(tempo, date) {
  const jour = jourDe(tempo, date);
  if (!jour.couleur) return { couleur: null, provisoire: false, etiquette: 'Tempo : pas encore connu' };
  const provisoire = jour.statut === 'provisoire';
  return { couleur: jour.couleur, provisoire, etiquette: `Tempo : ${jour.couleur}${provisoire ? ', pré-annonce' : ''}` };
}

export function caseTempo(vue) {
  if (!vue.accueil || !vue.veille) return null;
  if (vue.creuses) return { couleur: vue.veille, creuses: true, nom: 'Heures creuses,', detail: 'les machines !' };
  return { couleur: vue.veille, creuses: false, nom: `Demain ${vue.veille}`, detail: null };
}

export function alerteTempo(vue) {
  if (!vue.veille) return null;
  return { icone: 'i-eclair', titre: `Demain ${vue.veille}`, valeur: vue.creuses ? 'lancer les machines' : 'machines après 22 h' };
}

function ligneFiche(nom, jour) {
  const provisoire = jour.statut === 'provisoire';
  return {
    nom, couleur: jour.couleur, texte: jour.couleur ? NOMS[jour.couleur] : 'Pas encore connu', note: provisoire ? 'pré-annonce' : null, provisoire,
  };
}

function credit(vue) {
  if (SOURCES[vue.source]) return SOURCES[vue.source];
  if (vue.luLe === null) return 'Pas encore lu';
  return `Dernière lecture : ${texteJourMois(dateParis(vue.luLe))} à ${texteHeure(vue.luLe)}`;
}

export function ficheTempo(vue) {
  return {
    jours: [ligneFiche('Aujourd\'hui', vue.aujourdhui), ligneFiche('Demain', vue.demain)],
    restants: vue.restants ? ['rouge', 'blanc', 'bleu'].map((couleur) => ({ couleur, nombre: vue.restants[couleur] })) : null,
    finRouge: vue.liseret ? 'Jour rouge jusqu\'à 22 h' : null,
    credit: credit(vue),
  };
}
