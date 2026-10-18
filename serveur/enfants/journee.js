// serveur/enfants/journee.js
//
// Rôle    : les règles d'une journée du tableau des enfants, sans fichier ni horloge propre : cocher une étape, l'annuler
//           dans les 5 s, valider ou refuser une étape en attente, compter les minutes (Timo) ou les étoiles (Pablo), et le
//           minuteur d'écran de Timo (démarrer, pause, finir, fin toute seule). Choix de Thomas du 14/10.
// Entrées : la journée telle que stockée (stockage.js), le barème (bareme.js), l'instant en millisecondes (maintenant).
// Sorties : journeeDe(instant) « AAAA-MM-JJ » (journée de 4 h à 4 h, heure de Paris) ; debutJournee(journee) et
//           instantDansJournee(journee, « HH:MM ») -> millisecondes ; instantPerte(journee, bareme) ;
//           instantFinRoutine(journee, bareme) ; journeeVide(journee,
//           bareme) ; completerJournee(jour, bareme) ; cocher, annuler (parent : sans délai), decider, piloterMinuteur -> { jour (copie modifiée),
//           resultat } ou lèvent une ErreurEnfants ; finaliserMinuteurs(jour, maintenant) -> la journée (copie si un minuteur
//           a fini, sinon la même) ; disponiblesS(enfant, etat, journee, bareme, maintenant) ; prochainEvenement(jour,
//           bareme, maintenant) -> l'instant du prochain changement sans action (fin d'un minuteur, fin de la routine,
//           minutes perdues, journée suivante) ; DELAI_ANNULATION_MS (5 s ; le serveur accepte 1 s de plus, MARGE_RESEAU_MS, pour le trajet).
//           Journée stockée : { version: 1, journee, enfants: { <id>: { etapes: { <id étape>: { statut: « valide » |
//           « attente », par: « enfant » | « parent », coche_le, valide_le (ISO ou null), valeur } }, gagnees, et pour un
//           enfant à minutes : utilisees_s, minuteur: null | { etat: « en_cours », debut, duree_s } | { etat: « pause » } |
//           { etat: « termine », fin_le } } } }.
// Pièges  :
//   - On ne retire jamais de minutes par punition : aucune règle n'enlève une étape validée, sauf l'annulation des 5 s (un
//     doigt qui a glissé) et la CORRECTION d'un parent en mode parent (annuler avec parent, sans délai : « un parent
//     corrige si besoin », choix de Thomas, pour une étape cochée par erreur) ; refuser ne touche qu'une étape « en
//     attente », qui ne rapportait rien. Gagnées = somme des étapes validées, bornée au plafond (32 pour Timo) : une étape
//     ne compte qu'une fois (deja_cochee). Une correction ne rend jamais les minutes utilisées négatives (disponiblesS
//     borné à 0).
//   - Étape « parent » cochée par l'enfant : « en attente », rien ne compte avant la validation (mode parent). Cochée en
//     mode parent : validée tout de suite. Toujours permise par le barème, plus utilisée par celui de Thomas depuis le
//     14/10 en fin d'après-midi : « Levé » et « N'excite pas Pablo » passent en confiance, comptés dès que Timo coche.
//     « Levé » (apres 06:30) reste refusé avant 6 h 30 à l'heure du serveur (trop_tot), même en mode parent.
//   - Routine du MATIN (choix de Thomas : « barème du matin ») : à partir de fin_routine (9 h), un enfant ne coche
//     plus (routine_finie) ; sans cela, les minutes se gagnaient l'après-midi et se regardaient avant 20 h. Un parent
//     coche, valide ou corrige encore (mode parent).
//   - Annuler sans jeton (les 5 s) seulement une coche de l'ENFANT : une étape cochée par un parent ne se défait qu'en
//     mode parent (mode_parent_requis), sinon Timo pourrait défaire juste après la fermeture ce que le parent a noté.
//   - La valeur de l'étape est recopiée au moment de la coche, et gagnees est écrit dans le fichier : l'historique garde
//     ce qui a vraiment été gagné même si le barème change ensuite. Les étapes qui ne sont plus au barème ne comptent plus.
//   - Minuteur : jamais au-delà des minutes gagnées non utilisées, ni au-delà de l'heure des minutes perdues (20 h) ; il
//     ne peut donc jamais traverser la nuit. Sa durée est recalculée à chaque changement des minutes gagnées (une étape
//     validée pendant qu'il tourne l'allonge, une annulation le raccourcit). Le temps est compté en secondes entières.
//   - Journée de 4 h à 4 h, heure de Paris (heure-paris.js) : un changement d'heure se fait entre 2 h et 3 h, donc avant
//     la bascule ; la journée qui le contient dure 25 h (fin octobre) ou 23 h (fin mars).

import { ajouterJours, instantParis, partiesParis } from '../heure-paris.js';
import {
  HEURE_DEBUT_JOURNEE, minutesDe, trouverEnfant, trouverEtape,
} from './bareme.js';
import { ErreurEnfants } from './erreur.js';

