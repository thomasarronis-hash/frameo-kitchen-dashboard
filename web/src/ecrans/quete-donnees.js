// web/src/ecrans/quete-donnees.js
//
// Rôle    : la quête du matin de Timo (variante B « les quêtes », choix de Thomas du 14/10), sans DOM : les cases du chemin
//           (une par étape, pictogramme et « +5 »), la case où se tient son avatar, le coffre au bout, la barre discrète du
//           temps jusqu'au départ, la case qu'on peut encore annuler, et sa bourse de minutes qui devient le minuteur d'écran.
// Entrées : un enfant de la valeur enfants du flux (serveur/enfants/projection.js), la valeur entière (depart « 08:10 »,
//           routine_finie), ms (heure corrigée par le serveur).
// Sorties : vueQuete(enfant, enfants, ms) -> { cases: [{ id, libelle, picto, valeur (« +5 »), statut (« a_faire » |
//           « attente » | « valide »), parent (cadenas : un parent valide), tot (« 6 h 30 » tant qu'elle n'est pas permise, sinon
//           null), passee (vrai : à faire, mais la routine du matin est finie), enCours }], avatar (index de la case de
//           l'avatar ; cases.length = devant le coffre), coffre (ouvert : vrai quand tout est validé), temps (null ou
//           { fraction restante de 1 à 0, heure « 8 h 10 » }), annulation (null ou { id, picto, jusqua (ms) }) } ;
//           vueBourse(enfant, ms) -> { mode (« bourse » | « minuteur » | « pause » | « fin » | « perdues »), nombre, unite,
//           gagnees (texte « 18 gagnées » quand une partie est déjà regardée, sinon null), fraction (disque : ce qui reste sur
//           ce qui a été gagné), peutRegarder } ; FIN_MONTREE_MS (10 min).
// Pièges  :
//   - Rien de punitif (choix de Thomas) : une étape pas faite reste « à faire », jamais barrée ni rouge ; à la fin de la
//     routine (routine_finie, 9 h), elle passe simplement en gris (propositions) et ne se coche plus ; la barre du
//     temps est sauge, s'efface au départ et dès que tout est fait ; minutes perdues le soir : « À demain », sans chiffre.
//   - L'avatar se tient sur la première case à faire dans l'ordre du barème (l'ordre reste libre : il saute si Timo coche
//     plus loin). Quand Timo n'a plus rien à faire (il ne reste que des étapes en attente d'un parent, ou la routine est
//     finie), il se pose devant le coffre, fermé tant qu'un parent n'a pas tout validé : jamais de retour à la première
//     case, comme s'il reculait ; le sablier des cases en attente dit seul qu'on attend un parent. Tout validé : le coffre
//     s'ouvre. Le coffre n'apporte aucune minute (pas de bonus demandé).
//   - Annuler (5 s) seulement une coche de Timo lui-même (par « enfant ») : une étape cochée par un parent ne se défait
//     qu'en mode parent (le serveur refuse sans jeton).
//   - « Levé » (apres 06:30) n'est pas permis avant 6 h 30 : la case le dit (« 6 h 30 ») et l'appui long n'envoie rien, le
//     serveur refuserait (trop_tot). Comparaison en minutes de l'heure de Paris (aucun changement d'heure le matin).
//   - Barre du temps : de la première heure « apres » du barème (6 h 30), sinon une heure avant le départ, jusqu'au départ ;
//     fraction = ce qui reste, à la seconde près.
//   - Bourse : le grand nombre est ce qu'il RESTE à regarder (gagné moins regardé), en minutes arrondies au-dessus comme le
//     minuteur ; « 18 gagnées » en petit dès qu'une partie a été regardée. Minuteur : décompte en heure corrigée jusqu'à fin ;
//     fin passée (avant la maj du serveur) ou « termine » depuis moins de 10 min : « Fin de la vidéo » ; « perdues » (après
//     20 h, minutes_perdues du barème) masque le minuteur, même resté en pause.

import { partiesParis } from '../heure.js';
import { restantMinuteurS, routineFinie, texteMinutes } from './enfants-donnees.js';

export const FIN_MONTREE_MS = 600000;
const ESP = '\u00a0';

const minutesDe = (heure) => {
  const morceaux = heure.split(':').map(Number);
  return morceaux[0] * 60 + morceaux[1];
};

