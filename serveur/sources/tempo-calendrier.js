// serveur/sources/tempo-calendrier.js
//
// Rôle    : les règles fixes d'EDF Tempo, sans réseau ni fichier (testées seules) : le jour Tempo (de 6 h à 6 h), la
//           saison (du 1er septembre au 31 août), les couleurs impossibles (filet local qui rejette une donnée absurde),
//           le statut pré-annoncé ou confirmé d'une couleur, les jours restants d'une saison et le rythme de lecture.
// Entrées : instants (millisecondes) et dates « AAAA-MM-JJ », couleurs en français (bleu, blanc, rouge).
// Sorties : jourTempo(instant) ; saisonDe(date) « 2026-2027 » ; joursDeSaison(saison) { rouge, blanc, bleu } ;
//           couleurPlausible(date, couleur) ; statutCouleur(date, luLe) 'provisoire' ou 'confirme' ;
//           compterRestants(couleurs, saison) -> { rouge, blanc, bleu } ; joursPublies(saison, enCours) -> nombre de jours
//           de la saison déjà publiés (du 1er septembre au jour en cours) ; prochaineLecture(instant, demainConnu) -> instant.
// Pièges  :
//   - Jour Tempo de 6 h à 6 h (Selectra, RTE) : entre minuit et 6 h, le jour en cours est encore celui de la veille.
//   - Saison prise d'après la date de DEMAIN (comme rte-tempo) : le 31 août, demain est déjà dans la saison suivante,
//     c'est elle qu'il faut lire pour avoir la couleur du 1er septembre.
//   - Règles fixes (Selectra, recoupées avec la saison 2025-2026 lue chez RTE) : le dimanche est toujours bleu ; un
//     rouge ne tombe jamais un samedi, un dimanche, un jour férié, ni d'avril à octobre. Seuls les fériés de novembre à
//     mars comptent pour le rouge : 1er et 11 novembre, 25 décembre, 1er janvier, et le lundi de Pâques quand il tombe
//     en mars (Ascension et Pentecôte sont toujours après le 30 avril). Une couleur qui les viole est rejetée.
//   - Pré-annonce ou confirmation : la donnée de RTE ne le dit pas (sa clé « -fallback » signale un mode dégradé chez
//     RTE, sens non documenté, journalisé par tempo.js). Seule l'heure de lecture le permet : RTE publie la couleur
//     engageante du lendemain à 10 h 30, une pré-annonce purement informative peut paraître avant (dès 7 h 31 le
//     14/10) et la couleur peut encore changer jusque vers midi. Une couleur lue à partir de 10 h 40 la veille (heure
//     conseillée par RTE pour sa propre API) est dite confirmée, avant, provisoire.
//   - Jours restants : 22 rouges, 43 blancs, 300 bleus par saison (301 si elle a un 29 février). Convention : demain
//     compte dès que sa couleur est connue (ce qui reste vraiment à tirer) ; /api/stats de api-couleur-tempo.fr ne le
//     compte pas, tempo.js corrige.
//   - Rythme (propositions §2, une vingtaine de lectures par jour) : 6 h 05, puis toutes les 30 min tant que demain
//     n'est pas connu (jusqu'à 23 h 35) ; 10 h 45, 11 h 15 et 12 h 30 quoi qu'il arrive (confirmation, changement
//     tardif).

import {
  ajouterJours, instantParis, jourSemaine, partiesParis,
} from '../heure-paris.js';

const HEURE_CHANGEMENT = 6;
const HEURE_CONFIRMATION = { heure: 10, minute: 40 };
const ROUGES = 22;
const BLANCS = 43;
const BLEUS = 300;
const FERIES_HIVER = new Set(['11-01', '11-11', '12-25', '01-01']);
const MOIS_SANS_ROUGE = new Set([4, 5, 6, 7, 8, 9, 10]);
const LECTURES_FIXES = [[6, 5], [10, 45], [11, 15], [12, 30]];
const PREMIERE_LECTURE = [6, 5];
const DERNIERE_RELANCE = [23, 35];
const PAS_RELANCE_MIN = 30;