export const DELAI_ANNULATION_MS = 5_000;
const MARGE_RESEAU_MS = 1_000;

const iso = (ms) => new Date(ms).toISOString();

export function journeeDe(instant) {
  const { date, heure } = partiesParis(instant);
  return heure < HEURE_DEBUT_JOURNEE ? ajouterJours(date, -1) : date;
}

export function instantDansJournee(journee, heure) {
  const minutes = minutesDe(heure);
  return instantParis(journee, Math.floor(minutes / 60), minutes % 60);
}

export const debutJournee = (journee) => instantParis(journee, HEURE_DEBUT_JOURNEE, 0);
export const instantPerte = (journee, bareme) => instantDansJournee(journee, bareme.minutes_perdues);
export const instantFinRoutine = (journee, bareme) => instantDansJournee(journee, bareme.fin_routine);

const etatVide = (enfant) => (enfant.type === 'minutes'
  ? { etapes: {}, gagnees: 0, utilisees_s: 0, minuteur: null }
  : { etapes: {}, gagnees: 0 });

export function journeeVide(journee, bareme) {
  return { version: 1, journee, enfants: Object.fromEntries(bareme.enfants.map((enfant) => [enfant.id, etatVide(enfant)])) };
}

// Un enfant ajouté au barème depuis l'écriture du fichier repart de zéro ; les autres entrées restent telles quelles.
export function completerJournee(jour, bareme) {
  const manquants = bareme.enfants.filter((enfant) => !jour.enfants[enfant.id]);
  if (manquants.length === 0) return jour;
  return { ...jour, enfants: { ...jour.enfants, ...Object.fromEntries(manquants.map((enfant) => [enfant.id, etatVide(enfant)])) } };
}

function compterGagnees(enfant, etat) {
  const somme = enfant.etapes
    .map((etape) => etat.etapes[etape.id])
    .filter((entree) => entree && entree.statut === 'valide')
    .reduce((total, entree) => total + entree.valeur, 0);
  return enfant.type === 'minutes' ? Math.min(enfant.plafond, somme) : somme;
}

const ecouleS = (minuteur, maintenant) => Math.min(minuteur.duree_s, Math.max(0, Math.floor((maintenant - Date.parse(minuteur.debut)) / 1000)));

function finaliser(etat, maintenant) {
  const { minuteur } = etat;
  if (!minuteur || minuteur.etat !== 'en_cours') return false;
  const fin = Date.parse(minuteur.debut) + minuteur.duree_s * 1000;
  if (maintenant < fin) return false;
  etat.utilisees_s += minuteur.duree_s;
  etat.minuteur = { etat: 'termine', fin_le: iso(fin) };
  return true;
}

// Après tout changement des étapes : minutes ou étoiles recomptées, minuteur en cours borné aux minutes restantes.
function recalculer(enfant, etat, journee, bareme, maintenant) {
  etat.gagnees = compterGagnees(enfant, etat);
  if (etat.minuteur && etat.minuteur.etat === 'en_cours') {
    const debut = Date.parse(etat.minuteur.debut);
    const credit = etat.gagnees * 60 - etat.utilisees_s;
    const avantPerte = Math.floor((instantPerte(journee, bareme) - debut) / 1000);
    etat.minuteur.duree_s = Math.max(0, Math.min(credit, avantPerte));
    finaliser(etat, maintenant);
  }
}

function contexte(jour, bareme, idEnfant, idEtape) {
  const enfant = trouverEnfant(bareme, idEnfant);
  if (!enfant) throw new ErreurEnfants('enfant_inconnu', 404);
  const etape = idEtape === undefined ? null : trouverEtape(enfant, idEtape);
  if (idEtape !== undefined && !etape) throw new ErreurEnfants('etape_inconnue', 404);
  const copie = structuredClone(jour);
  return {
    enfant, etape, copie, etat: copie.enfants[enfant.id],
  };
}

const annulableJusqua = (entree) => iso(Date.parse(entree.coche_le) + DELAI_ANNULATION_MS);

export function cocher(jour, bareme, {
  enfant: idEnfant, etape: idEtape, parent, maintenant,
}) {
  const {
    enfant, etape, copie, etat,
  } = contexte(jour, bareme, idEnfant, idEtape);
  if (etat.etapes[etape.id]) throw new ErreurEnfants('deja_cochee', 409);
  if (etape.apres && maintenant < instantDansJournee(jour.journee, etape.apres)) throw new ErreurEnfants('trop_tot', 409);
  if (!parent && maintenant >= instantFinRoutine(jour.journee, bareme)) throw new ErreurEnfants('routine_finie', 409);
  const statut = parent || etape.validation === 'enfant' ? 'valide' : 'attente';
  const entree = {
    statut, par: parent ? 'parent' : 'enfant', coche_le: iso(maintenant), valide_le: statut === 'valide' ? iso(maintenant) : null, valeur: etape.valeur,
  };
  etat.etapes[etape.id] = entree;
  recalculer(enfant, etat, jour.journee, bareme, maintenant);
  return {
    jour: copie,
    resultat: {
      enfant: enfant.id, etape: etape.id, statut, par: entree.par, annulable_jusqu_a: annulableJusqua(entree),
    },
  };
}