const texteHeure = (heure) => {
  const minutes = minutesDe(heure);
  const reste = minutes % 60;
  return `${Math.floor(minutes / 60)}${ESP}h${reste === 0 ? '' : `${ESP}${reste < 10 ? '0' : ''}${reste}`}`;
};

function minutesParis(ms) {
  const p = partiesParis(ms);
  return p.heure * 60 + p.minute + (Math.floor(ms / 1000) % 60) / 60;
}

function indexAvatar(etapes, fermee) {
  if (fermee) return etapes.length;
  for (let i = 0; i < etapes.length; i += 1) if (etapes[i].statut === 'a_faire') return i;
  return etapes.length;
}

function barreTemps(enfant, depart, maintenant) {
  if (!depart || routineFinie(enfant)) return null;
  const fin = minutesDe(depart);
  const apres = enfant.etapes.filter((etape) => etape.apres).map((etape) => minutesDe(etape.apres));
  const debut = apres.length > 0 ? Math.min.apply(null, apres) : fin - 60;
  if (maintenant < debut || maintenant >= fin || debut >= fin) return null;
  return { fraction: (fin - maintenant) / (fin - debut), heure: texteHeure(depart) };
}

function derniereAnnulable(etapes, ms) {
  let trouvee = null;
  etapes.forEach((etape) => {
    if (etape.statut === 'a_faire' || etape.par !== 'enfant' || !etape.annulable_jusqu_a) return;
    const jusqua = Date.parse(etape.annulable_jusqu_a);
    if (jusqua > ms && (!trouvee || jusqua > trouvee.jusqua)) trouvee = { id: etape.id, picto: etape.picto, jusqua };
  });
  return trouvee;
}

export function vueQuete(enfant, enfants, ms) {
  const maintenant = minutesParis(ms);
  const fermee = Boolean(enfants.routine_finie);
  const avatar = indexAvatar(enfant.etapes, fermee);
  return {
    cases: enfant.etapes.map((etape, i) => ({
      id: etape.id,
      libelle: etape.libelle,
      picto: etape.picto,
      valeur: `+${etape.valeur}`,
      statut: etape.statut,
      parent: etape.validation === 'parent',
      tot: !fermee && etape.statut === 'a_faire' && etape.apres && maintenant < minutesDe(etape.apres) ? texteHeure(etape.apres) : null,
      passee: fermee && etape.statut === 'a_faire',
      enCours: i === avatar,
    })),
    avatar,
    coffre: { ouvert: routineFinie(enfant) },
    temps: barreTemps(enfant, enfants.depart, maintenant),
    annulation: derniereAnnulable(enfant.etapes, ms),
  };
}

function modeBourse(enfant, ms) {
  const minuteur = enfant.minuteur;
  if (enfant.minutes.perdues) return 'perdues';
  if (minuteur && minuteur.etat === 'en_cours') return restantMinuteurS(minuteur, ms) > 0 ? 'minuteur' : 'fin';
  if (minuteur && minuteur.etat === 'termine' && ms - Date.parse(minuteur.fin_le) < FIN_MONTREE_MS) return 'fin';
  if (minuteur && minuteur.etat === 'pause' && enfant.minutes.disponibles_s > 0) return 'pause';
  return 'bourse';
}

export function vueBourse(enfant, ms) {
  const mode = modeBourse(enfant, ms);
  const gagneesS = enfant.gagnees * 60;
  const resteS = mode === 'minuteur' ? restantMinuteurS(enfant.minuteur, ms) : enfant.minutes.disponibles_s;
  const reste = mode === 'perdues' || mode === 'fin' ? 0 : resteS;
  const texte = mode === 'minuteur' ? texteMinutes(reste) : { nombre: String(Math.ceil(reste / 60)), unite: 'min' };
  return {
    mode,
    nombre: texte.nombre,
    unite: texte.unite,
    gagnees: mode !== 'perdues' && enfant.minutes.utilisees_s > 0 && enfant.gagnees > 0 ? `${enfant.gagnees}${ESP}gagnées` : null,
    fraction: gagneesS > 0 ? Math.min(1, reste / gagneesS) : 0,
    peutRegarder: mode === 'bourse' && enfant.minutes.disponibles_s > 0,
  };
}
