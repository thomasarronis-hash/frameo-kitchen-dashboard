// web/src/ecrans/enfants-donnees.js
//
// Rôle    : les règles communes du tableau des enfants côté page (choix de Thomas du 14/10, partie 4), sans DOM : trouver un
//           enfant, savoir si sa routine du matin est finie, les visages (avatar dessiné, couleur, étoile dorée) de l'écran
//           d'entrée et de la case du matin de l'Accueil, la pastille du minuteur d'écran sur les autres écrans, et le repérage
//           de la fin de ce minuteur (message « Fin de la vidéo, puis on éteint »).
// Entrées : la valeur enfants du flux (serveur/enfants/projection.js : { journee, depart, minutes_perdues, enfants: [...],
//           boutique, motifs }, ou null avant le premier instantané) ; ms, l'heure corrigée par le serveur.
// Sorties : trouverEnfant(enfants, id) -> l'enfant ou null ; routineFinie(enfant) ; visage(enfant) -> { id, prenom, avatar,
//           couleur, fini } ; caseAccueil(enfants, ms) -> null ou { visages } (de 5 h à fin_routine du barème, 9 h) ; vueEntree(enfants) -> { etat:
//           « attente » | « ok », visages } ; restantMinuteurS(minuteur, ms) ; texteMinutes(secondes) -> { nombre, unite } ;
//           vuePastilleEcran(enfants, ms) -> null ou { id, prenom, avatar, couleur, nombre, unite } ; minuteurEcranEnCours(enfants,
//           ms) ; creerVeilleFin() -> { observer(enfants, ms) -> null ou { id, prenom, avatar, couleur, cle, sonner }, fermer(cle) }.
// Pièges  :
//   - Pas de comparaison entre frères (choix de Thomas) : un visage ne porte qu'une étoile dorée quand SA routine est finie,
//     jamais un chiffre ni une progression ; l'écran ne montre jamais les deux tableaux côte à côte.
//   - Routine finie : toutes les étapes VALIDÉES (une étape en attente d'un parent ne compte pas, comme côté serveur).
//   - Case du matin de l'Accueil : de 5 h à 10 h 29, le créneau du matin des propositions ; elle prend la place de la case
//     Wi-Fi invités ou Tempo (accueil.js) et s'efface à la fin de la routine (fin_routine du barème, 9 h depuis le choix de Thomas du 14/10).
//   - Décomptes en heure CORRIGÉE de la page (la valeur du flux n'en contient aucun, projection.js) : restant = fin - ms,
//     arrondi à la seconde du dessus, jamais négatif. Minutes « à la Time Timer » : arrondies au-dessus (2 min 10 s se lit
//     « 3 min » restantes), en secondes dans la dernière minute.
//   - Fin du minuteur : repérée dès que l'heure de la page passe la fin (sans attendre la maj du serveur), ou sur un état
//     « termine » reçu ; montrée une fois par fin (clé = heure de fin), 2 min au plus ; le son ne part que si la fin est
//     toute fraîche (moins de 30 s : pas de son pour une fin relue après un rechargement).

import { partiesParis } from '../heure.js';

const HEURE_CASE = 5 * 60;
const FIN_AFFICHEE_MS = 120000;
const FIN_SONORE_MS = 30000;

export function trouverEnfant(enfants, id) {
  if (!enfants || !Array.isArray(enfants.enfants)) return null;
  for (let i = 0; i < enfants.enfants.length; i += 1) if (enfants.enfants[i].id === id) return enfants.enfants[i];
  return null;
}

export const routineFinie = (enfant) => enfant.etapes.length > 0 && enfant.etapes.every((etape) => etape.statut === 'valide');

export function visage(enfant) {
  return {
    id: enfant.id, prenom: enfant.prenom, avatar: enfant.avatar, couleur: enfant.couleur, fini: routineFinie(enfant),
  };
}

const visages = (enfants) => (enfants && Array.isArray(enfants.enfants) ? enfants.enfants.map(visage) : []);

// Fin de la case du matin = fin_routine du barème (« HH:MM »), envoyée par le serveur avec l'état des enfants.
function finCase(enfants) {
  const m = /^(\d{2}):(\d{2})$/.exec((enfants && enfants.fin_routine) || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function caseAccueil(enfants, ms) {
  const p = partiesParis(ms);
  const minutes = p.heure * 60 + p.minute;
  const liste = visages(enfants);
  const fin = finCase(enfants);
  if (fin === null || minutes < HEURE_CASE || minutes >= fin || liste.length === 0) return null;
  return { visages: liste };
}

export function vueEntree(enfants) {
  const liste = visages(enfants);
  return { etat: liste.length === 0 ? 'attente' : 'ok', visages: liste };
}

export function restantMinuteurS(minuteur, ms) {
  if (!minuteur || minuteur.etat !== 'en_cours') return 0;
  return Math.max(0, Math.ceil((Date.parse(minuteur.fin) - ms) / 1000));
}

export function texteMinutes(secondes) {
  if (secondes >= 60) return { nombre: String(Math.ceil(secondes / 60)), unite: 'min' };
  return { nombre: String(Math.max(0, secondes)), unite: 's' };
}

function enCours(enfant, ms) {
  return Boolean(enfant.minuteur) && enfant.minuteur.etat === 'en_cours' && restantMinuteurS(enfant.minuteur, ms) > 0;
}

export function vuePastilleEcran(enfants, ms) {
  const liste = enfants && Array.isArray(enfants.enfants) ? enfants.enfants : [];
  for (let i = 0; i < liste.length; i += 1) {
    const enfant = liste[i];
    if (enCours(enfant, ms)) {
      const texte = texteMinutes(restantMinuteurS(enfant.minuteur, ms));
      return {
        id: enfant.id, prenom: enfant.prenom, avatar: enfant.avatar, couleur: enfant.couleur, nombre: texte.nombre, unite: texte.unite,
      };
    }
  }
  return null;
}

export const minuteurEcranEnCours = (enfants, ms) => vuePastilleEcran(enfants, ms) !== null;

// Instant de fin du minuteur d'un enfant, s'il vient de finir (en cours dont la fin est passée, ou terminé), sinon null.
function finDe(enfant, ms) {
  const minuteur = enfant.minuteur;
  if (!minuteur) return null;
  if (minuteur.etat === 'en_cours') {
    const fin = Date.parse(minuteur.fin);
    return ms >= fin ? fin : null;
  }
  return minuteur.etat === 'termine' ? Date.parse(minuteur.fin_le) : null;
}

export function creerVeilleFin() {
  const fermees = {};
  return {
    observer(enfants, ms) {
      const liste = enfants && Array.isArray(enfants.enfants) ? enfants.enfants : [];
      for (let i = 0; i < liste.length; i += 1) {
        const enfant = liste[i];
        const fin = finDe(enfant, ms);
        const cle = `${enfant.id}@${fin}`;
        if (fin !== null && isFinite(fin) && ms - fin < FIN_AFFICHEE_MS && !fermees[cle]) {
          return {
            id: enfant.id, prenom: enfant.prenom, avatar: enfant.avatar, couleur: enfant.couleur, cle, sonner: ms - fin < FIN_SONORE_MS,
          };
        }
      }
      return null;
    },
    fermer(cle) {
      fermees[cle] = true;
    },
  };
}