export function annuler(jour, bareme, {
  enfant: idEnfant, etape: idEtape, parent = false, maintenant,
}) {
  const {
    enfant, etape, copie, etat,
  } = contexte(jour, bareme, idEnfant, idEtape);
  const entree = etat.etapes[etape.id];
  if (!entree) throw new ErreurEnfants('pas_cochee', 404);
  if (!parent && entree.par === 'parent') throw new ErreurEnfants('mode_parent_requis', 403);
  const tardive = maintenant - Date.parse(entree.coche_le) > DELAI_ANNULATION_MS + MARGE_RESEAU_MS;
  if (tardive && !parent) throw new ErreurEnfants('trop_tard', 409);
  delete etat.etapes[etape.id];
  recalculer(enfant, etat, jour.journee, bareme, maintenant);
  return { jour: copie, resultat: { enfant: enfant.id, etape: etape.id, statut: 'a_faire' } };
}

export function decider(jour, bareme, {
  enfant: idEnfant, etape: idEtape, decision, maintenant,
}) {
  const {
    enfant, etape, copie, etat,
  } = contexte(jour, bareme, idEnfant, idEtape);
  const entree = etat.etapes[etape.id];
  if (!entree || entree.statut !== 'attente') throw new ErreurEnfants('pas_en_attente', 409);
  if (decision === 'valider') {
    entree.statut = 'valide';
    entree.valide_le = iso(maintenant);
  } else {
    delete etat.etapes[etape.id];
  }
  recalculer(enfant, etat, jour.journee, bareme, maintenant);
  return { jour: copie, resultat: { enfant: enfant.id, etape: etape.id, statut: decision === 'valider' ? 'valide' : 'a_faire' } };
}

// Minutes gagnées pas encore consommées par un segment fini du minuteur ; 0 après l'heure des minutes perdues.
export function disponiblesS(enfant, etat, journee, bareme, maintenant) {
  if (enfant.type !== 'minutes' || maintenant >= instantPerte(journee, bareme)) return 0;
  return Math.max(0, etat.gagnees * 60 - etat.utilisees_s);
}

export function piloterMinuteur(jour, bareme, { enfant: idEnfant, action, maintenant }) {
  const { enfant, copie, etat } = contexte(jour, bareme, idEnfant);
  if (enfant.type !== 'minutes') throw new ErreurEnfants('sans_minutes', 404);
  finaliser(etat, maintenant);
  const { minuteur } = etat;
  if (action === 'demarrer') {
    if (minuteur && minuteur.etat === 'en_cours') throw new ErreurEnfants('deja_en_cours', 409);
    const avantPerteS = Math.floor((instantPerte(jour.journee, bareme) - maintenant) / 1000);
    if (avantPerteS <= 0) throw new ErreurEnfants('minutes_perdues', 409);
    const credit = disponiblesS(enfant, etat, jour.journee, bareme, maintenant);
    if (credit <= 0) throw new ErreurEnfants('aucune_minute', 409);
    etat.minuteur = { etat: 'en_cours', debut: iso(maintenant), duree_s: Math.min(credit, avantPerteS) };
  } else if (action === 'pause') {
    if (!minuteur || minuteur.etat !== 'en_cours') throw new ErreurEnfants('pas_en_cours', 409);
    etat.utilisees_s += ecouleS(minuteur, maintenant);
    etat.minuteur = { etat: 'pause' };
  } else {
    if (!minuteur) throw new ErreurEnfants('aucun_minuteur', 409);
    if (minuteur.etat === 'en_cours') etat.utilisees_s += ecouleS(minuteur, maintenant);
    etat.minuteur = null;
  }
  return {
    jour: copie,
    resultat: { enfant: enfant.id, minuteur: etat.minuteur, disponibles_s: disponiblesS(enfant, etat, jour.journee, bareme, maintenant) },
  };
}

export function finaliserMinuteurs(jour, maintenant) {
  const fini = Object.values(jour.enfants).some((etat) => etat.minuteur && etat.minuteur.etat === 'en_cours'
    && maintenant >= Date.parse(etat.minuteur.debut) + etat.minuteur.duree_s * 1000);
  if (!fini) return jour;
  const copie = structuredClone(jour);
  Object.values(copie.enfants).forEach((etat) => finaliser(etat, maintenant));
  return copie;
}

export function prochainEvenement(jour, bareme, maintenant) {
  const instants = [debutJournee(ajouterJours(jour.journee, 1)), instantFinRoutine(jour.journee, bareme), instantPerte(jour.journee, bareme)];
  Object.values(jour.enfants).forEach(({ minuteur }) => {
    if (minuteur && minuteur.etat === 'en_cours') instants.push(Date.parse(minuteur.debut) + minuteur.duree_s * 1000);
  });
  return Math.min(...instants.filter((instant) => instant > maintenant));
}