const enMinutes = ([heure, minute]) => heure * 60 + minute;

export function jourTempo(instant) {
  const { date, heure } = partiesParis(instant);
  return heure < HEURE_CHANGEMENT ? ajouterJours(date, -1) : date;
}

export function saisonDe(date) {
  const annee = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 9 ? `${annee}-${annee + 1}` : `${annee - 1}-${annee}`;
}

const bissextile = (annee) => (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;

export function joursDeSaison(saison) {
  return { rouge: ROUGES, blanc: BLANCS, bleu: BLEUS + (bissextile(Number(saison.slice(5))) ? 1 : 0) };
}

// Lundi de Pâques (calendrier grégorien, algorithme anonyme dit de Meeus, Jones et Butcher).
function lundiDePaques(annee) {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - Math.floor(b / 4) - g + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  const paques = `${annee}-${String(Math.floor(n / 31)).padStart(2, '0')}-${String((n % 31) + 1).padStart(2, '0')}`;
  return ajouterJours(paques, 1);
}

function rougeImpossible(date) {
  const jour = jourSemaine(date);
  return jour === 0 || jour === 6 || MOIS_SANS_ROUGE.has(Number(date.slice(5, 7))) || FERIES_HIVER.has(date.slice(5))
    || date === lundiDePaques(Number(date.slice(0, 4)));
}

export function couleurPlausible(date, couleur) {
  if (jourSemaine(date) === 0) return couleur === 'bleu';
  return couleur !== 'rouge' || !rougeImpossible(date);
}

export function statutCouleur(date, luLe) {
  const veille = ajouterJours(date, -1);
  const lu = partiesParis(luLe);
  if (lu.date !== veille) return lu.date > veille ? 'confirme' : 'provisoire';
  return enMinutes([lu.heure, lu.minute]) >= enMinutes([HEURE_CONFIRMATION.heure, HEURE_CONFIRMATION.minute]) ? 'confirme' : 'provisoire';
}

// couleurs : [[date, couleur]] d'une saison (déjà plausibles) ; seules les dates de la saison comptent.
export function compterRestants(couleurs, saison) {
  const debut = `${saison.slice(0, 4)}-09-01`;
  const fin = `${saison.slice(5)}-08-31`;
  const restants = joursDeSaison(saison);
  for (const [date, couleur] of couleurs) {
    if (date >= debut && date <= fin) restants[couleur] -= 1;
  }
  for (const couleur of Object.keys(restants)) restants[couleur] = Math.max(0, restants[couleur]);
  return restants;
}

// Jours de la saison dont la couleur est forcément publiée quand le jour Tempo en cours est enCours : du 1er septembre
// à enCours compris (0 avant le début de la saison, le 31 août pour la saison de demain).
export function joursPublies(saison, enCours) {
  const debut = Date.parse(`${saison.slice(0, 4)}-09-01T00:00:00Z`);
  const jours = Math.round((Date.parse(`${enCours}T00:00:00Z`) - debut) / 86_400_000) + 1;
  return Math.max(0, jours);
}

function lecturesDuJour(demainConnu) {
  const minutes = LECTURES_FIXES.map(enMinutes);
  if (!demainConnu) {
    for (let m = enMinutes(PREMIERE_LECTURE); m <= enMinutes(DERNIERE_RELANCE); m += PAS_RELANCE_MIN) minutes.push(m);
  }
  return [...new Set(minutes)].sort((x, y) => x - y);
}

export function prochaineLecture(instant, demainConnu) {
  const aujourdhui = partiesParis(instant).date;
  const suivante = lecturesDuJour(demainConnu)
    .map((minutes) => instantParis(aujourdhui, Math.floor(minutes / 60), minutes % 60))
    .find((quand) => quand > instant);
  return suivante !== undefined ? suivante : instantParis(ajouterJours(aujourdhui, 1), ...PREMIERE_LECTURE);
}
