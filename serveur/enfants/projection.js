// serveur/enfants/projection.js
//
// Rôle    : ce que la page reçoit du tableau des enfants : la valeur « enfants » du flux SSE (instantané et maj) et la
//           réponse de l'historique de 7 jours (mode parent). Le barème et l'état du jour fondus en un seul objet prêt à
//           dessiner.
// Entrées : projeter({ bareme, jour, registre, maintenant }) ; historique({ bareme, dates, jours, registre }) : dates des
//           7 journées dans l'ordre, jours = Map date -> journée stockée ou null.
// Sorties : projeter -> { journee, depart, fin_routine, routine_finie (vrai à partir de fin_routine : plus de coche par un
//           enfant), minutes_perdues, enfants: [{ id, prenom, couleur, avatar, type, etapes: [{ id, libelle,
//           picto, valeur, validation, apres, statut: « a_faire » | « attente » | « valide », par, coche_le,
//           annulable_jusqu_a }], gagnees, minutes: { plafond, utilisees_s, disponibles_s, perdues } | null, minuteur:
//           null | { etat: « en_cours », debut, duree_s, fin } | { etat: « pause » } | { etat: « termine », fin_le },
//           points: { solde, aujourdhui, libres_restants (points libres encore permis aujourd'hui : 0 grise le « +1 ») } |
//           null, gains: [{ motif (id ou null), le }] (les 5 derniers, du plus récent) | null,
//           demande: { id, cadeau, prix, le } | null, ensuite: { libelle, picto, debloque } | null }], boutique: [{ id,
//           libelle, picto, prix }], motifs: [{ id, libelle, picto }] } ;
//           historique -> { jours: [dates], enfants: [{ id, prenom, type, total, jours: [{ journee, faites, gagnees,
//           utilisees_s, points }] }] }.
// Pièges  :
//   - Tout le monde est dans la même valeur, mais la page n'en montre qu'un à la fois : jamais de chiffres côte à côte
//     (pas de comparaison entre frères, choix de Thomas). Même règle pour l'historique, réservé au mode parent.
//   - Aucune heure « maintenant » ni décompte dans la valeur (elle ne change qu'aux vrais changements, comme toute source) :
//     la page compte elle-même avec son heure corrigée (fin du minuteur, fenêtre d'annulation, heure du « Levé »).
//     Seuls routine_finie et perdues basculent à heure fixe, publiés par la source (sources/enfants.js).
//   - gagnees : minutes pour un enfant à minutes, étoiles pour un enfant à étoiles (type le dit). disponibles_s : minutes
//     gagnées pas encore utilisées, hors segment en cours du minuteur, 0 après l'heure des minutes perdues.
//   - ensuite.debloque : toutes les étapes faites (« D'abord, ensuite » de Pablo). Une étape en attente ne compte pas.
//   - gains : la liste « Bravo » de l'écran des points (motif ou « Bravo ! » si aucun), 5 au plus pour borner la valeur ;
//     seulement des identifiants et des heures, le libellé du motif vient de motifs.

import {
  DELAI_ANNULATION_MS, disponiblesS, instantFinRoutine, instantPerte,
} from './journee.js';
import {
  demandeDe, gainsRecents, libresRestants, pointsDuJour, solde,
} from './registre.js';

const iso = (ms) => new Date(ms).toISOString();
const GAINS_MONTRES = 5;

function projeterEtape(etape, entree) {
  return {
    id: etape.id,
    libelle: etape.libelle,
    picto: etape.picto,
    valeur: etape.valeur,
    validation: etape.validation,
    apres: etape.apres ?? null,
    statut: entree ? entree.statut : 'a_faire',
    par: entree ? entree.par : null,
    coche_le: entree ? entree.coche_le : null,
    annulable_jusqu_a: entree ? iso(Date.parse(entree.coche_le) + DELAI_ANNULATION_MS) : null,
  };
}

function projeterMinuteur(minuteur) {
  if (!minuteur) return null;
  if (minuteur.etat === 'en_cours') {
    return {
      etat: 'en_cours', debut: minuteur.debut, duree_s: minuteur.duree_s, fin: iso(Date.parse(minuteur.debut) + minuteur.duree_s * 1000),
    };
  }
  return { ...minuteur };
}

function projeterEnfant(enfant, etat, contexte) {
  const {
    bareme, journee, registre, maintenant,
  } = contexte;
  const etapes = enfant.etapes.map((etape) => projeterEtape(etape, etat.etapes[etape.id]));
  const aMinutes = enfant.type === 'minutes';
  const demande = enfant.points ? demandeDe(registre, enfant.id) : null;
  return {
    id: enfant.id,
    prenom: enfant.prenom,
    couleur: enfant.couleur,
    avatar: enfant.avatar,
    type: enfant.type,
    etapes,
    gagnees: etat.gagnees,
    minutes: aMinutes ? {
      plafond: enfant.plafond,
      utilisees_s: etat.utilisees_s,
      disponibles_s: disponiblesS(enfant, etat, journee, bareme, maintenant),
      perdues: maintenant >= instantPerte(journee, bareme),
    } : null,
    minuteur: aMinutes ? projeterMinuteur(etat.minuteur) : null,
    points: enfant.points ? {
      solde: solde(registre, enfant.id),
      aujourdhui: pointsDuJour(registre, enfant.id, journee),
      libres_restants: libresRestants(registre, bareme, enfant.id, journee),
    } : null,
    gains: enfant.points ? gainsRecents(registre, enfant.id, GAINS_MONTRES) : null,
    demande: demande && {
      id: demande.id, cadeau: demande.cadeau, prix: demande.prix, le: demande.le,
    },
    ensuite: enfant.ensuite ? {
      libelle: enfant.ensuite.libelle, picto: enfant.ensuite.picto, debloque: etapes.every((etape) => etape.statut === 'valide'),
    } : null,
  };
}

export function projeter({
  bareme, jour, registre, maintenant,
}) {
  const contexte = {
    bareme, journee: jour.journee, registre, maintenant,
  };
  return {
    journee: jour.journee,
    depart: bareme.depart,
    fin_routine: bareme.fin_routine,
    routine_finie: maintenant >= instantFinRoutine(jour.journee, bareme),
    minutes_perdues: bareme.minutes_perdues,
    enfants: bareme.enfants.map((enfant) => projeterEnfant(enfant, jour.enfants[enfant.id], contexte)),
    boutique: bareme.boutique.map(({
      id, libelle, picto, prix,
    }) => ({
      id, libelle, picto, prix,
    })),
    motifs: bareme.points.motifs.map(({ id, libelle, picto }) => ({ id, libelle, picto })),
  };
}

function resumeDuJour(enfant, etat, date, registre) {
  const faites = etat ? enfant.etapes.filter((etape) => etat.etapes[etape.id]?.statut === 'valide').length : 0;
  return {
    journee: date,
    faites,
    gagnees: etat ? etat.gagnees : 0,
    utilisees_s: enfant.type === 'minutes' ? (etat?.utilisees_s ?? 0) : null,
    points: enfant.points ? pointsDuJour(registre, enfant.id, date) : null,
  };
}

export function historique({
  bareme, dates, jours, registre,
}) {
  return {
    jours: dates,
    enfants: bareme.enfants.map((enfant) => ({
      id: enfant.id,
      prenom: enfant.prenom,
      type: enfant.type,
      total: enfant.etapes.length,
      jours: dates.map((date) => resumeDuJour(enfant, jours.get(date)?.enfants[enfant.id], date, registre)),
    })),
  };
}
